import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_DIAGNOSTIC_CHARS,
  classifyPushFailure,
  failurePullRequestBody,
  pullRequestBody,
  readConfig,
  readPlan,
  readResult,
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

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "pstack-pi-plan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writePlan(dir, plan) {
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
}

const aPlan = {
  schema: 1,
  outcome: "proceed",
  repository: "toomanyopenfiles/plugins",
  baseBranch: "main",
  candidateBranch: "pi-candidate",
  pinned: "a".repeat(40),
  baseTip: "b".repeat(40),
  previousCandidateTip: null,
  candidateTip: "c".repeat(40),
  hasNewCommits: true,
};

function assertNoTokenLeak(root, tokens) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "objects") continue;
        visit(path);
      } else {
        const text = readFileSync(path, "utf8");
        for (const token of tokens) if (text.includes(token)) found.push(`${path} contains ${token}`);
      }
    }
  };
  visit(root);
  assert.deepEqual(found, [], "a write credential leaked into a checkout");
}

function jobSection(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `the workflow has no ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const workflow = readFileSync(join(repoRoot, ".github", "workflows", "pstack-pi-sync.yml"), "utf8");
const syncSource = readFileSync(join(repoRoot, "scripts", "pstack-pi", "sync.mjs"), "utf8");

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

test("no token environment survives into the trusted build and check children", () => {
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

test("the plan handed between jobs is rejected unless every field is expected", (t) => {
  const dir = tempDir(t);
  const config = readConfig({});
  writePlan(dir, aPlan);
  assert.equal(readPlan(dir, config).candidateTip, aPlan.candidateTip);

  for (const [field, value, message] of [
    ["schema", 2, /unknown schema/],
    ["repository", "cursor/plugins", /not toomanyopenfiles\/plugins/],
    ["baseBranch", "release", /different base branch/],
    ["candidateBranch", "other", /different candidate branch/],
    ["outcome", "maybe", /unknown outcome/],
    ["pinned", "not-a-sha", /no pinned upstream commit/],
    ["candidateTip", null, /without a candidate tip/],
    ["hasNewCommits", "yes", /hasNewCommits/],
  ]) {
    writePlan(dir, { ...aPlan, [field]: value });
    assert.throws(() => readPlan(dir, config), message, `plan field ${field} was accepted`);
  }
});

test("the validated result is rejected unless it belongs to the planned candidate", (t) => {
  const dir = tempDir(t);
  const config = readConfig({});
  const plan = aPlan;
  const aResult = {
    schema: 1,
    outcome: "ok",
    step: null,
    exitCode: 0,
    regenerated: true,
    tip: "d".repeat(40),
    candidateTip: plan.candidateTip,
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify(aResult));
  assert.equal(readResult(dir, config, plan).tip, aResult.tip);

  for (const [patch, message] of [
    [{ candidateTip: "e".repeat(40) }, /different candidate tip/],
    [{ schema: 9 }, /unknown schema/],
    [{ outcome: "partial" }, /unknown outcome/],
    [{ step: "deploy" }, /unknown failed step/],
    [{ regenerated: "yes" }, /regenerated flag/],
    [{ regenerated: true, tip: null }, /carries no commit/],
    [
      { outcome: "failed", step: "generate", exitCode: 1, regenerated: false, tip: null },
      /has no failure diagnostics/,
    ],
    [
      { outcome: "failed", step: "generate", exitCode: 1, regenerated: false, tip: null, diagnostics: "raw text" },
      /failure diagnostics/,
    ],
    [
      {
        outcome: "failed",
        step: "generate",
        exitCode: 1,
        regenerated: false,
        tip: null,
        diagnostics: { stdout: "x".repeat(MAX_DIAGNOSTIC_CHARS + 1), stderr: "", truncated: true },
      },
      /oversized/,
    ],
  ]) {
    writeFileSync(join(dir, "result.json"), JSON.stringify({ ...aResult, ...patch }));
    assert.throws(() => readResult(dir, config, plan), message);
  }
});

test("the candidate pull request records the pinned round and the freeze", () => {
  const pinned = "a".repeat(40);
  const body = pullRequestBody({ config: readConfig({}), pinned });
  assert.match(body, new RegExp(pinned));
  assert.match(body, /separate credential-free job/);
  assert.match(body, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(body, /while this pull request is open/i);
  assert.match(body, /freeze|frozen/i);
});

test("a failure draft says the package is out of sync instead of a new candidate", () => {
  const pinned = "b".repeat(40);
  const body = failurePullRequestBody({
    config: readConfig({}),
    pinned,
    step: "check",
    exitCode: 1,
    runUrl: "https://github.com/toomanyopenfiles/plugins/actions/runs/9",
  });
  assert.match(body, /NOT a new candidate/);
  assert.match(body, /out of sync/);
  assert.match(body, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(body, new RegExp(pinned));
  assert.match(body, /actions\/runs\/9/);
});

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
  assert.match(workflow, /node scripts\/pstack-pi\/sync\.mjs prepare /);
  assert.match(workflow, /node scripts\/pstack-pi\/sync\.mjs validate /);
  assert.match(workflow, /node scripts\/pstack-pi\/sync\.mjs publish /);
  assert.doesNotMatch(workflow, /generate-pstack-harness-trees/);
  assert.doesNotMatch(syncSource, /generate-pstack-harness-trees/);
  assert.doesNotMatch(syncSource, /--force(?!-)/, "the sync must never force a push");
  assert.doesNotMatch(syncSource, /force-with-lease/);
  assert.doesNotMatch(syncSource, /\["reset"/);
  assert.doesNotMatch(syncSource, /--unfreeze|unfreezeOption/);
});

test("the credentialed publish job is the only one that can reach the App key", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n  pull-requests: read$/m);
  assert.doesNotMatch(workflow, /^\s+contents: write$/m);

  const prepare = jobSection(workflow, "prepare");
  const validate = jobSection(workflow, "validate");
  const publish = jobSection(workflow, "publish");
  for (const section of [prepare, validate]) {
    assert.doesNotMatch(section, /create-github-app-token/, "only the publish job may mint the App token");
    assert.doesNotMatch(section, /secrets\.|vars\.PSTACK_PI_APP/, "only the publish job may read the App key");
    assert.doesNotMatch(section, /GH_TOKEN/, "only the publish job may hold a write token");
    assert.doesNotMatch(section, /environment:/, "only the publish job may request the write environment");
  }
  assert.match(publish, /environment: pstack-pi-write/);
  assert.match(publish, /vars\.PSTACK_PI_APP_ID/);
  assert.match(publish, /secrets\.PSTACK_PI_APP_PRIVATE_KEY/);
  assert.match(publish, /gh auth setup-git/);

  const tokenLines = workflow.split("\n").filter((line) => /GH_TOKEN:/.test(line));
  assert.ok(tokenLines.length > 0);
  for (const line of tokenLines) assert.match(line, /^\s{10}GH_TOKEN: /, `token env must stay step-local: ${line}`);
  assert.doesNotMatch(workflow, /^\s{10}token: /m, "checkout must not receive the App token");
  assert.doesNotMatch(workflow, /^\s{4}env:$/m, "the token must not sit at job level");
  for (const match of workflow.matchAll(/^\s+uses: (actions\/checkout@[^\n]+)$/gm)) {
    assert.ok(match);
  }
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 3, "every checkout runs without persisted credentials");
});

test("the workflow never interpolates job data into shell code", () => {
  assert.doesNotMatch(workflow, /run:.*\$\{\{/, "no expression may be spliced into a run step");
  assert.doesNotMatch(workflow, /run: \|/, "the workflow must not build shell scripts inline");
});

test("both Pi workflows share one dedicated App configuration", () => {
  assert.doesNotMatch(workflow, /PSTACK_PI_SYNC_APP_/);
  assert.match(workflow, /vars\.PSTACK_PI_APP_ID/);
  assert.match(workflow, /secrets\.PSTACK_PI_APP_PRIVATE_KEY/);
});

test("the normal round merges, builds without credentials, publishes, and opens the PR", (t) => {
  const fixture = makeSyncFixture(t);
  const prepare = fixture.runPrepare();
  assert.equal(prepare.status, 0, prepare.output);
  assert.equal(prepare.outcome, "proceed");
  assert.equal(fixture.ghCalls().length, 1, "the prepare job only asks whether a candidate PR is open");
  const validate = fixture.runValidate();
  assert.equal(fixture.ghCalls().length, 1, "the credential-free build must not call gh at all");
  const publish = fixture.runPublish();

  assert.equal(validate.status, 0, validate.output);
  assert.equal(publish.status, 0, publish.output);
  assert.match(publish.output, /pull\/101/);

  const plan = fixture.plan();
  const result = fixture.result();
  assert.equal(plan.pinned, fixture.shas.upstream);
  assert.equal(plan.hasNewCommits, true);
  assert.equal(result.outcome, "ok");
  assert.equal(result.regenerated, true);

  const tip = fixture.tip();
  assert.ok(tip, "the candidate branch was pushed");
  assert.equal(fixture.contains(tip, fixture.shas.main), true, "the fork's main is merged");
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true, "the pinned upstream commit is merged");
  assert.equal(tip, result.tip);

  const guide = fixture.fileAt(tip, "harness/pstack/pi/docs/guide/fork-note.md");
  assert.equal(guide.status, 0, "the fork's main source change is packaged");
  const skill = fixture.fileAt(tip, "harness/pstack/pi/skills/tdd/SKILL.md").stdout;
  assert.match(skill, /Upstream note added by the cursor\/plugins fixture/);
  const identity = fixture.git(fixture.origin, ["log", "-1", "--format=%an", tip]).stdout.trim();
  assert.equal(identity, "pstack-pi-sync[bot]");
  const bot = "pstack-pi-sync[bot] <pstack-pi-sync[bot]@users.noreply.github.com>";
  const merges = fixture
    .git(fixture.origin, ["log", "--merges", "--format=%an <%ae>|%cn <%ce>", tip])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  assert.ok(merges.length >= 1, "the round creates ordinary merge commits");
  for (const line of merges) assert.equal(line, `${bot}|${bot}`, "the merge commit carries the bot author and committer");

  const lists = fixture.pullRequestLists();
  assert.equal(lists.length, 3, "the freeze is checked by the prepare job, again before the push, and before opening the PR");
  for (const list of lists) {
    const args = list.args;
    assert.ok(args.includes("--repo") && args[args.indexOf("--repo") + 1] === "toomanyopenfiles/plugins");
    assert.equal(args[args.indexOf("--head") + 1], "pi-candidate");
    assert.equal(args[args.indexOf("--state") + 1], "open");
    assert.ok(!args.includes("--base"), "a candidate PR freezes the branch regardless of its base");
  }

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, false);
  assert.equal(created[0].args[created[0].args.indexOf("--base") + 1], "main");
  assert.match(created[0].body, new RegExp(fixture.shas.upstream));

  assert.equal(fixture.canaryRan(), false, "the inherited whole-tree generator must never run");
  assert.equal(fixture.candidateScriptRan(), false, "no candidate-carried script may run");
  assert.equal(fixture.branchHead(fixture.runners.publish), "main", "the publish checkout never switches to candidate content");
  const publishSkill = readFileSync(join(fixture.runners.publish, "pstack", "skills", "tdd", "SKILL.md"), "utf8");
  assert.doesNotMatch(publishSkill, /Upstream note added by the cursor\/plugins fixture/);
  assert.equal(fixture.git(fixture.runners.publish, ["status", "--porcelain"]).stdout.trim(), "");
  for (const runner of Object.values(fixture.runners)) {
    assertNoTokenLeak(runner, ["fixture-write-token", "fixture-read-token"]);
    for (const remote of ["origin"]) {
      const url = fixture.git(runner, ["remote", "get-url", remote]).stdout.trim();
      assert.ok(url.startsWith(fixture.root), `${remote} is a local only remote`);
    }
  }
});

test("prepare merges with its own bot identity when the runner has no ambient Git identity", (t) => {
  const fixture = makeSyncFixture(t, { hermeticIdentity: true });
  const { prepare, validate, publish } = fixture.runRound();
  assert.equal(prepare.status, 0, prepare.output);
  assert.equal(prepare.outcome, "proceed");
  assert.equal(validate.status, 0, validate.output);
  assert.equal(publish.status, 0, publish.output);

  const bot = "pstack-pi-sync[bot] <pstack-pi-sync[bot]@users.noreply.github.com>";
  const tip = fixture.tip();
  assert.ok(tip, "the candidate branch was pushed");
  const merges = fixture
    .git(fixture.origin, ["log", "--merges", "--format=%an <%ae>|%cn <%ce>", tip])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  assert.ok(merges.length >= 1, "the round created a merge commit without any ambient identity");
  for (const line of merges) assert.equal(line, `${bot}|${bot}`, "the merge is authored and committed by the bot");
  assert.doesNotMatch(fixture.git(fixture.origin, ["log", "-1", "--format=%ae %ce", tip]).stdout, /example\.test|gaosong/i);
});

test("the round keeps its pinned upstream commit even when upstream moves during the run", (t) => {
  const fixture = makeSyncFixture(t, { advanceUpstreamOnPrList: true });
  const { publish } = fixture.runRound();
  assert.equal(publish.status, 0, publish.output);

  const advanced = fixture.advancedSha();
  assert.ok(advanced, "the fixture moved upstream mid-run");
  assert.notEqual(advanced, fixture.shas.upstream);

  const tip = fixture.tip();
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true);
  assert.equal(fixture.contains(tip, advanced), false, "the round must not follow a moving upstream");
});

test("a candidate-carried generator is never executed", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "tamper-generator" });
  const { validate, publish } = fixture.runRound();
  assert.equal(validate.status, 0, validate.output);
  assert.equal(publish.status, 0, publish.output);
  assert.equal(fixture.result().outcome, "ok", "the trusted generator built the package");
  assert.equal(fixture.candidateScriptRan(), false, "the candidate generator ran");
  assert.equal(fixture.pullRequestsCreated()[0].draft, false);
});

test("a candidate-carried checker is never executed", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "tamper-check" });
  const { validate, publish } = fixture.runRound();
  assert.equal(validate.status, 0, validate.output);
  assert.equal(publish.status, 0, publish.output);
  assert.equal(fixture.result().outcome, "ok", "the trusted checker verified the package");
  assert.equal(fixture.candidateScriptRan(), false, "the candidate checker ran");
});

test("an open draft candidate pull request freezes the branch before any build", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, prLists: [[openPullRequest(7, { draft: true })]] });
  const { prepare, validate, publish } = fixture.runRound();
  assert.equal(prepare.status, 0, prepare.output);
  assert.equal(prepare.outcome, "frozen");
  assert.match(prepare.output, /already open/);
  assert.match(prepare.output, /#7/);
  assert.match(prepare.output, /draft/);
  assert.equal(validate, undefined, "no build runs while the branch is frozen");
  assert.equal(publish, undefined);
  assert.equal(fixture.tip(), undefined, "the frozen run must not create the candidate branch");
  assert.equal(existsSync(join(fixture.staging.prepared, "candidate.bundle")), false);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("an open ready candidate pull request leaves the existing branch untouched", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, candidate: "present", prLists: [[openPullRequest(12)]] });
  const { prepare } = fixture.runRound();
  assert.equal(prepare.outcome, "frozen");
  assert.equal(fixture.tip(), fixture.shas.candidate);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a manual run does not unfreeze the candidate", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, prLists: [[openPullRequest(9, { draft: true })]] });
  const scheduled = fixture.runPrepare();
  assert.equal(scheduled.outcome, "frozen");
  const manual = fixture.runPrepare({ PSTACK_PI_TRIGGER: "workflow_dispatch" });
  assert.equal(manual.outcome, "frozen");
  assert.match(manual.output, /already open/);
  assert.equal(fixture.tip(), undefined);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("the freeze is checked again in the publish job before the push", (t) => {
  const fixture = makeSyncFixture(t, { prLists: [[], [openPullRequest(21, { draft: true })]] });
  const { prepare, publish } = fixture.runRound();
  assert.equal(prepare.outcome, "proceed");
  assert.equal(publish.status, 0, publish.output);
  assert.match(publish.output, /already open/);
  assert.equal(fixture.tip(), undefined, "nothing is pushed after a pull request appears");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a round with nothing new does not push or open an empty pull request", (t) => {
  const fixture = makeSyncFixture(t, { candidate: "upToDate" });
  const { prepare, validate, publish } = fixture.runRound();
  assert.equal(prepare.outcome, "proceed");
  assert.equal(fixture.plan().hasNewCommits, false);
  assert.equal(validate.status, 0, validate.output);
  assert.equal(fixture.result().regenerated, false);
  assert.equal(publish.status, 0, publish.output);
  assert.match(publish.output, /no candidate changes/);
  assert.equal(fixture.tip(), fixture.shas.candidate);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a merge conflict stops before any build or push", (t) => {
  const fixture = makeSyncFixture(t, { sources: false, candidate: "conflict", upstreamChange: "conflict" });
  const { prepare, validate, publish } = fixture.runRound();
  assert.equal(prepare.status, 1, prepare.output);
  assert.match(prepare.output, /merge conflict/);
  assert.match(prepare.output, /nothing was pushed/);
  assert.equal(validate, undefined);
  assert.equal(publish, undefined);
  assert.equal(fixture.tip(), fixture.shas.candidate, "the candidate branch is untouched");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a merge failure that is not a source conflict keeps its own diagnostic", (t) => {
  const fixture = makeSyncFixture(t, {
    sources: false,
    hermeticIdentity: true,
    failingPreMergeCommitHook: true,
  });
  const prepare = fixture.runPrepare();
  assert.equal(prepare.status, 1, prepare.output);
  assert.match(prepare.output, /fixture pre-merge-commit hook refused the merge/, "the actual failure cause is reported");
  assert.doesNotMatch(prepare.output, /merge conflict/i, "a hook failure is not called a source conflict");
  assert.equal(existsSync(join(fixture.staging.prepared, "plan.json")), false, "no conflict plan is written");
  assert.equal(fixture.tip(), undefined, "nothing was pushed");
  assert.equal(fixture.git(fixture.runners.prepare, ["status", "--porcelain"]).stdout.trim(), "", "the failed merge leaves no staged state");
  assert.notEqual(
    fixture.git(fixture.runners.prepare, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], true).status,
    0,
    "the failed merge is not left in progress",
  );
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a push race stops without a force push", (t) => {
  const fixture = makeSyncFixture(t, { race: true });
  const { publish } = fixture.runRound();
  assert.equal(publish.status, 1, publish.output);
  assert.match(publish.output, /push race/);
  assert.match(publish.output, /without a force push/);
  assert.equal(fixture.tip(), fixture.shas.race, "the competing commit stays on the branch");
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("a generation failure keeps the merged source and opens a draft that marks the old package", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "missing-source" });
  const { prepare, validate, publish } = fixture.runRound();
  assert.equal(prepare.outcome, "proceed");
  assert.equal(validate.status, 0, validate.output);
  assert.match(validate.output, /missing required bundled skill: cursor-team-kit\/skills\/deslop/, "the validation log carries the real cause");
  assert.match(validate.output, /inert/, "captured output is labelled as inert text");
  const result = fixture.result();
  assert.equal(result.outcome, "failed");
  assert.equal(result.step, "generate");
  assert.equal(result.regenerated, false);
  assert.equal(result.diagnostics.truncated, false);
  assert.match(result.diagnostics.stderr, /missing required bundled skill: cursor-team-kit\/skills\/deslop/);

  assert.equal(publish.status, 1, publish.output);
  const tip = fixture.tip();
  assert.equal(fixture.contains(tip, fixture.shas.upstream), true);

  const previousTree = fixture.git(fixture.origin, ["rev-parse", `${fixture.shas.main}:harness/pstack/pi`]).stdout.trim();
  const committedTree = fixture.git(fixture.origin, ["rev-parse", `${tip}:harness/pstack/pi`]).stdout.trim();
  assert.equal(committedTree, previousTree, "no half-generated tree is committed");

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, true);
  assert.match(created[0].body, /NOT a new candidate/);
  assert.match(created[0].body, /out of sync/);
  assert.match(created[0].body, /generate\.mjs/);
  assert.match(created[0].body, /missing required bundled skill: cursor-team-kit\/skills\/deslop/, "the draft carries the failing output");
  assert.match(created[0].body, new RegExp(fixture.runUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a check failure keeps the previous package and labels the draft as out of sync", (t) => {
  const fixture = makeSyncFixture(t, { upstreamChange: "license" });
  const { validate, publish } = fixture.runRound();
  assert.equal(validate.status, 0, validate.output);
  assert.equal(fixture.result().step, "check");
  assert.equal(publish.status, 1, publish.output);

  const tip = fixture.tip();
  const previousLicense = fixture.fileAt(fixture.shas.main, "harness/pstack/pi/LICENSE").stdout;
  const committedLicense = fixture.fileAt(tip, "harness/pstack/pi/LICENSE").stdout;
  assert.match(committedLicense, /Copyright \(c\)/);
  assert.equal(committedLicense, previousLicense, "the failed round's generated files are not committed");

  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, true);
  assert.match(created[0].body, /NOT a new candidate/);
  assert.match(created[0].body, /check\.mjs/);
});

test("publish refuses a validated commit that touches files outside the package", (t) => {
  const fixture = makeSyncFixture(t);
  assert.equal(fixture.runPrepare().outcome, "proceed");
  assert.equal(fixture.runValidate().status, 0);
  fixture.forgePackage({
    mutate: (work) => fixture.addPackageFile(work, "scripts/pstack-pi/backdoor.mjs", "console.log('backdoor');\n"),
  });

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /outside harness\/pstack\/pi/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("publish refuses a validated package that smuggles a symlink", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  fixture.forgePackage({
    mutate: (work) => fixture.addPackageSymlink(work, "harness/pstack/pi/leak.md", "/etc/passwd"),
  });

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /file mode 120000/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("publish refuses a validated package that is more than one commit", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  fixture.forgePackage({ commits: 2, mutate: (work) => fixture.addPackageFile(work, "harness/pstack/pi/extra.md", "extra\n") });

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /not a single commit/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("publish refuses oversized failure diagnostics instead of carrying them", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  const result = fixture.result();
  const staged = fixture.stageForPublish();
  const oversized = "x".repeat(MAX_DIAGNOSTIC_CHARS + 1);
  writeFileSync(
    join(staged.validated, "result.json"),
    JSON.stringify({
      ...result,
      outcome: "failed",
      step: "generate",
      exitCode: 1,
      regenerated: false,
      tip: null,
      diagnostics: { stdout: "", stderr: oversized, truncated: true },
    }),
  );

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /diagnostics/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("publish refuses malformed failure diagnostics instead of carrying them", (t) => {
  for (const diagnostics of ["raw text", { stdout: 42, stderr: "", truncated: false }, { stdout: "", stderr: {}, truncated: false }]) {
    const fixture = makeSyncFixture(t);
    fixture.runPrepare();
    fixture.runValidate();
    const result = fixture.result();
    const staged = fixture.stageForPublish();
    writeFileSync(
      join(staged.validated, "result.json"),
      JSON.stringify({ ...result, outcome: "failed", step: "generate", exitCode: 1, regenerated: false, tip: null, diagnostics }),
    );
    const publish = fixture.runPublish();
    assert.notEqual(publish.status, 0);
    assert.match(publish.output, /diagnostics/);
    assert.deepEqual(fixture.pullRequestsCreated(), []);
  }
});

test("failure diagnostics stay inert text in the draft body", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  const result = fixture.result();
  const staged = fixture.stageForPublish();
  const marker = join(fixture.root, "diagnostic-executed-marker");
  const hostile = `$(touch ${marker}) \`touch ${marker}\`\n::error::forged workflow command\n~~~ not a fence`;
  writeFileSync(
    join(staged.validated, "result.json"),
    JSON.stringify({
      ...result,
      outcome: "failed",
      step: "check",
      exitCode: 1,
      regenerated: false,
      tip: null,
      diagnostics: { stdout: hostile, stderr: hostile, truncated: false },
    }),
  );

  const publish = fixture.runPublish();
  assert.equal(publish.status, 1, publish.output);
  const created = fixture.pullRequestsCreated();
  assert.equal(created.length, 1);
  assert.equal(created[0].draft, true);
  assert.ok(created[0].body.includes(hostile), "the captured text is carried verbatim as data");
  assert.equal(existsSync(marker), false, "captured text is never executed");
});

