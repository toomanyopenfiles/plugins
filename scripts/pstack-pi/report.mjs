#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const MARKER = "<!-- pstack-pi-candidate-report -->";
export const WORKFLOW_PATH = ".github/workflows/pstack-pi-validate.yml";

const CANDIDATE_BRANCH = "pi-candidate";
const BASE_BRANCH = "main";
const STATE = /<!-- pstack-pi-candidate-report-state head=([0-9a-f]{40}) run=(\d+) attempt=(\d+) -->/;
const RESULTS = new Map([
  ["success", "passed"],
  ["failure", "failed"],
  ["timed_out", "failed"],
  ["startup_failure", "failed"],
  ["action_required", "failed"],
  ["cancelled", "cancelled"],
  ["skipped", "skipped"],
  ["neutral", "skipped"],
  ["stale", "skipped"],
]);
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_URL = /^https:\/\/[^\s<>()]+\/actions\/runs\/\d+$/;

export function renderReport({ head, outcome, runId, runAttempt, runUrl }) {
  const result = RESULTS.get(outcome);
  if (!result) throw new Error(`unknown validation result: ${outcome}`);
  if (!SHA.test(head)) throw new Error(`invalid head SHA: ${head}`);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("run id must be a positive integer");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("run attempt must be a positive integer");
  if (actionsRunIdFromUrl(runUrl) !== runId) throw new Error("Actions run URL must link the validation run id");

  const body = [
    MARKER,
    `<!-- pstack-pi-candidate-report-state head=${head} run=${runId} attempt=${runAttempt} -->`,
    "",
    "## pstack Pi candidate validation",
    "",
    `- Head: \`${head}\``,
    `- Result: **${result}** (validate job: \`${outcome}\`)`,
    `- Actions log: [run ${runId}, attempt ${runAttempt}](${runUrl})`,
    "",
    "Validation checks the committed candidate content with a read-only token. It runs the Pi package check and deterministic tests, and does not generate or push back, run real models or product agents, or upload candidate artifacts. This comment is written from the trusted `workflow_run` entry after verifying that the pull request is still the open `pi-candidate` candidate at the checked head. Candidate code is never executed with the App write token.",
    "",
  ].join("\n");
  return body;
}

export async function publishReport({ repo, client, expectedHead, outcome, runId, runAttempt, runUrl, source }) {
  if (!isTrustedSource({ source, repo })) return { status: "skipped", reason: "untrusted-source" };
  const body = renderReport({ head: expectedHead, outcome, runId, runAttempt, runUrl });

  const pull = await client.getPull();
  const initialProblem = pullProblem(pull, expectedHead, source);
  if (initialProblem) return skippedPull(initialProblem, pull);

  const comments = await client.listComments();
  const existing = comments.find((comment) => comment.user?.type === "Bot" && comment.body?.includes(MARKER));
  const previous = existing ? previousState(existing.body) : null;

  // Re-read the head immediately before the only write, so a run that raced a push cannot overwrite it.
  const current = await client.getPull();
  const currentProblem = pullProblem(current, expectedHead, source);
  if (currentProblem) return skippedPull(currentProblem, current);
  if (previous && previousIsNewer(previous, { runId, runAttempt }) && previous.head === expectedHead) {
    return { status: "skipped", reason: "stale-run" };
  }

  if (existing) {
    const updated = await client.updateComment(existing.id, body);
    return { status: "published", action: "updated", commentId: updated.id ?? existing.id };
  }
  const created = await client.createComment(body);
  return { status: "published", action: "created", commentId: created.id };
}

function isTrustedSource({ source, repo }) {
  return (
    source.event === "pull_request" &&
    source.branch === CANDIDATE_BRANCH &&
    source.base === BASE_BRANCH &&
    source.repo === repo &&
    source.workflow === WORKFLOW_PATH
  );
}

function pullProblem(pull, expectedHead, source) {
  if (pull?.state !== "open") return "pull-not-open";
  if (
    pull?.head?.repo?.full_name !== source.repo ||
    pull?.head?.ref !== source.branch ||
    pull?.base?.ref !== source.base
  ) {
    return "not-candidate-pr";
  }
  if (pull?.head?.sha !== expectedHead) return "stale-head";
  return null;
}

function skippedPull(reason, pull) {
  if (reason === "stale-head") return { status: "skipped", reason, head: pull.head.sha };
  return { status: "skipped", reason };
}

