import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The inherited whole-tree generator must never run from the Pi sync path. If it does,
// it leaves this canary behind in the checkout.
const CANARY = `import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "harness-generator-canary.txt"), "called\\n");
console.error("the inherited whole-tree harness generator must not run from the Pi sync");
process.exit(1);
`;

const VALIDATION_ENV_WRAPPER = `import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.PSTACK_PI_TEST_ENV_LOG) {
  writeFileSync(
    process.env.PSTACK_PI_TEST_ENV_LOG,
    JSON.stringify({ GH_TOKEN: process.env.GH_TOKEN ?? null, GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null, PSTACK_PI_GH: process.env.PSTACK_PI_GH ?? null }),
  );
}
const result = spawnSync(process.execPath, [join(here, "generate-real.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
`;

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
 * Build an isolated fixture: a bare `origin` (the fork), a bare `upstream` that shares the
 * fork's history, and a working clone where `sync.mjs` runs. Every push in these fixtures
 * lands in a temporary local bare repository, never a real remote.
 */
export function makeSyncFixture(t, options = {}) {
  const {
    sources = true,
    upstreamChange = "skill",
    candidate = "absent",
    mainAdvanced = true,
    recordValidationEnv = false,
    race = false,
    prLists = [[]],
    advanceUpstreamOnPrList = false,
  } = options;

  const root = mkdtempSync(join(tmpdir(), "pstack-pi-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitConfig = join(root, "gitconfig");
  writeFileSync(gitConfig, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

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
  if (recordValidationEnv) {
    cpSync(join(seed, "scripts", "pstack-pi", "generate.mjs"), join(seed, "scripts", "pstack-pi", "generate-real.mjs"));
    writeFileSync(join(seed, "scripts", "pstack-pi", "generate.mjs"), VALIDATION_ENV_WRAPPER);
  }
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

  const work = join(root, "work");
  git(root, ["clone", origin, "work"]);
  git(work, ["remote", "add", "upstream", upstream]);

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
    const hook = join(work, ".git", "hooks", "pre-push");
    writeFileSync(
      hook,
      `#!/bin/sh\ngit -C ${JSON.stringify(raceWork)} push origin HEAD:refs/heads/pi-candidate >/dev/null 2>&1\nexit 0\n`,
    );
    chmodSync(hook, 0o755);
  }

  let advancedSha;
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

  const fakeGh = join(root, "fake-gh.mjs");
  writeFileSync(fakeGh, FAKE_GH);
  chmodSync(fakeGh, 0o755);
  writeFileSync(join(root, "pr-lists.json"), `${JSON.stringify(prLists)}\n`);
  writeFileSync(join(root, "gh-log.jsonl"), "");

  const fixture = {
    root,
    env,
    seed,
    origin,
    upstream,
    upstreamWork,
    work,
    shas: { base: baseSha, main: mainSha, upstream: upstreamSha, candidate: candidateSha, race: raceSha },
    git,
    validationEnvLog: join(root, "validation-env.json"),
    syncEnv(extra = {}) {
      return {
        ...env,
        GH_TOKEN: "fixture-token-value",
        PSTACK_PI_GH: fakeGh,
        FAKE_GH_LOG: join(root, "gh-log.jsonl"),
        FAKE_GH_STATE: join(root, "gh-state.json"),
        FAKE_GH_PR_LISTS: join(root, "pr-lists.json"),
        ...(advanceCommand ? { FAKE_GH_ON_LIST: advanceCommand } : {}),
        PSTACK_PI_RUN_URL: "https://github.com/toomanyopenfiles/plugins/actions/runs/12345",
        PSTACK_PI_TEST_ENV_LOG: join(root, "validation-env.json"),
        ...extra,
      };
    },
    run(extra = {}) {
      const result = spawnSync(process.execPath, [join(work, "scripts", "pstack-pi", "sync.mjs")], {
        cwd: work,
        encoding: "utf8",
        env: { ...process.env, ...fixture.syncEnv(extra) },
        timeout: 600_000,
      });
      return {
        status: result.status,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    ghCalls() {
      const text = readFileSync(join(root, "gh-log.jsonl"), "utf8");
      return text
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
      return existsSync(join(work, "harness-generator-canary.txt"));
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
  };
  return fixture;
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
