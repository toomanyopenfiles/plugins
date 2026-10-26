#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUT } from "./lib.mjs";

export const FORK = "toomanyopenfiles/plugins";
export const UPSTREAM = "cursor/plugins";
export const CANDIDATE = "pi-candidate";

const DEFAULT_IDENTITY = {
  name: "pstack-pi-sync[bot]",
  email: "pstack-pi-sync[bot]@users.noreply.github.com",
};
const TOKEN_KEYS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

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
    ghCommand: env.PSTACK_PI_GH || "gh",
    trigger: env.PSTACK_PI_TRIGGER || "local",
    runUrl: env.PSTACK_PI_RUN_URL || "",
    commitName: env.PSTACK_PI_COMMIT_NAME || "",
    commitEmail: env.PSTACK_PI_COMMIT_EMAIL || "",
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

/** The package build and the static check never run with repository write credentials. */
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
  return sha.slice(0, 12);
}

function describe(prs) {
  return prs.map((pr) => `#${pr.number}${pr.isDraft ? " (draft)" : ""}`).join(", ");
}

function trimOutput(text = "") {
  const lines = text.trim().split("\n");
  const head = lines.slice(0, 60).join("\n");
  return head.length > 4000 ? `${head.slice(0, 4000)}\n...` : head;
}

export function pullRequestTitle({ pinned, stale = false }) {
  return stale
    ? `Pi candidate sync (draft: package not regenerated): ${UPSTREAM}@${short(pinned)}`
    : `Pi candidate sync: ${UPSTREAM}@${short(pinned)}`;
}

export function pullRequestBody({ config, pinned }) {
  return `Automated Pi candidate sync for \`${config.candidateBranch}\`.

- Pinned upstream commit: \`${UPSTREAM}@${pinned}\`
- Fork base merged into the branch: \`${config.repository}@${config.baseBranch}\`
- Package rebuilt with \`node scripts/pstack-pi/generate.mjs\` and verified with \`node scripts/pstack-pi/check.mjs\`

Review the committed package (\`${OUTPUT}/\`) and merge normally when it is ready. The \`${config.candidateBranch}\` branch stays after the merge.

While this pull request is open, draft or not, the sync workflow stops before it touches the branch, so the review target does not change underneath you. A manual run does not unfreeze it.

No model, product agent, MCP server, or remote workflow ran in this sync; the package was only built and statically checked.
`;
}

export function failurePullRequestBody({ config, pinned, command, output, runUrl }) {
  const script = command === "check" ? "check.mjs" : "generate.mjs";
  return `Draft: this pull request is NOT a new candidate.

The merged source is committed on \`${config.candidateBranch}\`, but the Pi package was not rebuilt, so \`${OUTPUT}/\` here is the previous package and is out of sync with this round's source. Do not review it as a candidate for \`${UPSTREAM}@${pinned}\`.

- Pinned upstream commit: \`${UPSTREAM}@${pinned}\`
- Failed step: \`node scripts/pstack-pi/${script}\`
- Output:

\`\`\`
${trimOutput(output)}
\`\`\`
${runUrl ? `\n- Workflow run with the full log: ${runUrl}\n` : ""}
Fix the failure on \`${config.candidateBranch}\` with ordinary commits, then re-run the checks. Nothing from the failed build was committed and nothing was force-pushed.

No model, product agent, MCP server, or remote workflow ran in this sync; the package build and the static check are the only steps.
`;
}

function gitRunner(root, env) {
  return (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env, timeout: 300_000 });
    if (result.error) throw new SyncError(`cannot run git: ${result.error.message}`);
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

