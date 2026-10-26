import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SOURCES = [
  "pstack/skills",
  "pstack/docs",
  "pstack/agents",
  "pstack/automations",
  "pstack/assets",
  "pstack/README.md",
  "pstack/LICENSE",
  "pstack/plugin.json",
  "cursor-team-kit/LICENSE",
  "cursor-team-kit/skills/control-cli",
  "cursor-team-kit/skills/control-ui",
  "cursor-team-kit/skills/deslop",
];
const MINIMAL_SOURCES = ["pstack/skills/tdd"];
const SCRIPTS = ["lib.mjs", "generate.mjs", "check.mjs", "sync.mjs"];
const OUTPUT = "harness/pstack/pi";

// The inherited whole-tree generator must never run from the Pi sync path. If it does,
// it leaves this canary behind in the checkout.
const CANARY = `import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "harness-generator-canary.txt"), "called\\n");
console.error("the inherited whole-tree harness generator must not run from the Pi sync");
process.exit(1);
`;

/** A candidate-carried copy of a trusted entry script. Running it must leave a marker and fail. */
function candidateScript(name) {
  return `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.PSTACK_PI_MARKER_DIR;
if (dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "candidate-${name}-ran.txt"), "called\\n");
}
console.error("the candidate-carried ${name} must not run");
process.exit(1);
`;
}

const FAKE_GH = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { listCalls: 0 };
const flag = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const entry = { args };

if (args[0] === "pr" && args[1] === "list") {
  const lists = JSON.parse(readFileSync(process.env.FAKE_GH_PR_LISTS, "utf8"));
  const index = Math.min(state.listCalls, lists.length - 1);
  entry.result = lists[index] ?? [];
  state.listCalls += 1;
  if (state.listCalls === 1 && process.env.FAKE_GH_ON_LIST) {
    const advance = spawnSync("sh", ["-c", process.env.FAKE_GH_ON_LIST], { encoding: "utf8", env: process.env });
    entry.advance = { status: advance.status, stderr: advance.stderr };
  }
} else if (args[0] === "pr" && args[1] === "create") {
  const bodyFile = flag("--body-file");
  entry.body = bodyFile ? readFileSync(bodyFile, "utf8") : "";
  entry.draft = args.includes("--draft");
  entry.result = "https://github.com/toomanyopenfiles/plugins/pull/101";
} else {
  entry.result = "";
}

