import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agentOverrideProblems, mcpPreviewProblems, mcpServersProblems, mergeAgentOverrides, taggedExamples } from "../lib.mjs";
import { makeSource, runScript } from "./helpers.mjs";

const output = "harness/pstack/pi";
const adapter = "docs/harness/pi.md";
const flow = "docs/harness/pi/mcp-setup.md";
const sourceFlow = "pstack/docs/harness/pi/mcp-setup.md";

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function example(text, kind) {
  const blocks = taggedExamples(text).get(kind);
  assert.equal(blocks?.length, 1, `the MCP flow does not carry exactly one ${kind} example`);
  return blocks[0];
}

const servers = {
  mcpServers: {
    docs: { url: "https://mcp.example.com/mcp", description: "Search and read the product documentation" },
    tickets: { command: "npx", args: ["-y", "@example/tickets-mcp"], env: { TICKETS_TOKEN: "${TICKETS_API_TOKEN}" } },
    private: { url: "https://mcp.example.com/private", exposure: "hidden" },
  },
};

// Each row is a decision this ticket settles, so the flow cannot quietly lose one.
const coverage = [
  [/confirm[^\n]*what the (?:user|work) needs|ask which service/i, "the flow confirms the service the user needs first"],
  [/already configured|existing .*server configuration|host already has/i, "the flow uses the host's existing server config"],
  [/~\/\.pi\/agent\/mcp\.json/, "the user-level Pi MCP config is named"],
  [/\.pi\/mcp\.json/, "the project Pi MCP config is named"],
  [/pi-mcp-adapter/, "the adapter case is named"],
  [/do not install (?:an? )?adapter|never install/i, "installing an adapter is not required"],
  [/native MCP|built-in MCP/i, "the built-in MCP path is kept"],
  [/only .*agent that needs|only the agent that needs/i, "only the agent that needs the tool is configured"],
  [/`mcp:<server>\/<tool>`|mcp:<server>\/<tool>/, "the static selection shape is stated"],
  [/strict allowlist/, "the tools list is described as a strict allowlist"],
  [/normal and extension tools/, "normal and extension tools are preserved"],
  [/preview/i, "a preview is shown"],
  [/only the (?:named|fields)|only those fields/i, "only the named fields are merged"],
  [/agentOverrides/, "the override block is named"],
  [/`\/reload`/, "a reload is requested"],
  [/restart/, "a restart is mentioned"],
  [/do not connect|never connect|does not connect/i, "the flow connects nothing"],
  [/\+codemode/, "the +codemode combination is explained"],
  [/0\.81\.0/, "the pi-subagents version is named"],
  [/do not write `\+|never write `\+|not recommended|do not recommend/i, "the +tool form is not recommended"],
  [/synchroniz/i, "no tool-list synchronizer is added"],
  [/not .*(?:proof|evidence).*connect/is, "a passing check is not connectivity proof"],
  [/project instructions|global .*default/i, "the flow keeps out of project instructions and global defaults"],
];

test("the package ships the MCP flow as the one independent adaptation flow", (t) => {
  const root = generated(t);
  assert.equal(readFileSync(join(root, output, flow), "utf8"), readFileSync(join(root, sourceFlow), "utf8"));
  const adapterText = readFileSync(join(root, output, adapter), "utf8");
  assert.match(adapterText, /\]\(pi\/mcp-setup\.md\)/, "the adapter does not link the MCP flow locally");
  const flowText = readFileSync(join(root, output, flow), "utf8");
  assert.match(flowText, /\]\(\.\.\/pi\.md\)/, "the flow does not link back to the adapter");
  assert.doesNotMatch(flowText, /https:\/\/github\.com\/cursor\/plugins\/(?:blob|tree)\/main\/pstack\/docs\/harness/);
});

test("the MCP flow carries every decision this package depends on", (t) => {
  const text = readFileSync(join(generated(t), output, flow), "utf8");
  for (const [pattern, reason] of coverage) assert.match(text, pattern, `the MCP flow does not state: ${reason}`);
});

test("the MCP examples match the host shape and the merge only touches the named tools", (t) => {
  const text = readFileSync(join(generated(t), output, flow), "utf8");
  const config = JSON.parse(example(text, "pstack-mcp-servers"));
  assert.deepEqual(mcpServersProblems(config), []);

  const merge = JSON.parse(example(text, "pstack-agent-overrides-merge"));
  assert.deepEqual(mergeAgentOverrides(merge.before, merge.preview), merge.after, "the documented merge is not what the preview does");
  assert.deepEqual(mcpPreviewProblems(merge.preview, { servers: config.mcpServers }), []);
  assert.deepEqual(agentOverrideProblems(merge.after.subagents.agentOverrides, { servers: config.mcpServers }), []);
  assert.deepEqual(
    merge.after.subagents.agentOverrides["pstack.comment-sicko"],
    merge.before.subagents.agentOverrides["pstack.comment-sicko"],
    "the example changed a role the preview does not name",
  );
  assert.equal(merge.after.defaultModel, merge.before.defaultModel, "the example changed the global default model");
  const tools = merge.after.subagents.agentOverrides["pstack.helper"].tools;
  assert.ok(tools.includes("bash") && tools.includes("fixture_search"), "the example dropped a normal or extension tool");
  assert.ok(tools.some((tool) => tool.startsWith("mcp:")), "the example adds no MCP selection");
});

