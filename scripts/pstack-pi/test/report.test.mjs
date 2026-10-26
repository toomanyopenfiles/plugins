import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./helpers.mjs";

const repo = "toomanyopenfiles/plugins";
const token = "test-token";
const head = "a".repeat(40);
const newerHead = "b".repeat(40);
const workflowPath = ".github/workflows/pstack-pi-validate.yml";

/**
 * A synthetic GitHub API for the report path. It records every request so a test can
 * assert that a stale or untrusted run wrote nothing, and it never reaches a real remote.
 */
async function startApi(t, options = {}) {
  const state = {
    head: options.head ?? head,
    headRef: options.headRef ?? "pi-candidate",
    baseRef: options.baseRef ?? "main",
    headRepo: options.headRepo ?? repo,
    pullState: options.pullState ?? "open",
    comments: options.comments ?? [],
    headChanges: options.headChanges ?? {},
    pullReads: 0,
    nextCommentId: 500,
    requests: [],
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    state.requests.push({ method: req.method, path: url.pathname, query: url.search, body });

    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "bad credentials" });

    if (req.method === "GET" && url.pathname === `/repos/${repo}/pulls/7`) {
      state.pullReads += 1;
      if (state.headChanges[state.pullReads]) state.head = state.headChanges[state.pullReads];
      return send(200, {
        number: 7,
        state: state.pullState,
        head: { sha: state.head, ref: state.headRef, repo: { full_name: state.headRepo } },
        base: { ref: state.baseRef },
      });
    }

    if (req.method === "GET" && url.pathname === `/repos/${repo}/issues/7/comments`) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      return send(200, state.comments.slice((page - 1) * perPage, page * perPage));
    }

    if (req.method === "POST" && url.pathname === `/repos/${repo}/issues/7/comments`) {
      const comment = { id: state.nextCommentId++, body: JSON.parse(body).body, user: { type: "Bot" } };
      state.comments.push(comment);
      return send(201, comment);
    }

    const update = new RegExp(`^/repos/${repo}/issues/comments/(\\d+)$`).exec(url.pathname);
    if (req.method === "PATCH" && update) {
      const comment = state.comments.find((candidate) => candidate.id === Number(update[1]));
      if (!comment) return send(404, { message: "not found" });
      comment.body = JSON.parse(body).body;
      return send(200, comment);
    }

    send(404, { message: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { url: `http://127.0.0.1:${server.address().port}`, state };
}

function reportArgs(api, overrides = {}) {
  const runId = overrides["run-id"] ?? "100";
  const values = {
    repo,
    pr: "7",
    head,
    outcome: "success",
    "run-id": runId,
    "run-attempt": "1",
    "run-url": `https://github.com/${repo}/actions/runs/${runId}`,
    "source-event": "pull_request",
    "source-branch": "pi-candidate",
    "source-base": "main",
    "source-repo": repo,
    "source-workflow": workflowPath,
    "api-url": api.url,
    ...overrides,
  };
  const args = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    args.push(`--${key}`, String(value));
  }
  return args;
}

// spawnSync would block this process and the in-process fixture server could not answer.
function runReport(api, overrides = {}, env = { GH_TOKEN: token }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(repoRoot, "scripts", "pstack-pi", "report.mjs"), ...reportArgs(api, overrides)], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function writes(state) {
  return state.requests.filter((request) => request.method !== "GET");
}

test("a passing validation creates one report comment with the head and Actions log link", async (t) => {
  const api = await startApi(t);
  const result = await runReport(api);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(api.state.comments.length, 1);
  const body = api.state.comments[0].body;
  assert.match(body, /<!-- pstack-pi-candidate-report -->/);
  assert.match(body, /Result: \*\*passed\*\*/);
  assert.match(body, /trusted `workflow_run` entry/);
  assert.match(body, /never executed with the App write token/);
  assert.ok(body.includes(head), "the report does not name the checked head");
  assert.ok(body.includes(`https://github.com/${repo}/actions/runs/100`), "the report does not link the Actions log");
  assert.deepEqual(
    writes(api.state).map((request) => `${request.method} ${request.path}`),
    [`POST /repos/${repo}/issues/7/comments`],
  );
});

test("a failing validation updates the existing report comment instead of adding another", async (t) => {
  const existing = {
    id: 42,
    user: { type: "Bot" },
    body: [
      "<!-- pstack-pi-candidate-report -->",
      `<!-- pstack-pi-candidate-report-state head=${head} run=99 attempt=1 -->`,
      "",
      "old report",
    ].join("\n"),
  };
  const api = await startApi(t, { comments: [existing] });
  const result = await runReport(api, { outcome: "failure" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(api.state.comments.length, 1);
  assert.match(api.state.comments[0].body, /Result: \*\*failed\*\*/);
  assert.doesNotMatch(api.state.comments[0].body, /old report/);
  assert.deepEqual(
    writes(api.state).map((request) => `${request.method} ${request.path}`),
    [`PATCH /repos/${repo}/issues/comments/42`],
  );
});

test("a timed-out validation is reported as failed and a skipped run as skipped", async (t) => {
  const api = await startApi(t);
  const timedOut = await runReport(api, { outcome: "timed_out" });
  assert.equal(timedOut.status, 0, timedOut.stderr);
  assert.match(api.state.comments[0].body, /Result: \*\*failed\*\*/);

  const skipped = await runReport(api, { outcome: "skipped", "run-id": "101" });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(api.state.comments[0].body, /Result: \*\*skipped\*\*/);
});

test("a source that is not the trusted candidate event is ignored before the API call", async (t) => {
  const api = await startApi(t);

  for (const overrides of [
    { "source-event": "push" },
    { "source-branch": "other" },
    { "source-base": "release" },
    { "source-repo": "someone/fork" },
    { "source-workflow": ".github/workflows/other.yml" },
  ]) {
    const result = await runReport(api, overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skip: untrusted-source/);
  }

  assert.equal(api.state.comments.length, 0);
  assert.deepEqual(api.state.requests, []);
});

test("a pull request that is not the open pi-candidate branch into main is ignored", async (t) => {
  for (const options of [{ headRef: "other" }, { baseRef: "release" }, { headRepo: "someone/fork" }]) {
    const api = await startApi(t, options);
    const result = await runReport(api);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skip: not-candidate-pr/);
    assert.equal(api.state.comments.length, 0);
    assert.deepEqual(writes(api.state), []);
  }
});

test("a run whose head is no longer current writes nothing", async (t) => {
  const api = await startApi(t, { head: newerHead });
  const result = await runReport(api);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip: stale-head/);
  assert.equal(api.state.comments.length, 0);
  assert.deepEqual(writes(api.state), []);
});

