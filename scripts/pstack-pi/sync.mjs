#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUT } from "./lib.mjs";

export const FORK = "toomanyopenfiles/plugins";
export const UPSTREAM = "cursor/plugins";
export const CANDIDATE = "pi-candidate";

/** The GitHub Environment that holds the App private key. Only trusted jobs request it. */
export const WRITE_ENVIRONMENT = "pstack-pi-write";

const PLAN_SCHEMA = 1;
const RESULT_SCHEMA = 1;
const SHA = /^[0-9a-f]{40}$/;
const TOKEN_KEYS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
const BOT = {
  name: "pstack-pi-sync[bot]",
  email: "pstack-pi-sync[bot]@users.noreply.github.com",
};

/**
 * Author and committer for every commit this script creates, ordinary merges included. Passed as
 * both `-c` config and author/committer variables, so a fresh checkout needs no repository, user, or
 * global Git configuration, and no ambient identity on the runner can replace it.
 */
const BOT_IDENTITY = {
  config: ["-c", `user.name=${BOT.name}`, "-c", `user.email=${BOT.email}`],
  env: {
    GIT_AUTHOR_NAME: BOT.name,
    GIT_AUTHOR_EMAIL: BOT.email,
    GIT_COMMITTER_NAME: BOT.name,
    GIT_COMMITTER_EMAIL: BOT.email,
  },
};

/** Captured failure output crosses a job boundary and reaches a pull request, so it is bounded. */
export const MAX_DIAGNOSTIC_CHARS = 4000;

export class SyncError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SyncError";
    this.exitCode = exitCode;
  }
}