test("a server entry that the host would reject fails", () => {
  assert.deepEqual(mcpServersProblems(servers), []);
  const cases = [
    [{ mcpServers: { "docs/api": { url: "https://mcp.example.com/mcp" } } }, /"docs\/api" is not a valid server name/],
    [{ mcpServers: { docs: { type: "sse", url: "https://mcp.example.com/mcp" } } }, /removed "sse" transport/],
    [{ mcpServers: { docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer abcdefghijklmnop" } } } }, /literal credential/],
    [{ mcpServers: { docs: {} } }, /needs exactly one of "command" or "url"/],
    [{ mcpServers: { docs: { url: "https://mcp.example.com/mcp", exposure: "always" } } }, /has exposure "always", which is not a tool exposure/],
  ];
  for (const [config, expected] of cases) assert.match(mcpServersProblems(config).join("\n"), expected);
});

test("an override that names a missing server, uses +tools, or drops the normal tools fails", () => {
  assert.deepEqual(agentOverrideProblems({ "pstack.helper": { tools: ["read", "bash", "fixture_search", "mcp:docs/search"] } }, { servers }), []);
  const cases = [
    [
      { "pstack.helper": { tools: ["read", "bash", "mcp:missing/search"] } },
      /"mcp:missing\/search" names a server the configured servers do not define/,
    ],
    [
      { "pstack.helper": { tools: ["read", "bash", "+codemode", "mcp:docs/search"] } },
      /"\+codemode" is not a tool name: pi-subagents 0\.81\.0 reads an agent tools list as a strict allowlist/,
    ],
    [{ "pstack.helper": { tools: ["mcp:docs/search"] } }, /keeps only MCP tools; keep the normal and extension tools/],
    [
      { "pstack.helper": { tools: ["read", "mcp:private/search"] } },
      /"mcp:private\/search" selects a server configured "hidden"/,
    ],
    [{ "pstack.helper": { toolz: ["read"] } }, /"toolz" is not a supported agent override field/],
  ];
  for (const [overrides, expected] of cases) {
    assert.match(agentOverrideProblems(overrides, { servers }).join("\n"), expected);
  }
});

test("the MCP preview merges only the tools field of the named agents", () => {
  const services = servers.mcpServers;
  assert.deepEqual(mcpPreviewProblems({ agentOverrides: { "pstack.helper": { tools: ["read", "mcp:docs/search"] } } }, { servers: services }), []);
  assert.match(
    mcpPreviewProblems({ agentOverrides: { "pstack.helper": { model: "provider/model-id:high" } } }, { servers: services }).join("\n"),
    /the MCP flow merges only the tools field of subagents\.agentOverrides/,
  );
  assert.match(
    mcpPreviewProblems({ subagents: { agentOverrides: {} } }, { servers: services }).join("\n"),
    /the preview is not shaped as \{ "agentOverrides": \{ "<agent>": \{ "tools": \[\.\.\.\] \} \} \}/,
  );
});

test("a broken shipped MCP example fails generation", (t) => {
  const root = makeSource(t);
  const path = join(root, sourceFlow);
  const before = readFileSync(path, "utf8");
  const after = before.replace(/mcp:docs\/search/g, "mcp:missing/search");
  assert.notEqual(after, before);
  writeFileSync(path, after);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /names a server the configured servers do not define/);
});

test("the MCP flow is a required source and a packaged relative link", (t) => {
  const root = makeSource(t);
  rmSync(join(root, sourceFlow));
  const missing = runScript("generate.mjs", ["--root", root]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing required source pstack\/docs\/harness\/pi\/mcp-setup\.md/);

  const second = makeSource(t);
  const adapterPath = join(second, "pstack", "docs", "harness", "pi.md");
  writeFileSync(
    adapterPath,
    readFileSync(adapterPath, "utf8").replace(
      /\]\(pi\/mcp-setup\.md\)/,
      "](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/pi/mcp-setup.md)",
    ),
  );
  const remote = runScript("generate.mjs", ["--root", second]);
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /links to GitHub for packaged docs\/harness\/pi\/mcp-setup\.md/);
});

test("the MCP documents name no local machine path or personal provider", (t) => {
  const root = generated(t);
  for (const path of [adapter, flow]) {
    const text = readFileSync(join(root, output, path), "utf8");
    assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|[A-Za-z]:\\\\/, `${path} names a local path`);
    assert.doesNotMatch(text, /\b(?:github-copilot|anthropic|openai)\/[a-z0-9.-]+/i, `${path} names a personal provider`);
  }
});
