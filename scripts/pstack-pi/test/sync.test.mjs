import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyPushFailure,
  failurePullRequestBody,
  pullRequestBody,
  readConfig,
  validationEnv,
} from "../sync.mjs";
import { makeSyncFixture, repoRoot } from "./sync-fixtures.mjs";

const openPullRequest = (number, { draft = false } = {}) => ({
  number,
  url: `https://github.com/toomanyopenfiles/plugins/pull/${number}`,
  isDraft: draft,
  title: "Pi candidate sync",
  state: "OPEN",
});

function assertNoTokenLeak(root, token) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "objects") continue;
        visit(path);
      } else if (readFileSync(path, "utf8").includes(token)) {
        found.push(path);
      }
    }
  };
  visit(root);
  assert.deepEqual(found, [], "a write credential leaked into the checkout");
}

test("sync configuration defaults to the fork, main, and the persistent candidate branch", () => {
  const config = readConfig({});
  assert.equal(config.repository, "toomanyopenfiles/plugins");
  assert.equal(config.baseBranch, "main");
  assert.equal(config.candidateBranch, "pi-candidate");
  assert.equal(config.upstreamRemote, "upstream");
  assert.equal(config.upstreamBranch, "main");
  assert.equal(config.trigger, "local");
});

test("sync configuration refuses to write to the read-only upstream repository", () => {
  assert.throws(() => readConfig({ PSTACK_PI_REPOSITORY: "cursor/plugins" }), /upstream repository/);
  assert.throws(() => readConfig({ PSTACK_PI_REPOSITORY: "plugins" }), /owner\/name/);
});

test("the package validation children never see repository write credentials", () => {
  const scrubbed = validationEnv({
    PATH: "/bin",
    GH_TOKEN: "token",
    GITHUB_TOKEN: "token",
    GH_ENTERPRISE_TOKEN: "token",
    GITHUB_ENTERPRISE_TOKEN: "token",
  });
  assert.deepEqual(scrubbed, { PATH: "/bin" });
});

test("only a rejected push counts as a race", () => {
  assert.equal(classifyPushFailure(" ! [rejected]        HEAD -> pi-candidate (non-fast-forward)"), "race");
  assert.equal(classifyPushFailure(" ! [rejected]        HEAD -> pi-candidate (fetch first)"), "race");
  assert.equal(classifyPushFailure("fatal: unable to access remote"), "error");
});

test("the candidate pull request records the pinned round and the freeze", () => {
  const pinned = "a".repeat(40);
  const body = pullRequestBody({ config: readConfig({}), pinned });
  assert.match(body, new RegExp(pinned));
  assert.match(body, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(body, /open \(draft or not\)|while this pull request is open/i);
  assert.match(body, /freeze|frozen/i);
});

test("a failure draft says the package is out of sync instead of a new candidate", () => {
  const pinned = "b".repeat(40);
  const body = failurePullRequestBody({
    config: readConfig({}),
    pinned,
    command: "check",
    output: "FAIL harness/pstack/pi/LICENSE lost its copyright line",
    runUrl: "https://github.com/toomanyopenfiles/plugins/actions/runs/9",
  });
  assert.match(body, /NOT a new candidate/);
  assert.match(body, /out of sync/);
  assert.match(body, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(body, /lost its copyright line/);
  assert.match(body, new RegExp(pinned));
  assert.match(body, /actions\/runs\/9/);
});

const workflow = readFileSync(join(repoRoot, ".github", "workflows", "pstack-pi-sync.yml"), "utf8");
const syncSource = readFileSync(join(repoRoot, "scripts", "pstack-pi", "sync.mjs"), "utf8");

test("the workflow runs daily at 08:00 Beijing time and also on demand", () => {
  assert.match(workflow, /cron: "0 0 \* \* \*"/);
  assert.match(workflow, /08:00/);
  assert.match(workflow, /Asia\/Shanghai/);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^    inputs:$/m, "a manual run must not gain an unfreeze input");
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request):/m);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("the workflow only ever runs the independent Pi entries", () => {
  assert.match(workflow, /node scripts\/pstack-pi\/sync\.mjs/);
  assert.doesNotMatch(workflow, /generate-pstack-harness-trees/);
  assert.doesNotMatch(syncSource, /generate-pstack-harness-trees/);
  assert.doesNotMatch(syncSource, /--force(?!-)/, "the sync must never force a push");
  assert.doesNotMatch(syncSource, /force-with-lease/);
  assert.doesNotMatch(syncSource, /--unfreeze|unfreezeOption/);
});

test("the workflow keeps the write token out of checkout and candidate code", () => {
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/create-github-app-token@/);
  assert.match(workflow, /vars\.PSTACK_PI_SYNC_APP_ID/);
  assert.match(workflow, /secrets\.PSTACK_PI_SYNC_APP_PRIVATE_KEY/);
  assert.match(workflow, /gh auth setup-git/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^\s+contents: write$/m);
  assert.doesNotMatch(workflow, /^\s{10}token: /m, "checkout must not receive the App token");
  assert.doesNotMatch(workflow, /^\s{4}env:$/m, "the token must not sit at job level");
  const tokenLines = workflow.split("\n").filter((line) => /GH_TOKEN:/.test(line));
  assert.ok(tokenLines.length > 0);
  for (const line of tokenLines) assert.match(line, /^\s{10}GH_TOKEN: /, `token env must stay step-local: ${line}`);
});