test("publish refuses a plan that targets another branch", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  const plan = fixture.plan();
  const staged = fixture.stageForPublish();
  writeFileSync(join(staged.prepared, "plan.json"), JSON.stringify({ ...plan, candidateBranch: "someone-else" }));

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /different candidate branch/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("publish refuses a result that belongs to another candidate tip", (t) => {
  const fixture = makeSyncFixture(t);
  fixture.runPrepare();
  fixture.runValidate();
  const result = fixture.result();
  const staged = fixture.stageForPublish();
  writeFileSync(join(staged.validated, "result.json"), JSON.stringify({ ...result, candidateTip: "f".repeat(40) }));

  const publish = fixture.runPublish();
  assert.notEqual(publish.status, 0);
  assert.match(publish.output, /different candidate tip/);
  assert.deepEqual(fixture.pullRequestsCreated(), []);
});

test("prepare refuses an origin that is not the fork", (t) => {
  const fixture = makeSyncFixture(t, { sources: false });
  fixture.git(fixture.runners.prepare, ["remote", "set-url", "origin", "https://github.com/cursor/plugins.git"]);
  const prepare = fixture.runPrepare();
  assert.notEqual(prepare.status, 0);
  assert.match(prepare.output, /not the sync target/);
  assert.match(prepare.output, /cursor\/plugins/);
  assert.deepEqual(fixture.pullRequestLists(), []);
});

test("the README documents the freeze, the trust split, and the remaining fork configuration", () => {
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
  assert.match(section, /`PSTACK_PI_APP_ID`/);
  assert.match(section, /`PSTACK_PI_APP_PRIVATE_KEY`/);
  assert.match(section, /pstack-pi-write/);
  assert.match(section, /deployment branch policy/i);
  assert.match(section, /only.*main/i);
  assert.match(section, /not enabled/i);
  assert.match(section, /credential-free|without write credentials/i);
  assert.match(section, /validate-plugins\.yml/);
  assert.match(section, /same dedicated GitHub App/i);
});