export function defaultRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Everything the round needs, from the environment only. No credential is ever written down. */
export function readConfig(env = {}) {
  const config = {
    repository: env.PSTACK_PI_REPOSITORY || FORK,
    baseBranch: env.PSTACK_PI_BASE_BRANCH || "main",
    candidateBranch: env.PSTACK_PI_CANDIDATE_BRANCH || CANDIDATE,
    upstreamRemote: env.PSTACK_PI_UPSTREAM_REMOTE || "upstream",
    upstreamBranch: env.PSTACK_PI_UPSTREAM_BRANCH || "main",
    trigger: env.PSTACK_PI_TRIGGER || "local",
    runUrl: env.PSTACK_PI_RUN_URL || "",
  };
  if (config.repository === UPSTREAM) {
    throw new SyncError(
      `refusing to run against the read-only upstream repository ${UPSTREAM}; the sync target is the fork ${FORK}`,
      2,
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new SyncError(`PSTACK_PI_REPOSITORY must be owner/name, got ${JSON.stringify(config.repository)}`, 2);
  }
  for (const key of ["baseBranch", "candidateBranch", "upstreamRemote", "upstreamBranch"]) {
    if (!config[key] || /\s/.test(config[key])) {
      throw new SyncError(`${key} must be a single ref name without whitespace`, 2);
    }
  }
  return config;
}

/**
 * The untrusted build and check run through these two scripts from trusted `main`; the merged
 * candidate tree is only ever data for them. No token ever reaches the child environment.
 */
export function validationEnv(env = {}) {
  const scrubbed = { ...env };
  for (const key of TOKEN_KEYS) delete scrubbed[key];
  return scrubbed;
}

/** Only a rejected push means another writer won the race; everything else is a real failure. */
export function classifyPushFailure(text = "") {
  return /non-fast-forward|fetch first|\[rejected\]|failed to push some refs/i.test(text) ? "race" : "error";
}

function short(sha) {
  return (sha ?? "").slice(0, 12);
}

function describe(pullRequests) {
  return pullRequests.map((pr) => `#${pr.number}${pr.isDraft ? " (draft)" : ""}`).join(", ");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path, what) {
  if (!existsSync(path)) throw new SyncError(`${what} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SyncError(`${what} is not valid JSON: ${path}`);
  }
}

/**
 * Bound one captured stream, keeping the tail where a failure usually prints its cause. Control
 * characters are dropped so the text stays readable data in a log line and in a PR body.
 */
function boundedDiagnostic(value) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (text.length <= MAX_DIAGNOSTIC_CHARS) return { text, truncated: false };
  return { text: text.slice(-MAX_DIAGNOSTIC_CHARS), truncated: true };
}

function diagnosticOf(run) {
  const stdout = boundedDiagnostic(run.stdout);
  const stderr = boundedDiagnostic(run.stderr);
  return { stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated };
}

/**
 * Print captured output as inert text. The per-line prefix keeps a `::` at the start of a line from
 * being read as a workflow command, and nothing here is ever passed to a shell.
 */
function logInert(log, label, text) {
  if (!text.trim()) return;
  log(`--- ${label} (captured output, inert text; never executed) ---`);
  for (const line of text.split("\n")) log(`| ${line}`);
  log(`--- end ${label} ---`);
}

/** Fence captured text with more backticks than it contains, so it cannot end the block early. */
function fenced(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function diagnosticFence(diagnostics) {
  const sections = [];
  if (diagnostics.stderr.trim() !== "") sections.push(`stderr:\n${diagnostics.stderr.trim()}`);
  if (diagnostics.stdout.trim() !== "") sections.push(`stdout:\n${diagnostics.stdout.trim()}`);
  return fenced(sections.length > 0 ? sections.join("\n\n") : "(the failed step printed no output)");
}

function expect(condition, message) {
  if (!condition) throw new SyncError(message);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function setStepOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (path) appendFileSync(path, `${name}=${value}\n`);
}

function gitRunner(cwd, env) {
  return (args, overrides) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env: overrides ? { ...env, ...overrides } : env, timeout: 300_000 });
    if (result.error) throw new SyncError(`cannot run git: ${result.error.message}`);
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function gitOrFail(git, args, what, overrides) {
  const result = git(args, overrides);
  if (result.status !== 0) {
    throw new SyncError(`${what} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function revParse(git, ref) {
  const result = git(["rev-parse", "--verify", "--quiet", ref]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export function ghClient({ config, env }) {
  const run = (args) => {
    const result = spawnSync("gh", args, { encoding: "utf8", env, timeout: 120_000 });
    if (result.error) throw new SyncError(`cannot run gh: ${result.error.message}`);
    if (result.status !== 0) {
      throw new SyncError(`gh ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout ?? "";
  };
  return {
    /**
     * Any open candidate pull request freezes the branch. The query deliberately does not filter
     * on a base branch: the spec freezes the branch for a draft or ready candidate PR, and a
     * candidate opened against another base still makes the branch a review target.
     */
    openCandidatePullRequests() {
      const output = run([
        "pr",
        "list",
        "--repo",
        config.repository,
        "--head",
        config.candidateBranch,
        "--state",
        "open",
        "--json",
        "number,url,isDraft,title,state",
        "--limit",
        "100",
      ]);
      let pullRequests;
      try {
        pullRequests = JSON.parse(output);
      } catch {
        throw new SyncError(`gh pr list did not return JSON: ${output.trim()}`);
      }
      if (!Array.isArray(pullRequests)) throw new SyncError("gh pr list did not return a list of pull requests");
      return pullRequests.filter((pr) => (pr.state ?? "OPEN").toUpperCase() === "OPEN");
    },
    createPullRequest({ title, body, draft }) {
      const dir = mkdtempSync(join(tmpdir(), "pstack-pi-sync-pr-"));
      try {
        const file = join(dir, "body.md");
        writeFileSync(file, body);
        const args = [
          "pr",
          "create",
          "--repo",
          config.repository,
          "--base",
          config.baseBranch,
          "--head",
          config.candidateBranch,
          "--title",
          title,
          "--body-file",
          file,
        ];
        if (draft) args.push("--draft");
        const output = run(args).trim();
        const url = /https?:\/\/\S+/.exec(output)?.[0];
        if (!url) throw new SyncError(`gh pr create did not print a pull request URL: ${output}`);
        return { url };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Cross-job data. Only fixed file names, and every field is re-validated before it is used.
// ---------------------------------------------------------------------------------------------

export function readPlan(dir, config) {
  const plan = readJson(join(dir, "plan.json"), "the prepared plan");
  expect(plan && typeof plan === "object" && !Array.isArray(plan), "the prepared plan is not an object");
  expect(plan.schema === PLAN_SCHEMA, `the prepared plan has an unknown schema: ${JSON.stringify(plan.schema)}`);
  expect(
    plan.repository === config.repository,
    `the prepared plan targets ${JSON.stringify(plan.repository)}, not ${config.repository}`,
  );
  expect(plan.baseBranch === config.baseBranch, "the prepared plan has a different base branch");
  expect(plan.candidateBranch === config.candidateBranch, "the prepared plan has a different candidate branch");
  expect(plan.outcome === "proceed" || plan.outcome === "frozen", `the prepared plan has an unknown outcome: ${JSON.stringify(plan.outcome)}`);
  expect(SHA.test(plan.pinned ?? ""), "the prepared plan has no pinned upstream commit");
  expect(SHA.test(plan.baseTip ?? ""), "the prepared plan has no base tip");
  expect(plan.previousCandidateTip === null || SHA.test(plan.previousCandidateTip ?? ""), "the prepared plan has an invalid previous candidate tip");
  expect(plan.candidateTip === null || SHA.test(plan.candidateTip ?? ""), "the prepared plan has an invalid candidate tip");
  expect(typeof plan.hasNewCommits === "boolean", "the prepared plan has no hasNewCommits flag");
  if (plan.outcome === "proceed") expect(SHA.test(plan.candidateTip ?? ""), "the prepared plan proceeds without a candidate tip");
  return plan;
}

export function readResult(dir, config, plan) {
  const result = readJson(join(dir, "result.json"), "the validated result");
  expect(result && typeof result === "object" && !Array.isArray(result), "the validated result is not an object");
  expect(result.schema === RESULT_SCHEMA, `the validated result has an unknown schema: ${JSON.stringify(result.schema)}`);
  expect(result.outcome === "ok" || result.outcome === "failed", `the validated result has an unknown outcome: ${JSON.stringify(result.outcome)}`);
  expect(result.step === null || result.step === "generate" || result.step === "check", "the validated result has an unknown failed step");
  expect(Number.isInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode <= 127, "the validated result has an invalid exit code");
  expect(typeof result.regenerated === "boolean", "the validated result has no regenerated flag");
  if (result.outcome === "failed") {
    const diagnostics = result.diagnostics;
    expect(
      diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics),
      "the validated result has no failure diagnostics",
    );
    expect(
      typeof diagnostics.stdout === "string" && typeof diagnostics.stderr === "string" && typeof diagnostics.truncated === "boolean",
      "the validated result has invalid failure diagnostics",
    );
    expect(
      diagnostics.stdout.length <= MAX_DIAGNOSTIC_CHARS && diagnostics.stderr.length <= MAX_DIAGNOSTIC_CHARS,
      "the validated result carries oversized failure diagnostics",
    );
  } else {
    expect(result.diagnostics === null || result.diagnostics === undefined, "a successful result carries failure diagnostics");
  }
  expect(SHA.test(result.candidateTip ?? ""), "the validated result has no candidate tip");
  expect(result.candidateTip === plan.candidateTip, "the validated result belongs to a different candidate tip");
  expect(result.tip === null || SHA.test(result.tip ?? ""), "the validated result has an invalid tip");
  if (result.outcome === "ok" && result.regenerated) {
    expect(SHA.test(result.tip ?? ""), "a regenerated result carries no commit");
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Stage 1 (trusted control plane): pin the round, respect the freeze, merge the branch.
// ---------------------------------------------------------------------------------------------

export function runPrepare({ root = defaultRoot(), staging, env = process.env, log = console.log }) {
  const config = readConfig(env);
  const git = gitRunner(root, env);
  const github = ghClient({ config, env });
  ensureDir(staging);

  log(`prepare round for ${config.repository} on ${config.candidateBranch}, triggered by ${config.trigger}`);
  assertTargetRemote();

  const plan = {
    schema: PLAN_SCHEMA,
    outcome: "proceed",
    repository: config.repository,
    baseBranch: config.baseBranch,
    candidateBranch: config.candidateBranch,
    pinned: pinUpstream(),
    baseTip: "",
    previousCandidateTip: null,
    candidateTip: null,
    hasNewCommits: false,
  };

  const open = github.openCandidatePullRequests();
  if (open.length > 0) {
    const message = `a candidate pull request is already open (${describe(open)}); stopping without writing ${config.candidateBranch}. A manual run does not unfreeze it; merge or close the open pull request first.`;
    plan.outcome = "frozen";
    writeJson(join(staging, "plan.json"), plan);
    setStepOutput("outcome", "frozen");
    log(message);
    return { status: "frozen", exitCode: 0, message };
  }

  gitOrFail(git, ["fetch", "--no-tags", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], "fetching origin");
  const baseTip = revParse(git, `refs/remotes/origin/${config.baseBranch}`);
  expect(baseTip, `origin/${config.baseBranch} is missing; cannot build a candidate on it`);
  const previousCandidateTip = revParse(git, `refs/remotes/origin/${config.candidateBranch}`);
  plan.baseTip = baseTip;
  plan.previousCandidateTip = previousCandidateTip ?? null;

  // `checkout -B` only rebuilds the local branch pointer from the fetched remote branch.
  // The remote candidate branch is never reset and never force-pushed.
  const checkout = git(["checkout", "-B", config.candidateBranch, previousCandidateTip ? `refs/remotes/origin/${config.candidateBranch}` : `refs/remotes/origin/${config.baseBranch}`]);
  if (checkout.status !== 0) {
    throw new SyncError(`cannot check out ${config.candidateBranch}; the checkout must be clean: ${(checkout.stderr || checkout.stdout).trim()}`);
  }
  log(`working on ${config.candidateBranch} from ${previousCandidateTip ? "the existing branch" : `origin/${config.baseBranch}`}`);
  fetchUpstream();

  const startHead = revParse(git, "HEAD");
  const conflict =
    mergeInto(`refs/remotes/origin/${config.baseBranch}`, `origin/${config.baseBranch}`) ??
    mergeInto(plan.pinned, `${UPSTREAM}@${short(plan.pinned)}`);
  if (conflict) {
    const message = `merge conflict while merging ${conflict.label}; stopped, aborted the merge, and nothing was pushed. Resolve it by hand on ${config.candidateBranch}.`;
    setStepOutput("outcome", "conflict");
    log(message);
    return { status: "conflict", exitCode: 1, message };
  }
  const candidateTip = revParse(git, "HEAD");
  plan.candidateTip = candidateTip;
  plan.hasNewCommits = previousCandidateTip ? previousCandidateTip !== candidateTip : true;
  log(
    startHead === candidateTip
      ? `${config.candidateBranch} already had main and ${UPSTREAM}@${short(plan.pinned)}`
      : `merged main and ${UPSTREAM}@${short(plan.pinned)} into ${config.candidateBranch}`,
  );

  gitOrFail(
    git,
    ["bundle", "create", join(staging, "candidate.bundle"), `refs/heads/${config.candidateBranch}`],
    "packing the merged candidate branch",
  );
  writeJson(join(staging, "plan.json"), plan);
  setStepOutput("outcome", "proceed");
  log(`prepared ${short(plan.candidateTip)} for an untrusted build and check`);
  return { status: "proceed", exitCode: 0, plan };

  function assertTargetRemote() {
    const url = git(["remote", "get-url", "origin"]).stdout.trim();
    const github = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(url);
    if (github && github[1].toLowerCase() !== config.repository.toLowerCase()) {
      throw new SyncError(`origin points at ${github[1]}, not the sync target ${config.repository}`, 2);
    }
  }

  function pinUpstream() {
    const result = git(["ls-remote", "--exit-code", "--heads", config.upstreamRemote, `refs/heads/${config.upstreamBranch}`]);
    if (result.status !== 0) {
      throw new SyncError(`cannot resolve ${config.upstreamRemote}/${config.upstreamBranch}: ${(result.stderr || result.stdout).trim()}`);
    }
    const sha = /^([0-9a-f]{40})\t/m.exec(result.stdout)?.[1];
    if (!sha) throw new SyncError(`cannot parse an upstream commit from: ${result.stdout.trim()}`);
    log(`pinned ${UPSTREAM}@${sha} for this round`);
    return sha;
  }

  function fetchUpstream() {
    const refspec = `+refs/heads/${config.upstreamBranch}:refs/remotes/${config.upstreamRemote}/${config.upstreamBranch}`;
    gitOrFail(git, ["fetch", "--no-tags", config.upstreamRemote, refspec], `fetching ${config.upstreamRemote}`);
    const present = () => git(["cat-file", "-e", `${plan.pinned}^{commit}`]).status === 0;
    if (!present()) {
      const direct = git(["fetch", "--no-tags", config.upstreamRemote, plan.pinned]);
      if (direct.status !== 0 || !present()) {
        throw new SyncError(`the pinned upstream commit ${plan.pinned} is not fetchable; refusing to follow a moving upstream`);
      }
    }
    log(`kept ${UPSTREAM}@${short(plan.pinned)} as this round's target even if upstream moved`);
  }

  function mergeInto(ref, label) {
    const result = git(
      [
        ...BOT_IDENTITY.config,
        "merge",
        "--no-edit",
        "-m",
        `sync: merge ${label} into ${config.candidateBranch}`,
        ref,
      ],
      BOT_IDENTITY.env,
    );
    if (result.status === 0) return undefined;

    // A failed merge is a source conflict only when Git actually stopped with unmerged index
    // entries. Anything else - a missing identity, a hook, bad configuration, a broken repository -
    // is reported with its own diagnostic, so the run names the cause the operator has to fix.
    const inMerge = git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).status === 0;
    const unmerged = inMerge ? git(["ls-files", "--unmerged"]) : undefined;
    const conflicted = inMerge && unmerged.status === 0 && unmerged.stdout.trim() !== "";
    if (inMerge) git(["merge", "--abort"]);
    const output = `${result.stderr}\n${result.stdout}`.trim();
    if (conflicted) return { label, output };
    throw new SyncError(
      `merging ${label} into ${config.candidateBranch} failed without leaving a source conflict to resolve: ${output || "git printed no diagnostic"}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 2 (no credentials, separate runner): build and check the merged tree with trusted code.
// ---------------------------------------------------------------------------------------------

export function runValidate({ root = defaultRoot(), staging, output, env = process.env, log = console.log }) {
  const config = readConfig(env);
  const plan = readPlan(staging, config);
  ensureDir(output);
  if (plan.outcome !== "proceed") {
    log(`nothing to build or check: the prepared round is ${plan.outcome}`);
    return { status: "skipped", exitCode: 0 };
  }

  const work = mkdtempSync(join(tmpdir(), "pstack-pi-candidate-"));
  try {
    const prepareGit = gitRunner(root, env);
    gitOrFail(prepareGit, ["init", "-b", "pstack-pi-build", work], "creating the build directory");
    const git = gitRunner(work, env);
    gitOrFail(
      git,
      ["fetch", "--no-tags", join(staging, "candidate.bundle"), `+refs/heads/${config.candidateBranch}:refs/heads/${config.candidateBranch}`],
      "fetching the prepared candidate branch",
    );
    const tip = revParse(git, `refs/heads/${config.candidateBranch}`);
    expect(tip === plan.candidateTip, "the prepared bundle does not carry the planned candidate tip");
    gitOrFail(git, ["checkout", config.candidateBranch], "checking out the merged candidate");

    const generate = runTrusted(root, "generate", work, env);
    const check = generate.status === 0 ? runTrusted(root, "check", work, env) : undefined;
    const failed = generate.status !== 0 ? generate : check && check.status !== 0 ? check : undefined;
    const failure = failed
      ? { step: generate.status !== 0 ? "generate" : "check", exitCode: failed.status, diagnostics: diagnosticOf(failed) }
      : undefined;

    const result = {
      schema: RESULT_SCHEMA,
      outcome: failure ? "failed" : "ok",
      step: failure?.step ?? null,
      exitCode: failure?.exitCode ?? 0,
      regenerated: false,
      tip: plan.candidateTip,
      candidateTip: plan.candidateTip,
      diagnostics: failure?.diagnostics ?? null,
    };

    if (failure) {
      log(`${failure.step} failed (exit ${failure.exitCode}); the merged source stays and the package is not updated`);
      logInert(log, `${failure.step} stdout`, failure.diagnostics.stdout);
      logInert(log, `${failure.step} stderr`, failure.diagnostics.stderr);
      if (failure.diagnostics.truncated) {
        log(`(each captured stream is bounded to its last ${MAX_DIAGNOSTIC_CHARS} characters)`);
      }
    } else {
      log("the package builds and the static check passes");
      gitOrFail(git, ["add", "-A", "--", OUTPUT], `staging ${OUTPUT}`);
      if (git(["diff", "--cached", "--quiet"]).status !== 0) {
        gitOrFail(
          git,
          [...BOT_IDENTITY.config, "commit", "-m", `sync: regenerate the Pi package for ${UPSTREAM}@${short(plan.pinned)}`],
          "committing the regenerated package",
          BOT_IDENTITY.env,
        );
        result.regenerated = true;
        result.tip = revParse(git, "HEAD");
        gitOrFail(
          git,
          ["bundle", "create", join(output, "package.bundle"), `refs/heads/${config.candidateBranch}`, "--not", plan.candidateTip],
          "packing the regenerated package",
        );
      }
    }

    writeJson(join(output, "result.json"), result);
    log(
      result.regenerated
        ? `validated ${short(result.tip)} as a regenerated package`
        : `validated ${short(plan.candidateTip)} without a package change`,
    );
    return { status: result.outcome, exitCode: 0, result };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  /** Run a script from trusted `main` against the merged tree, which is only data to it. */
  function runTrusted(trustedRoot, script, targetRoot, childEnv) {
    const name = `${script}.mjs`;
    const result = spawnSync(process.execPath, [join(trustedRoot, "scripts", "pstack-pi", name), "--root", targetRoot], {
      cwd: trustedRoot,
      encoding: "utf8",
      env: validationEnv(childEnv),
      timeout: 600_000,
    });
    if (result.error) throw new SyncError(`cannot run ${name}: ${result.error.message}`);
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 3 (trusted publish, Environment-gated App token): verify the data, push, open the PR.
// ---------------------------------------------------------------------------------------------

export function runPublish({ root = defaultRoot(), prepared, validated, env = process.env, log = console.log }) {
  const config = readConfig(env);
  const git = gitRunner(root, env);
  const github = ghClient({ config, env });
  assertTargetRemote();

  const plan = readPlan(prepared, config);
  if (plan.outcome !== "proceed") {
    log(`nothing to publish: the prepared round is ${plan.outcome}`);
    return { status: "frozen", exitCode: 0 };
  }
  const result = readResult(validated, config, plan);

  gitOrFail(git, ["bundle", "verify", join(prepared, "candidate.bundle")], "verifying the prepared bundle");
  gitOrFail(
    git,
    ["fetch", "--no-tags", join(prepared, "candidate.bundle"), `+refs/heads/${config.candidateBranch}:refs/remotes/prepared/${config.candidateBranch}`],
    "fetching the prepared candidate branch",
  );
  const preparedTip = revParse(git, `refs/remotes/prepared/${config.candidateBranch}`);
  expect(preparedTip === plan.candidateTip, "the prepared bundle does not carry the planned candidate tip");

  let target = plan.candidateTip;
  if (result.outcome === "ok" && result.regenerated) {
    gitOrFail(git, ["bundle", "verify", join(validated, "package.bundle")], "verifying the validated package bundle");
    gitOrFail(
      git,
      ["fetch", "--no-tags", join(validated, "package.bundle"), `+refs/heads/${config.candidateBranch}:refs/remotes/validated/${config.candidateBranch}`],
      "fetching the validated package",
    );
    const validatedTip = revParse(git, `refs/remotes/validated/${config.candidateBranch}`);
    expect(validatedTip === result.tip, "the validated bundle does not carry the reported commit");
    verifyPackageCommit(validatedTip, plan.candidateTip);
    target = validatedTip;
  }

  if (!plan.hasNewCommits && target === plan.candidateTip) {
    const message = `no candidate changes for ${UPSTREAM}@${short(plan.pinned)}; nothing was pushed and no pull request was opened`;
    log(message);
    return { status: "unchanged", exitCode: 0, message };
  }

  const beforePush = github.openCandidatePullRequests();
  if (beforePush.length > 0) {
    const message = `a candidate pull request is already open (${describe(beforePush)}); stopping without writing ${config.candidateBranch}. A manual run does not unfreeze it; merge or close the open pull request first.`;
    log(message);
    return { status: "frozen", exitCode: 0, message };
  }

  pushCandidate();

  const afterPush = github.openCandidatePullRequests();
  if (afterPush.length > 0) {
    const message = `a candidate pull request appeared while this run pushed (${describe(afterPush)}); not opening a second pull request`;
    log(message);
    return { status: "frozen", exitCode: 0, message };
  }

  const draft = result.outcome === "failed";
  const title = pullRequestTitle({ pinned: plan.pinned, stale: draft });
  const body = draft
    ? failurePullRequestBody({
        config,
        pinned: plan.pinned,
        step: result.step,
        exitCode: result.exitCode,
        runUrl: config.runUrl,
        diagnostics: result.diagnostics,
      })
    : pullRequestBody({ config, pinned: plan.pinned });
  const pullRequest = github.createPullRequest({ title, body, draft });
  const message = draft
    ? `kept the merged source and opened draft ${pullRequest.url}; the committed package is marked as out of sync with this round's source`
    : `pushed ${config.candidateBranch} and opened ${pullRequest.url}`;
  log(message);
  return { status: draft ? "draft" : "created", exitCode: draft ? 1 : 0, message, url: pullRequest.url };

  function assertTargetRemote() {
    const url = git(["remote", "get-url", "origin"]).stdout.trim();
    const github = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(url);
    if (github && github[1].toLowerCase() !== config.repository.toLowerCase()) {
      throw new SyncError(`origin points at ${github[1]}, not the sync target ${config.repository}`, 2);
    }
  }

  /**
   * Accept only a single commit on top of the prepared candidate that touches nothing outside the
   * generated package and uses ordinary file modes. Candidate content is data, never code, and
   * this repository never checks it out, so no candidate configuration or hook can run here.
   */
  function verifyPackageCommit(tip, parent) {
    const parents = gitOrFail(git, ["rev-list", "--parents", "-n", "1", tip], "reading the validated commit").stdout.trim().split(" ");
    expect(parents.length === 2 && parents[1] === parent, "the validated commit is not a single commit on top of the prepared candidate");
    const changed = gitOrFail(git, ["diff", "--name-only", parent, tip], "reading the validated changes").stdout.split("\n").filter(Boolean);
    expect(changed.length > 0, "the validated commit changes nothing");
    for (const path of changed) {
      expect(path === OUTPUT || path.startsWith(`${OUTPUT}/`), `the validated commit touches ${path}, outside ${OUTPUT}`);
    }
    for (const line of gitOrFail(git, ["diff", "--raw", parent, tip], "reading the validated file modes").stdout.split("\n").filter(Boolean)) {
      const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]\d*\t(.+)$/.exec(line);
      expect(match, `the validated commit has an unexpected diff entry: ${line}`);
      const [, before, after, path] = match;
      for (const mode of [before, after]) {
        expect(
          mode === "100644" || mode === "100755" || mode === "000000",
          `the validated commit uses file mode ${mode} for ${path}; only regular files are accepted`,
        );
      }
    }
  }

  function pushCandidate() {
    const result = git(["push", "origin", `${target}:refs/heads/${config.candidateBranch}`]);
    if (result.status === 0) {
      log(`pushed ${config.candidateBranch} with an ordinary push`);
      return;
    }
    const text = `${result.stderr}\n${result.stdout}`;
    if (classifyPushFailure(text) === "race") {
      throw new SyncError(
        `push race: origin/${config.candidateBranch} moved after this run checked it; stopping without a force push. Re-run the sync to merge on top of it.`,
      );
    }
    throw new SyncError(`pushing ${config.candidateBranch} failed: ${text.trim()}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Pull request text.
// ---------------------------------------------------------------------------------------------

export function pullRequestTitle({ pinned, stale = false }) {
  return stale
    ? `Pi candidate sync (draft: package not regenerated): ${UPSTREAM}@${short(pinned)}`
    : `Pi candidate sync: ${UPSTREAM}@${short(pinned)}`;
}

export function pullRequestBody({ config, pinned }) {
  return `Automated Pi candidate sync for \`${config.candidateBranch}\`.

- Pinned upstream commit: \`${UPSTREAM}@${pinned}\`
- Fork base merged into the branch: \`${config.repository}@${config.baseBranch}\`
- Package rebuilt and checked in a separate credential-free job, with \`node scripts/pstack-pi/generate.mjs\` and \`node scripts/pstack-pi/check.mjs\` taken from \`main\`

Review the committed package (\`${OUTPUT}/\`) and merge normally when it is ready. The \`${config.candidateBranch}\` branch stays after the merge.

While this pull request is open, draft or not, the sync workflow stops before it touches the branch, so the review target does not change underneath you. A manual run does not unfreeze it.

No model, product agent, MCP server, or remote workflow ran in this sync; the package was only built and statically checked.
`;
}

export function failurePullRequestBody({ config, pinned, step, exitCode, runUrl, diagnostics }) {
  const script = step === "check" ? "check.mjs" : "generate.mjs";
  const captured = diagnostics
    ? `\nThe failing step's captured output (at most the last ${MAX_DIAGNOSTIC_CHARS} characters per stream) is inert text, kept as data only:\n\n${diagnosticFence(diagnostics)}\n`
    : "";
  return `Draft: this pull request is NOT a new candidate.

The merged source is committed on \`${config.candidateBranch}\`, but the Pi package was not rebuilt, so \`${OUTPUT}/\` here is the previous package and is out of sync with this round's source. Do not review it as a candidate for \`${UPSTREAM}@${pinned}\`.

- Pinned upstream commit: \`${UPSTREAM}@${pinned}\`
- Failed step: \`node scripts/pstack-pi/${script}\` (exit ${Number.isInteger(exitCode) ? exitCode : 1})
${runUrl ? `- Workflow log: ${runUrl}\n` : ""}${captured}
Fix the failure on \`${config.candidateBranch}\` with ordinary commits, then re-run the checks. Nothing from the failed build was committed and nothing was force-pushed.

No model, product agent, MCP server, or remote workflow ran in this sync; the package build and the static check are the only steps.
`;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new SyncError(`${name} needs a directory`, 2);
  return resolve(value);
}

function main() {
  const args = process.argv.slice(2);
  const [stage] = args;
  try {
    if (stage === "prepare") {
      const staging = flag(args, "--staging");
      if (!staging) throw new SyncError("prepare needs --staging <dir>", 2);
      process.exit(runPrepare({ staging }).exitCode);
    }
    if (stage === "validate") {
      const staging = flag(args, "--staging");
      const output = flag(args, "--output");
      if (!staging || !output) throw new SyncError("validate needs --staging <dir> --output <dir>", 2);
      process.exit(runValidate({ staging, output }).exitCode);
    }
    if (stage === "publish") {
      const prepared = flag(args, "--prepared");
      const validated = flag(args, "--validated");
      if (!prepared || !validated) throw new SyncError("publish needs --prepared <dir> --validated <dir>", 2);
      process.exit(runPublish({ prepared, validated }).exitCode);
    }
    throw new SyncError("usage: sync.mjs <prepare|validate|publish> [flags]", 2);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exit(error instanceof SyncError ? error.exitCode : 1);
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