test("the sync refuses an origin that is not the fork", (t) => {
  const fixture = makeSyncFixture(t, { sources: false });
  fixture.git(fixture.work, ["remote", "set-url", "origin", "https://github.com/cursor/plugins.git"]);
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /not the sync target/);
  assert.match(result.output, /cursor\/plugins/);
  assert.deepEqual(fixture.pullRequestLists(), []);
});

test("the sync pushes only the candidate branch and never resets it", () => {
  assert.match(syncSource, /\["push", "origin", `HEAD:refs\/heads\/\$\{config\.candidateBranch\}`\]/);
  assert.doesNotMatch(syncSource, /\["reset"/);
  assert.doesNotMatch(syncSource, /--force/);
  assert.doesNotMatch(syncSource, /push", "--force/);
});

test("the normal round merges main and the pinned upstream commit, regenerates, pushes, and opens the PR", (t) => {
  const fixture = makeSyncFixture(t, { recordValidationEnv: true });
  const result = fixture.run();

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /pull\/101/);

  const tip = fixture.tip();
  assert.ok(tip, "the candidate branch was pushed");
  assert.equal(fixture.contains(tip, fixture.shas.main), true, "the fork's main is merged");
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true, "the pinned upstream commit is merged");

  const guide = fixture.fileAt(tip, "harness/pstack/pi/docs/guide/fork-note.md");
  assert.equal(guide.status, 0, "the fork's main source change is packaged");
  const skill = fixture.fileAt(tip, "harness/pstack/pi/skills/tdd/SKILL.md").stdout;
  assert.match(skill, /Upstream note added by the cursor\/plugins fixture/);

  const identity = fixture.git(fixture.origin, ["log", "-1", "--format=%an", tip]).stdout.trim();
  assert.equal(identity, "pstack-pi-sync[bot]");

  const lists = fixture.pullRequestLists();
  assert.equal(lists.length, 3, "the freeze is checked before the round, before the push, and before the pull request");
  const listArgs = lists[0].args;
  assert.ok(listArgs.includes("--repo") && listArgs[listArgs.indexOf("--repo") + 1] === "toomanyopenfiles/plugins");
  assert.equal(listArgs[listArgs.indexOf("--head") + 1], "pi-candidate");
  assert.equal(listArgs[listArgs.indexOf("--state") + 1], "open");

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, false);
  assert.equal(created[0].args[created[0].args.indexOf("--base") + 1], "main");
  assert.match(created[0].body, new RegExp(fixture.shas.upstream));

  assert.equal(fixture.canaryRan(), false, "the inherited whole-tree generator must never run");
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "", "the checkout is fully committed");
  assertNoTokenLeak(fixture.work, "fixture-token-value");
  for (const remote of ["origin", "upstream"]) {
    const url = fixture.git(fixture.work, ["remote", "get-url", remote]).stdout.trim();
    assert.ok(url.startsWith(fixture.root), `${remote} is a local only remote`);
  }

  const validationEnvRecord = JSON.parse(readFileSync(fixture.validationEnvLog, "utf8"));
  assert.equal(validationEnvRecord.GH_TOKEN, null);
  assert.equal(validationEnvRecord.GITHUB_TOKEN, null);
});

test("the round keeps its pinned upstream commit even when upstream moves during the run", (t) => {
  const fixture = makeSyncFixture(t, { advanceUpstreamOnPrList: true });
  const result = fixture.run();
  assert.equal(result.status, 0, result.output);

  const advanced = fixture.advancedSha();
  assert.ok(advanced, "the fixture moved upstream mid-run");
  assert.notEqual(advanced, fixture.shas.upstream);

  const tip = fixture.tip();
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true);
  assert.equal(fixture.contains(tip, advanced), false, "the round must not follow a moving upstream");
});