test("a head that changes before the report write is not overwritten", async (t) => {
  const api = await startApi(t, { headChanges: { 2: newerHead } });
  const result = await runReport(api);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip: stale-head/);
  assert.equal(api.state.comments.length, 0);
  assert.deepEqual(writes(api.state), []);
});

test("duplicate runs for the same head maintain one comment", async (t) => {
  const api = await startApi(t);
  assert.equal((await runReport(api, { "run-id": "100" })).status, 0);
  assert.equal((await runReport(api, { "run-id": "101" })).status, 0);

  assert.equal(api.state.comments.length, 1);
  assert.match(api.state.comments[0].body, /run 101, attempt 1/);
  assert.doesNotMatch(api.state.comments[0].body, /run 100, attempt 1/);
});

test("an older run finishing later does not overwrite a newer run for the same head", async (t) => {
  const api = await startApi(t);
  assert.equal((await runReport(api, { "run-id": "100", "run-attempt": "1" })).status, 0);

  const rerun = await runReport(api, { "run-id": "100", "run-attempt": "2", outcome: "failure" });
  assert.equal(rerun.status, 0);
  assert.match(api.state.comments[0].body, /Result: \*\*failed\*\*/);

  const late = await runReport(api, { "run-id": "100", "run-attempt": "1", outcome: "success" });
  assert.equal(late.status, 0);
  assert.match(late.stdout, /skip: stale-run/);
  assert.equal(api.state.comments.length, 1);
  assert.match(api.state.comments[0].body, /Result: \*\*failed\*\*/);
  assert.match(api.state.comments[0].body, /attempt 2/);
});

test("a report for a previous head cannot replace the newer head report", async (t) => {
  const api = await startApi(t, { head: newerHead });
  assert.equal((await runReport(api, { head: newerHead, "run-id": "200" })).status, 0);

  const late = await runReport(api, { head, "run-id": "201" });
  assert.equal(late.status, 0);
  assert.match(late.stdout, /skip: stale-head/);
  assert.equal(api.state.comments.length, 1);
  assert.ok(api.state.comments[0].body.includes(newerHead));
  assert.doesNotMatch(api.state.comments[0].body, new RegExp(`Head: \`${head}\``));
});

test("candidate-controlled report values are rejected as data, not run as a command", async (t) => {
  const api = await startApi(t);
  const canary = join(repoRoot, "pwned-report-canary");
  rmSync(canary, { force: true });
  t.after(() => rmSync(canary, { force: true }));

  const url = await runReport(api, {
    "run-url": `https://github.com/x/y/actions/runs/1 ); touch ${canary}; #`,
  });
  assert.equal(url.status, 1);
  assert.match(url.stderr, /--run-url/);

  const outcome = await runReport(api, { outcome: `success; touch ${canary}` });
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /unknown validation result/);

  const sha = await runReport(api, { head: `../${head}` });
  assert.equal(sha.status, 1);
  assert.match(sha.stderr, /--head/);

  const source = await runReport(api, { "source-workflow": `other.yml; touch ${canary}` });
  assert.equal(source.status, 0, source.stderr);
  assert.match(source.stdout, /skip: untrusted-source/);

  assert.equal(api.state.comments.length, 0);
  assert.ok(!existsSync(canary), "input text executed as a shell command");
});

test("a report for one run cannot link another run's log", async (t) => {
  const api = await startApi(t);
  const result = await runReport(api, { "run-url": `https://github.com/${repo}/actions/runs/101` });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--run-url/);
  assert.equal(api.state.comments.length, 0);
});

test("the report entry does not print the App token when the API rejects it", async (t) => {
  const api = await startApi(t);
  const result = await runReport(api, {}, { GH_TOKEN: "wrong-token" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /401/);
  assert.doesNotMatch(result.stderr, /wrong-token/);
  assert.doesNotMatch(result.stdout, /wrong-token/);
  assert.deepEqual(writes(api.state), []);
});

test("the report entry requires the App token instead of falling back", async (t) => {
  const api = await startApi(t);
  const result = await runReport(api, {}, { GH_TOKEN: "" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GH_TOKEN is required/);
  assert.deepEqual(api.state.requests, []);
});

test("a closed pull request receives no report write", async (t) => {
  const api = await startApi(t, { pullState: "closed" });
  const result = await runReport(api);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip: pull-not-open/);
  assert.equal(api.state.comments.length, 0);
  assert.deepEqual(writes(api.state), []);
});