writeFileSync(statePath, JSON.stringify(state));
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(entry) + "\\n");
process.stdout.write((typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result)) + "\\n");
`;

/**
 * Build an isolated fixture with the same three checkouts the workflow uses: a trusted prepare
 * runner, a credential-free validate runner, and a credential-holding publish runner. Every push
 * lands in a temporary local bare repository; `gh` is a local stub; nothing leaves the machine.
 */
export function makeSyncFixture(t, options = {}) {
  const {
    sources = true,
    upstreamChange = "skill",
    candidate = "absent",
    mainAdvanced = true,
    race = false,
    prLists = [[]],
    advanceUpstreamOnPrList = false,
  } = options;

  const root = mkdtempSync(join(tmpdir(), "pstack-pi-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitConfig = join(root, "gitconfig");
  writeFileSync(gitConfig, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_OUTPUT", "PSTACK_PI_REPOSITORY", "PSTACK_PI_RUN_URL", "PSTACK_PI_TRIGGER"]) {
    delete env[key];
  }

  const git = (cwd, args, allowFailure = false) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env, timeout: 120_000 });
    if (result.status !== 0 && !allowFailure) {
      throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  };
  const node = (cwd, script, args = []) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env, timeout: 300_000 });
    if (result.status !== 0) throw new Error(`node ${script} failed: ${result.stdout}${result.stderr}`);
    return result;
  };
  const configure = (dir, name) => {
    git(dir, ["config", "user.name", name]);
    git(dir, ["config", "user.email", `${name}@example.test`]);
  };

  const seed = join(root, "seed");
  for (const path of sources ? SOURCES : MINIMAL_SOURCES) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    cpSync(join(repoRoot, path), join(seed, path), { recursive: true });
  }
  mkdirSync(join(seed, "scripts", "pstack-pi"), { recursive: true });
  for (const name of SCRIPTS) {
    cpSync(join(repoRoot, "scripts", "pstack-pi", name), join(seed, "scripts", "pstack-pi", name));
  }
  writeFileSync(join(seed, "scripts", "generate-pstack-harness-trees.mjs"), CANARY);
  writeFileSync(join(seed, "README.md"), "# fixture fork\n");
  if (sources) node(seed, join(seed, "scripts", "pstack-pi", "generate.mjs"), ["--root", seed]);

  git(seed, ["init", "-b", "main"]);
  configure(seed, "fixture");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "fixture: base snapshot"]);
  const baseSha = git(seed, ["rev-parse", "HEAD"]).stdout.trim();

  const origin = join(root, "origin.git");
  git(root, ["init", "--bare", "-b", "main", "origin.git"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "origin", "main"]);

  // The upstream fixture shares the base snapshot so merges have history, the way a fork does.
  const upstream = join(root, "upstream.git");
  git(root, ["clone", "--bare", origin, "upstream.git"]);
  const upstreamWork = join(root, "upstream-work");
  git(root, ["clone", upstream, "upstream-work"]);
  configure(upstreamWork, "upstream");
  applyUpstreamChange(upstreamWork, upstreamChange);
  git(upstreamWork, ["add", "-A"]);
  git(upstreamWork, ["commit", "-m", `upstream: ${upstreamChange}`]);
  git(upstreamWork, ["push", "origin", "main"]);
  const upstreamSha = git(upstreamWork, ["rev-parse", "HEAD"]).stdout.trim();

  if (mainAdvanced) {
    const note = sources ? join(seed, "pstack", "docs", "guide", "fork-note.md") : join(seed, "fork-note.md");
    writeFileSync(note, "# Fork note\n\nAdded on the fork's main after the upstream baseline.\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "fork: main advance"]);
    git(seed, ["push", "origin", "main"]);
  }
  const mainSha = git(seed, ["rev-parse", "HEAD"]).stdout.trim();

  let candidateSha;
  if (candidate !== "absent") {
    const candidateWork = join(root, "candidate-work");
    git(root, ["clone", origin, "candidate-work"]);
    configure(candidateWork, "candidate");
    git(candidateWork, ["checkout", "-b", "pi-candidate"]);
    if (candidate === "upToDate") {
      git(candidateWork, ["fetch", upstream, "main"]);
      git(candidateWork, ["merge", "--no-edit", "FETCH_HEAD"]);
      node(candidateWork, join(candidateWork, "scripts", "pstack-pi", "generate.mjs"), ["--root", candidateWork]);
    } else {
      applyCandidateChange(candidateWork, candidate);
    }
    git(candidateWork, ["add", "-A"]);
    git(candidateWork, ["commit", "-m", "candidate: previous deliverable"]);
    git(candidateWork, ["push", "origin", "HEAD:refs/heads/pi-candidate"]);
    candidateSha = git(candidateWork, ["rev-parse", "HEAD"]).stdout.trim();
  }

  const prepareRunner = join(root, "prepare-runner");
  const validateRunner = join(root, "validate-runner");
  const publishRunner = join(root, "publish-runner");
  for (const runner of [prepareRunner, validateRunner, publishRunner]) git(root, ["clone", origin, runner]);
  git(prepareRunner, ["remote", "add", "upstream", upstream]);

  let raceSha;
  if (race) {
    const raceWork = join(root, "race-work");
    git(root, ["clone", origin, "race-work"]);
    configure(raceWork, "racer");
    if (candidate === "absent") git(raceWork, ["checkout", "-b", "pi-candidate"]);
    else git(raceWork, ["checkout", "--track", "origin/pi-candidate"]);
    writeFileSync(join(raceWork, "race.txt"), "another run pushed this commit\n");
    git(raceWork, ["add", "-A"]);
    git(raceWork, ["commit", "-m", "race: competing candidate commit"]);
    raceSha = git(raceWork, ["rev-parse", "HEAD"]).stdout.trim();
    const hook = join(publishRunner, ".git", "hooks", "pre-push");
    writeFileSync(
      hook,
      `#!/bin/sh\ngit -C ${JSON.stringify(raceWork)} push origin HEAD:refs/heads/pi-candidate >/dev/null 2>&1\nexit 0\n`,
    );
    chmodSync(hook, 0o755);
  }

  let advanceCommand;
  if (advanceUpstreamOnPrList) {
    const script = join(root, "advance-upstream.sh");
    const target = join(upstreamWork, "pstack", "skills", "why", "SKILL.md");
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '\\nUpstream moved after this round started.\\n' >> ${JSON.stringify(target)}\n` +
        `git -C ${JSON.stringify(upstreamWork)} add -A\n` +
        `git -C ${JSON.stringify(upstreamWork)} commit -m "upstream: later commit" >/dev/null\n` +
        `git -C ${JSON.stringify(upstreamWork)} push origin main >/dev/null 2>&1\n` +
        `git -C ${JSON.stringify(upstreamWork)} rev-parse HEAD > ${JSON.stringify(join(root, "advanced-sha"))}\n`,
    );
    chmodSync(script, 0o755);
    advanceCommand = `sh ${JSON.stringify(script)}`;
  }

  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(root, "pr-lists.json"), `${JSON.stringify(prLists)}\n`);
  writeFileSync(join(root, "gh-log.jsonl"), "");

  const staging = {
    prepared: join(root, "staging", "prepared"),
    validateInput: join(root, "staging", "validate-input"),
    validated: join(root, "staging", "validated"),
    publishPrepared: join(root, "staging", "publish-prepared"),
    publishValidated: join(root, "staging", "publish-validated"),
  };
  const markerDir = join(root, "markers");
  const runUrl = "https://github.com/toomanyopenfiles/plugins/actions/runs/12345";

  const baseEnv = (extra = {}) => ({
    ...env,
    PATH: `${bin}:${env.PATH}`,
    FAKE_GH_LOG: join(root, "gh-log.jsonl"),
    FAKE_GH_STATE: join(root, "gh-state.json"),
    FAKE_GH_PR_LISTS: join(root, "pr-lists.json"),
    ...(advanceCommand ? { FAKE_GH_ON_LIST: advanceCommand } : {}),
    PSTACK_PI_RUN_URL: runUrl,
    PSTACK_PI_TRIGGER: "schedule",
    ...extra,
  });

  const spawnStage = (runner, args, stageEnv, outputFile) => {
    rmSync(outputFile, { force: true });
    const result = spawnSync(process.execPath, [join(runner, "scripts", "pstack-pi", "sync.mjs"), ...args], {
      cwd: runner,
      encoding: "utf8",
      env: stageEnv,
      timeout: 600_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (output.includes("fixture-write-token") || output.includes("fixture-read-token")) {
      throw new Error(`a fixture token reached the stage output:\n${output}`);
    }
    return { status: result.status, output, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  /**
   * Run one stage as a separate checkout with only the staged files handed across, the way the
   * workflow passes artifacts between jobs. The validate and publish runners never see the
   * candidate working tree of another stage.
   */
  const fixture = {
    root,
    env,
    seed,
    origin,
    upstream,
    upstreamWork,
    runners: { prepare: prepareRunner, validate: validateRunner, publish: publishRunner },
    staging,
    shas: { base: baseSha, main: mainSha, upstream: upstreamSha, candidate: candidateSha, race: raceSha },
    runUrl,
    markerDir,
    git,
    runPrepare(extra = {}) {
      rmSync(staging.prepared, { recursive: true, force: true });
      mkdirSync(staging.prepared, { recursive: true });
      const outputFile = join(root, "prepare-output.txt");
      const result = spawnStage(
        prepareRunner,
        ["prepare", "--staging", staging.prepared],
        baseEnv({ GITHUB_TOKEN: "fixture-read-token", GITHUB_OUTPUT: outputFile, ...extra }),
        outputFile,
      );
      const outcome = existsSync(outputFile)
        ? /(?:^|\n)outcome=(\S+)/.exec(readFileSync(outputFile, "utf8"))?.[1]
        : undefined;
      return { ...result, outcome, prepared: staging.prepared };
    },
    runValidate(extra = {}) {
      rmSync(staging.validateInput, { recursive: true, force: true });
      rmSync(staging.validated, { recursive: true, force: true });
      if (existsSync(staging.prepared)) cpSync(staging.prepared, staging.validateInput, { recursive: true });
      mkdirSync(staging.validated, { recursive: true });
      const result = spawnStage(
        validateRunner,
        ["validate", "--staging", staging.validateInput, "--output", staging.validated],
        baseEnv({ PSTACK_PI_MARKER_DIR: markerDir, ...extra }),
        join(root, "validate-output.txt"),
      );
      return { ...result, input: staging.validateInput, outputDir: staging.validated };
    },
    /** Copy the staged files the way the publish job downloads its artifacts, without running it. */
    stageForPublish() {
      rmSync(staging.publishPrepared, { recursive: true, force: true });
      rmSync(staging.publishValidated, { recursive: true, force: true });
      if (existsSync(staging.prepared)) cpSync(staging.prepared, staging.publishPrepared, { recursive: true });
      if (existsSync(staging.validated)) cpSync(staging.validated, staging.publishValidated, { recursive: true });
      return { prepared: staging.publishPrepared, validated: staging.publishValidated };
    },
    runPublish(extra = {}) {
      if (!existsSync(staging.publishPrepared) && !existsSync(staging.publishValidated)) fixture.stageForPublish();
      const result = spawnStage(
        publishRunner,
        ["publish", "--prepared", staging.publishPrepared, "--validated", staging.publishValidated],
        baseEnv({ GH_TOKEN: "fixture-write-token", ...extra }),
        join(root, "publish-output.txt"),
      );
      return { ...result, prepared: staging.publishPrepared, validated: staging.publishValidated };
    },
    runRound(extra = {}) {
      const prepare = fixture.runPrepare(extra.prepare);
      if (prepare.outcome !== "proceed") return { prepare };
      const validate = fixture.runValidate(extra.validate);
      if (validate.status !== 0) return { prepare, validate };
      const publish = fixture.runPublish(extra.publish);
      return { prepare, validate, publish };
    },
    plan() {
      return JSON.parse(readFileSync(join(staging.prepared, "plan.json"), "utf8"));
    },
    result() {
      return JSON.parse(readFileSync(join(staging.validated, "result.json"), "utf8"));
    },
    ghCalls() {
      return readFileSync(join(root, "gh-log.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    pullRequestsCreated() {
      return fixture.ghCalls().filter((call) => call.args[0] === "pr" && call.args[1] === "create");
    },
    pullRequestLists() {
      return fixture.ghCalls().filter((call) => call.args[0] === "pr" && call.args[1] === "list");
    },
    advancedSha() {
      const path = join(root, "advanced-sha");
      return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
    },
    canaryRan() {
      return existsSync(join(seed, "harness-generator-canary.txt")) || existsSync(join(prepareRunner, "harness-generator-canary.txt"));
    },
    candidateScriptRan() {
      return existsSync(markerDir) && readdirSafe(markerDir).length > 0;
    },
    fileAt(ref, path) {
      return git(origin, ["show", `${ref}:${path}`], true);
    },
    contains(ref, sha) {
      return git(origin, ["merge-base", "--is-ancestor", sha, ref], true).status === 0;
    },
    tip(branch = "pi-candidate") {
      const result = git(origin, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], true);
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    branchHead(runner) {
      const result = git(runner, ["rev-parse", "--abbrev-ref", "HEAD"], true);
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    /** Forge a validated package bundle, so a test can prove the publish stage rejects it. */
    forgePackage({ mutate, commits = 1 }) {
      const plan = fixture.plan();
      const work = mkdtempSync(join(tmpdir(), "pstack-pi-forge-"));
      try {
        git(work, ["init", "-b", "forge"]);
        git(work, ["fetch", join(staging.prepared, "candidate.bundle"), "refs/heads/pi-candidate:refs/heads/pi-candidate"]);
        git(work, ["checkout", "pi-candidate"]);
        mutate(work);
        git(work, ["add", "-A"]);
        configure(work, "forged");
        git(work, ["commit", "-m", "forged validated package"]);
        for (let index = 1; index < commits; index += 1) {
          writeFileSync(join(work, OUTPUT, "forged-extra.md"), "forged extra commit\n");
          git(work, ["add", "-A"]);
          git(work, ["commit", "-m", `forged extra commit ${index}`]);
        }
        const tip = git(work, ["rev-parse", "HEAD"]).stdout.trim();
        const bundle = join(staging.validated, "package.bundle");
        rmSync(bundle, { force: true });
        git(work, ["bundle", "create", bundle, "refs/heads/pi-candidate", "--not", plan.candidateTip]);
        const resultPath = join(staging.validated, "result.json");
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        writeFileSync(
          resultPath,
          JSON.stringify({ ...result, outcome: "ok", step: null, exitCode: 0, regenerated: true, tip, candidateTip: plan.candidateTip }),
        );
        return { tip, bundle };
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
    addPackageFile(dir, path, content) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    addPackageSymlink(dir, path, target) {
      const link = join(dir, path);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
    },
    configure,
  };
  return fixture;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function applyUpstreamChange(dir, kind) {
  const skill = join(dir, "pstack", "skills", "tdd", "SKILL.md");
  if (kind === "skill") {
    writeFileSync(skill, `${readFileSync(skill, "utf8")}\nUpstream note added by the cursor/plugins fixture.\n`);
    return;
  }
  if (kind === "conflict") {
    writeFileSync(skill, readFileSync(skill, "utf8").replace(/^description:.*$/m, "description: Upstream rewrote this line."));
    return;
  }
  if (kind === "missing-source") {
    rmSync(join(dir, "cursor-team-kit", "skills", "deslop"), { recursive: true, force: true });
    return;
  }
  if (kind === "license") {
    const license = join(dir, "pstack", "LICENSE");
    writeFileSync(license, readFileSync(license, "utf8").replace(/^Copyright \(c\).*$/m, "All rights reserved."));
    return;
  }
  if (kind === "tamper-generator" || kind === "tamper-check") {
    const script = kind === "tamper-generator" ? "generate" : "check";
    writeFileSync(skill, `${readFileSync(skill, "utf8")}\nUpstream note added by the cursor/plugins fixture.\n`);
    writeFileSync(join(dir, "scripts", "pstack-pi", `${script}.mjs`), candidateScript(script));
    return;
  }
  throw new Error(`unknown upstream change: ${kind}`);
}

function applyCandidateChange(dir, kind) {
  if (kind === "present") {
    const note = join(dir, "pstack", "docs", "guide", "candidate-note.md");
    mkdirSync(dirname(note), { recursive: true });
    writeFileSync(note, "# Candidate note\n\nCommitted by an earlier candidate round.\n");
    return;
  }
  if (kind === "conflict") {
    const skill = join(dir, "pstack", "skills", "tdd", "SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8").replace(/^description:.*$/m, "description: The candidate rewrote this line."));
    return;
  }
  throw new Error(`unknown candidate change: ${kind}`);
}