function previousState(body) {
  const match = STATE.exec(body ?? "");
  if (!match) return null;
  return { head: match[1], runId: Number(match[2]), runAttempt: Number(match[3]) };
}

function previousIsNewer(previous, current) {
  if (previous.runId !== current.runId) return previous.runId > current.runId;
  return previous.runAttempt > current.runAttempt;
}

function assertRepo(repo) {
  if (!REPOSITORY.test(repo ?? "") || repo.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("repository must be owner/name");
  }
  return repo;
}

function actionsRunIdFromUrl(runUrl) {
  if (!RUN_URL.test(runUrl)) return null;
  try {
    const match = /\/actions\/runs\/(\d+)$/.exec(new URL(runUrl).pathname);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function createGitHubClient({ apiUrl = "https://api.github.com", repo, pr, token, fetchImpl = globalThis.fetch }) {
  assertRepo(repo);
  if (!Number.isSafeInteger(pr) || pr < 1) throw new Error("pull request number must be a positive integer");
  if (!token) throw new Error("a report token is required");
  const base = apiUrl.replace(/\/+$/, "");

  async function request(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "pstack-pi-report",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed with ${response.status}`);
    return response.json();
  }

  return {
    getPull: () => request("GET", `/repos/${repo}/pulls/${pr}`),
    async listComments() {
      const comments = [];
      for (let page = 1; page <= 100; page += 1) {
        const batch = await request("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
        comments.push(...batch);
        if (batch.length < 100) break;
      }
      return comments;
    },
    createComment: (body) => request("POST", `/repos/${repo}/issues/${pr}/comments`, { body }),
    updateComment: (id, body) => request("PATCH", `/repos/${repo}/issues/comments/${id}`, { body }),
  };
}

function positiveInteger(value, label) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function parseArgs(argv) {
  const allowed = new Set([
    "repo",
    "pr",
    "head",
    "outcome",
    "run-id",
    "run-attempt",
    "run-url",
    "source-event",
    "source-branch",
    "source-base",
    "source-repo",
    "source-workflow",
    "api-url",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    const key = flag.slice(2);
    if (!allowed.has(key)) throw new Error(`unknown option: ${flag}`);
    if (index + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    values.set(key, argv[index + 1]);
  }

  const required = (key) => {
    const value = values.get(key);
    if (!value) throw new Error(`--${key} is required`);
    return value;
  };

  const repo = assertRepo(required("repo"));
  const head = required("head").toLowerCase();
  if (!SHA.test(head)) throw new Error("--head must be a 40-character Git commit SHA");
  const outcome = required("outcome");
  if (!RESULTS.has(outcome)) throw new Error(`unknown validation result: ${outcome}`);
  const runId = positiveInteger(required("run-id"), "--run-id");
  const runAttempt = positiveInteger(required("run-attempt"), "--run-attempt");
  const runUrl = required("run-url");
  if (!RUN_URL.test(runUrl)) throw new Error("--run-url must be an https Actions run URL");
  if (actionsRunIdFromUrl(runUrl) !== runId) throw new Error("--run-url must link the validation run id");

  const source = {
    event: required("source-event"),
    branch: required("source-branch"),
    base: required("source-base"),
    repo: required("source-repo"),
    workflow: required("source-workflow"),
  };

  const apiUrl = values.get("api-url") ?? "https://api.github.com";
  const parsedApiUrl = new URL(apiUrl);
  if (!["http:", "https:"].includes(parsedApiUrl.protocol) || parsedApiUrl.username || parsedApiUrl.password) {
    throw new Error("--api-url must be an http(s) URL without credentials");
  }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required; pass the pstack App token, not the workflow token");

  return {
    repo,
    pr: positiveInteger(required("pr"), "--pr"),
    head,
    outcome,
    runId,
    runAttempt,
    runUrl,
    source,
    apiUrl,
    token,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = createGitHubClient({ apiUrl: options.apiUrl, repo: options.repo, pr: options.pr, token: options.token });
  const result = await publishReport({
    repo: options.repo,
    client,
    expectedHead: options.head,
    outcome: options.outcome,
    runId: options.runId,
    runAttempt: options.runAttempt,
    runUrl: options.runUrl,
    source: options.source,
  });
  if (result.status === "published") {
    console.log(`ok: ${result.action} pstack Pi candidate report for ${options.head} (comment ${result.commentId})`);
  } else {
    console.log(`skip: ${result.reason}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