export function ghClient({ config, env }) {
  const run = (args) => {
    const result = spawnSync(config.ghCommand, args, { encoding: "utf8", env, timeout: 120_000 });
    if (result.error) throw new SyncError(`cannot run ${config.ghCommand}: ${result.error.message}`);
    if (result.status !== 0) {
      throw new SyncError(`gh ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout ?? "";
  };
  return {
    openCandidatePullRequests() {
      const output = run([
        "pr",
        "list",
        "--repo",
        config.repository,
        "--head",
        config.candidateBranch,
        "--base",
        config.baseBranch,
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

function runValidation(root, script, env) {
  const name = `${script}.mjs`;
  const result = spawnSync(process.execPath, [join(root, "scripts", "pstack-pi", name), "--root", root], {
    cwd: root,
    encoding: "utf8",
    env: validationEnv(env),
    timeout: 600_000,
  });
  if (result.error) throw new SyncError(`cannot run ${name}: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * One sync round: pin the upstream commit, respect the candidate-PR freeze, merge main and the
 * pinned commit, rebuild and check the package, then publish with an ordinary push and one pull
 * request. Never resets, force-pushes, or commits a half-generated package.
 */
export function runSync(options = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readConfig(env);
  const root = resolve(options.root ?? defaultRoot());
  const log = options.log ?? ((line) => console.log(line));
  const git = options.git ?? gitRunner(root, env);
  const github = options.github ?? ghClient({ config, env });

  const revParse = (ref) => {
    const result = git(["rev-parse", "--verify", "--quiet", ref]);
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const fail = (message, result) =>
    new SyncError(`${message}: ${(result?.stderr || result?.stdout || "").trim()}`);

  const frozen = (pullRequests) => {
    const message = `a candidate pull request is already open (${describe(pullRequests)}); stopping without writing ${config.candidateBranch}. A manual run does not unfreeze it; merge or close the open pull request first.`;
    log(message);
    return { status: "frozen", exitCode: 0, message, pullRequests };
  };

  log(`sync round for ${config.repository} on ${config.candidateBranch}, triggered by ${config.trigger}`);
  assertTargetRemote();

  const pinned = pinUpstream();
  const open = github.openCandidatePullRequests();
  if (open.length > 0) return frozen(open);

  const fetch = git(["fetch", "--no-tags", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  if (fetch.status !== 0) throw fail("fetching origin failed", fetch);
  const baseRef = `refs/remotes/origin/${config.baseBranch}`;
  const candidateRef = `refs/remotes/origin/${config.candidateBranch}`;
  const baseTip = revParse(baseRef);
  if (!baseTip) throw new SyncError(`origin/${config.baseBranch} is missing; cannot build a candidate on it`);
  const previousCandidate = revParse(candidateRef);

  // `checkout -B` only rebuilds the local branch pointer from the fetched remote branch.
  // The remote candidate branch is never reset and never force-pushed.
  const checkout = git(["checkout", "-B", config.candidateBranch, previousCandidate ? candidateRef : baseRef]);
  if (checkout.status !== 0) {
    throw fail(`cannot check out ${config.candidateBranch}; the checkout must be clean`, checkout);
  }
  log(`working on ${config.candidateBranch} from ${previousCandidate ? "the existing branch" : `origin/${config.baseBranch}`}`);
  ensureIdentity();
  fetchUpstream();

  const startHead = revParse("HEAD");
  const conflict =
    mergeInto(baseRef, `origin/${config.baseBranch}`) ?? mergeInto(pinned, `${UPSTREAM}@${short(pinned)}`);
  if (conflict) {
    const message = `merge conflict while merging ${conflict.label}; stopped, aborted the merge, and nothing was pushed. Resolve it by hand on ${config.candidateBranch}.`;
    log(message);
    return { status: "conflict", exitCode: 1, message };
  }
  const mergedHead = revParse("HEAD");
  log(
    startHead === mergedHead
      ? `${config.candidateBranch} already had main and ${UPSTREAM}@${short(pinned)}`
      : `merged main and ${UPSTREAM}@${short(pinned)} into ${config.candidateBranch}`,
  );

  const generate = runValidation(root, "generate", env);
  const check = generate.status === 0 ? runValidation(root, "check", env) : undefined;
  const failure =
    generate.status !== 0
      ? { command: "generate", result: generate }
      : check && check.status !== 0
        ? { command: "check", result: check }
        : undefined;

  if (failure) {
    log(`${failure.command} failed (exit ${failure.result.status}); the merged source stays, the package is not updated`);
    restorePackage();
    assertClean();
    return deliver({ draft: true, failure });
  }
  log("the package builds and the static check passes");

  const staged = git(["add", "-A", "--", OUTPUT]);
  if (staged.status !== 0) throw fail(`cannot stage ${OUTPUT}`, staged);
  const stagedDiff = git(["diff", "--cached", "--quiet"]);
  if (stagedDiff.status !== 0) {
    const commit = git([
      "commit",
      "-m",
      `sync: regenerate the Pi package for ${UPSTREAM}@${short(pinned)}`,
      "-m",
      `Pinned upstream commit: ${pinned}\nGenerated with node scripts/pstack-pi/generate.mjs and verified with node scripts/pstack-pi/check.mjs.`,
    ]);
    if (commit.status !== 0) throw fail("committing the regenerated package failed", commit);
  }
  return deliver({ draft: false });

  function assertTargetRemote() {
    const url = git(["remote", "get-url", "origin"]).stdout.trim();
    const github = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(url);
    if (github && github[1].toLowerCase() !== config.repository.toLowerCase()) {
      throw new SyncError(`origin points at ${github[1]}, not the sync target ${config.repository}`, 2);
    }
  }

  function pinUpstream() {
    const result = git([
      "ls-remote",
      "--exit-code",
      "--heads",
      config.upstreamRemote,
      `refs/heads/${config.upstreamBranch}`,
    ]);
    if (result.status !== 0) {
      throw fail(`cannot resolve ${config.upstreamRemote}/${config.upstreamBranch}`, result);
    }
    const sha = /^([0-9a-f]{40})\t/m.exec(result.stdout)?.[1];
    if (!sha) throw new SyncError(`cannot parse an upstream commit from: ${result.stdout.trim()}`);
    log(`pinned ${UPSTREAM}@${sha} for this round`);
    return sha;
  }

  function ensureIdentity() {
    const configured = (key) => git(["config", `user.${key}`]).stdout.trim();
    if (!configured("name")) git(["config", "user.name", config.commitName || DEFAULT_IDENTITY.name]);
    if (!configured("email")) git(["config", "user.email", config.commitEmail || DEFAULT_IDENTITY.email]);
  }

  function fetchUpstream() {
    const refspec = `+refs/heads/${config.upstreamBranch}:refs/remotes/${config.upstreamRemote}/${config.upstreamBranch}`;
    const result = git(["fetch", "--no-tags", config.upstreamRemote, refspec]);
    if (result.status !== 0) throw fail(`fetching ${config.upstreamRemote} failed`, result);
    const present = () => git(["cat-file", "-e", `${pinned}^{commit}`]).status === 0;
    if (!present()) {
      const direct = git(["fetch", "--no-tags", config.upstreamRemote, pinned]);
      if (direct.status !== 0 || !present()) {
        throw new SyncError(`the pinned upstream commit ${pinned} is not fetchable; refusing to follow a moving upstream`);
      }
    }
    log(`kept ${UPSTREAM}@${short(pinned)} as this round's target even if upstream moved`);
  }

  function mergeInto(ref, label) {
    const result = git(["merge", "--no-edit", "-m", `sync: merge ${label} into ${config.candidateBranch}`, ref]);
    if (result.status === 0) return undefined;
    git(["merge", "--abort"]);
    return { label, output: `${result.stderr}\n${result.stdout}`.trim() };
  }

  function restorePackage() {
    git(["checkout", "--", OUTPUT]);
    git(["clean", "-fdq", "--", OUTPUT]);
  }

  function assertClean() {
    const status = git(["status", "--porcelain", "--untracked-files=all"]);
    if (status.status !== 0) throw fail("reading the checkout status failed", status);
    if (status.stdout.trim()) {
      throw new SyncError(`refusing to push: the checkout has uncommitted changes:\n${status.stdout.trim()}`);
    }
  }

  function pushCandidate() {
    const result = git(["push", "origin", `HEAD:refs/heads/${config.candidateBranch}`]);
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

  function deliver({ draft, failure: buildFailure }) {
    const head = revParse("HEAD");
    const remoteTip = revParse(candidateRef);
    const hasNewCommits = remoteTip ? remoteTip !== head : head !== baseTip;

    if (!hasNewCommits) {
      if (buildFailure) {
        const message = `${buildFailure.command} failed (exit ${buildFailure.result.status}) and there is nothing new to deliver; nothing was pushed and no pull request was opened`;
        log(message);
        return { status: "failed", exitCode: 1, message };
      }
      const message = `no candidate changes for ${UPSTREAM}@${short(pinned)}; nothing was pushed and no pull request was opened`;
      log(message);
      return { status: "unchanged", exitCode: 0, message };
    }

    assertClean();
    const beforePush = github.openCandidatePullRequests();
    if (beforePush.length > 0) return frozen(beforePush);

    pushCandidate();

    const afterPush = github.openCandidatePullRequests();
    if (afterPush.length > 0) {
      const message = `a candidate pull request appeared while this run pushed (${describe(afterPush)}); not opening a second pull request`;
      log(message);
      return { status: "frozen", exitCode: 0, message, pullRequests: afterPush };
    }

    const title = pullRequestTitle({ pinned, stale: draft });
    const body = draft
      ? failurePullRequestBody({
          config,
          pinned,
          command: buildFailure.command,
          output: `${buildFailure.result.stdout}${buildFailure.result.stderr}`,
          runUrl: config.runUrl,
        })
      : pullRequestBody({ config, pinned });
    const pullRequest = github.createPullRequest({ title, body, draft });
    const message = draft
      ? `kept the merged source and opened draft ${pullRequest.url}; the committed package is marked as out of sync with this round's source`
      : `pushed ${config.candidateBranch} and opened ${pullRequest.url}`;
    log(message);
    return { status: draft ? "draft" : "created", exitCode: draft ? 1 : 0, message, url: pullRequest.url };
  }
}

function resolveRoot(args) {
  const index = args.indexOf("--root");
  if (index < 0) return defaultRoot();
  const value = args[index + 1];
  if (!value) throw new SyncError("--root needs a directory", 2);
  return resolve(value);
}

function main() {
  try {
    const root = resolveRoot(process.argv.slice(2));
    const result = runSync({ root });
    process.exit(result.exitCode ?? 0);
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