test("an open draft candidate pull request freezes the branch", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, prLists: [[openPullRequest(7, { draft: true })]] });
  const result = fixture.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /already open/);
  assert.match(result.output, /#7/);
  assert.match(result.output, /draft/);
  assert.equal(fixture.tip(), undefined, "the frozen run must not create the candidate branch");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("an open ready candidate pull request leaves the existing branch untouched", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, candidate: "present", prLists: [[openPullRequest(12)]] });
  const result = fixture.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /already open/);
  assert.equal(fixture.tip(), fixture.shas.candidate);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a manual run does not unfreeze the candidate", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, prLists: [[openPullRequest(9, { draft: true })]] });
  const scheduled = fixture.run();
  assert.equal(scheduled.status, 0, scheduled.output);
  const manual = fixture.run({ PSTACK_PI_TRIGGER: "workflow_dispatch" });
  assert.equal(manual.status, 0, manual.output);
  assert.match(manual.output, /already open/);
  assert.equal(fixture.tip(), undefined);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("the freeze is checked again right before the push", (t) => {
  const fixture = makeSyncFixture(t, { prLists: [[], [openPullRequest(21, { draft: true })]] });
  const result = fixture.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /already open/);
  assert.equal(fixture.tip(), undefined, "nothing is pushed after a pull request appears");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "");
});

test("a round with nothing new does not push or open an empty pull request", (t) => {
  const fixture = makeSyncFixture(t, { candidate: "upToDate" });
  const result = fixture.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /no candidate changes/);
  assert.equal(fixture.tip(), fixture.shas.candidate);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "");
});

test("a merge conflict stops without committing the conflict or pushing", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, candidate: "conflict", upstreamChange: "conflict" });
  const result = fixture.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /merge conflict/);
  assert.match(result.output, /nothing was pushed|stopped/);
  assert.equal(fixture.tip(), fixture.shas.candidate, "the candidate branch is untouched");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
  assert.equal(existsSync(join(fixture.work, ".git", "MERGE_HEAD")), false, "no conflict state is left behind");
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "");
});

test("a push race stops without a force push", (t) => {
  const fixture = makeSyncFixture(t, { race: true });
  const result = fixture.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /push race/);
  assert.match(result.output, /without a force push/);
  assert.equal(fixture.tip(), fixture.shas.race, "the competing commit stays on the branch");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a generation failure keeps the merged source and opens a draft that marks the old package", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "missing-source" });
  const result = fixture.run();
  assert.equal(result.status, 1, result.output);

  const tip = fixture.tip();
  assert.ok(tip, "the merged source is pushed");
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true);

  const previousTree = fixture.git(fixture.origin, ["rev-parse", `${fixture.shas.main}:harness/pstack/pi`]).stdout.trim();
  const committedTree = fixture.git(fixture.origin, ["rev-parse", `${tip}:harness/pstack/pi`]).stdout.trim();
  assert.equal(committedTree, previousTree, "no half-generated tree is committed");

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, true);
  assert.match(created[0].body, /NOT a new candidate/);
  assert.match(created[0].body, /out of sync/);
  assert.match(created[0].body, /generate/);
  assert.match(created[0].body, new RegExp(fixture.shas.upstream));
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "");
});

test("a check failure restores the previous package and labels the draft as out of sync", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "license" });
  const result = fixture.run();
  assert.equal(result.status, 1, result.output);

  const tip = fixture.tip();
  assert.ok(tip);
  const previousLicense = fixture.fileAt(fixture.shas.main, "harness/pstack/pi/LICENSE").stdout;
  const committedLicense = fixture.fileAt(tip, "harness/pstack/pi/LICENSE").stdout;
  assert.match(committedLicense, /Copyright \(c\)/);
  assert.equal(committedLicense, previousLicense, "the failed round's generated files are not committed");

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, true);
  assert.match(created[0].body, /NOT a new candidate/);
  assert.match(created[0].body, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(created[0].body, /lost its copyright line/);
  assert.equal(fixture.git(fixture.work, ["status", "--porcelain"]).stdout, "");
});

test("the README documents the freeze, repair, and remaining fork configuration", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const start = readme.indexOf("## Pi candidate sync");
  assert.ok(start > 0, "the README has no Pi candidate sync section");
  const section = readme.slice(start);
  assert.match(section, /pi-candidate/);
  assert.match(section, /0 0 \* \* \*/);
  assert.match(section, /08:00/);
  assert.match(section, /Asia\/Shanghai/);
  assert.match(section, /freeze|frozen/i);
  assert.match(section, /force-push|force push/i);
  assert.match(section, /Contents: read and write/i);
  assert.match(section, /PSTACK_PI_SYNC_APP_ID/);
  assert.match(section, /validate-plugins\.yml/);
  assert.match(section, /not enabled/i);
});
