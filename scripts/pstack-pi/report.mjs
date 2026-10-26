#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const MARKER = "<!-- pstack-pi-candidate-report -->";

const STATE = /<!-- pstack-pi-candidate-report-state head=([0-9a-f]{40}) run=(\d+) attempt=(\d+) -->/;
const RESULTS = new Map([
  ["success", "passed"],
  ["failure", "failed"],
  ["cancelled", "cancelled"],
  ["skipped", "skipped"],
]);
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_URL = /^https:\/\/[^\s<>()]+\/actions\/runs\/\d+$/;

export function renderReport({ head, outcome, runId, runAttempt, runUrl }) {
  const result = RESULTS.get(outcome);
  if (!result) throw new Error(`unknown validation result: ${outcome}`);
  if (!SHA.test(head)) throw new Error(`invalid head SHA: ${head}`);
  if (!RUN_URL.test(runUrl)) throw new Error("invalid Actions run URL");
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("run id must be a positive integer");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("run attempt must be a positive integer");
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
    "Validation checks the committed candidate content with a read-only token. It runs the Pi package check and deterministic tests, and does not generate or push back, run real models or product agents, or upload candidate artifacts. This comment is maintained by the report job with the pstack GitHub App; the candidate code is never executed with a write token.",
    "",
  ].join("\n");
  return body;
}

export async function publishReport({ client, expectedHead, outcome, runId, runAttempt, runUrl }) {
  const body = renderReport({ head: expectedHead, outcome, runId, runAttempt, runUrl });
  const pull = await client.getPull();
  if (pull.state !== "open") return { status: "skipped", reason: "pull-not-open" };
  if (pull.head.sha !== expectedHead) return { status: "skipped", reason: "stale-head", head: pull.head.sha };

  const comments = await client.listComments();
  const existing = comments.find((comment) => comment.user?.type === "Bot" && comment.body?.includes(MARKER));
  const previous = existing ? previousState(existing.body) : null;

  // Re-read the head immediately before the only write, so a run that raced a push cannot overwrite it.
  const current = await client.getPull();
  if (current.state !== "open") return { status: "skipped", reason: "pull-not-open" };
  if (current.head.sha !== expectedHead) return { status: "skipped", reason: "stale-head", head: current.head.sha };
  if (previous && isOlder(previous, { runId, runAttempt }) && previous.head === expectedHead) {
    return { status: "skipped", reason: "stale-run" };
  }

  if (existing) {
    const updated = await client.updateComment(existing.id, body);
    return { status: "published", action: "updated", commentId: updated.id ?? existing.id };
  }
  const created = await client.createComment(body);
  return { status: "published", action: "created", commentId: created.id };
}

function previousState(body) {
  const match = STATE.exec(body ?? "");
  if (!match) return null;
  return { head: match[1], runId: Number(match[2]), runAttempt: Number(match[3]) };
}

function isOlder(previous, current) {
  if (previous.runId !== current.runId) return previous.runId > current.runId;
  return previous.runAttempt > current.runAttempt;
}

export function createGitHubClient({ apiUrl = "https://api.github.com", repo, pr, token, fetchImpl = globalThis.fetch }) {
  if (!REPOSITORY.test(repo ?? "") || repo.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("repository must be owner/name");
  }
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
  const allowed = new Set(["repo", "pr", "head", "outcome", "run-id", "run-attempt", "run-url", "api-url"]);
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

  const repo = required("repo");
  if (!REPOSITORY.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("--repo must be owner/name");
  }
  const head = required("head").toLowerCase();
  if (!SHA.test(head)) throw new Error("--head must be a 40-character Git commit SHA");
  const outcome = required("outcome");
  if (!RESULTS.has(outcome)) throw new Error(`unknown validation result: ${outcome}`);
  const runUrl = required("run-url");
  if (!RUN_URL.test(runUrl)) throw new Error("--run-url must be an https Actions run URL");
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
    runId: positiveInteger(required("run-id"), "--run-id"),
    runAttempt: positiveInteger(required("run-attempt"), "--run-attempt"),
    runUrl,
    apiUrl,
    token,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = createGitHubClient({ apiUrl: options.apiUrl, repo: options.repo, pr: options.pr, token: options.token });
  const result = await publishReport({
    client,
    expectedHead: options.head,
    outcome: options.outcome,
    runId: options.runId,
    runAttempt: options.runAttempt,
    runUrl: options.runUrl,
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
