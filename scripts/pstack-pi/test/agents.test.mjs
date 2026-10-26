import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeSource, repoRoot, runScript } from "./helpers.mjs";

const output = "harness/pstack/pi";
const agents = ["comment-sicko.md", "helper.md", "poteto-agent.md"];

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

/**
 * Read the flat YAML frontmatter subset pi-subagents 0.81.0 parses: one `key: value`
 * line per field. The agent files this package ships hold no nested maps or block lists.
 */
function split(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, "an agent file starts with frontmatter");
  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (field) fields.set(field[1], field[2].trim());
  }
  return { fields, body: text.slice(match[0].length) };
}

const agentFiles = (root) => readdirSync(join(root, output, "agents")).sort();

test("the manifest declares the native pi-subagents agent directory beside the skills", (t) => {
  const root = generated(t);
  const manifest = JSON.parse(readFileSync(join(root, output, "package.json"), "utf8"));
  assert.deepEqual(manifest["pi-subagents"], { agents: ["./agents"] });
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.ok(!("subagents" in (manifest.pi ?? {})), "the manifest declares the agent directory once");
  for (const path of [...manifest["pi-subagents"].agents, ...manifest.pi.skills]) {
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."), `${path} is not a relative package path`);
    assert.ok(existsSync(join(root, output, path)), `${path} is missing`);
  }
});

test("static discovery finds exactly the three pstack agents", (t) => {
  const root = generated(t);
  assert.deepEqual(agentFiles(root), agents);
  const names = [];
  for (const file of agentFiles(root)) {
    const { fields, body } = split(readFileSync(join(root, output, "agents", file), "utf8"));
    // pi-subagents skips a file without a name or description, then joins package and name.
    assert.equal(`${fields.get("name")}.md`, file, `${file} declares its file name`);
    assert.equal(fields.get("package"), "pstack", `${file} uses the pstack namespace`);
    assert.ok(fields.get("description")?.length > 0, `${file} has no description`);
    assert.ok(body.trim().length > 0, `${file} has no system prompt`);
    names.push(`${fields.get("package")}.${fields.get("name")}`);
  }
  assert.deepEqual(names.sort(), ["pstack.comment-sicko", "pstack.helper", "pstack.poteto-agent"]);
});

test("poteto-agent keeps its job and reads the full poteto-mode skill first", (t) => {
  const root = generated(t);
  const original = readFileSync(join(repoRoot, "pstack", "agents", "poteto-agent.md"), "utf8");
  const { fields, body } = split(readFileSync(join(root, output, "agents", "poteto-agent.md"), "utf8"));
  assert.equal(fields.get("description"), split(original).fields.get("description"), "the description is unchanged");
  assert.match(body, /^\n# Poteto subagent\n/);
  assert.match(body, /Read the `poteto-mode` skill's `SKILL\.md` in full before doing any work/);
  assert.match(body, /You are operating as poteto-mode's full agent style\./);
  assert.match(body, /Navigate to a leaf `principle-\*` skill/);
  assert.match(body, /\]\(\.\.\/docs\/harness\/pi\.md\)/, "the agent points at the Pi adapter");

  // The Cursor plugin lookup is the one platform path this agent names.
  assert.doesNotMatch(body, /~\/\.cursor\/plugins\/|\.cursor-plugin/);
  assert.match(body, /~\/\.pi\/agent\/skills\//);

  // Background work is native async, and nesting is a grant, not an allowlist.
  assert.equal(fields.get("async"), "true");
  assert.equal(fields.get("allowNestedSubagents"), "true");
  assert.equal(fields.get("inheritProjectContext"), "true");
  assert.equal(fields.get("inheritSkills"), "true");
  for (const field of ["is_background", "run_in_background", "model", "thinking", "tools", "extensions", "outputSchema", "maxSubagentDepth"]) {
    assert.ok(!fields.has(field), `poteto-agent must not set ${field}`);
  }
});

test("comment-sicko keeps its first output, its scope, and its report", (t) => {
  const root = generated(t);
  const original = split(readFileSync(join(repoRoot, "pstack", "agents", "comment-sicko.md"), "utf8")).body;
  const { fields, body } = split(readFileSync(join(root, output, "agents", "comment-sicko.md"), "utf8"));
  assert.match(body, /^\n# Comment Sicko\n\nMy first output when spawned is exactly this\.\n\nYes\.\.\. Ha ha ha\.\.\. Yes!\n/);
  for (const line of original.split("\n").filter((text) => text.trim() && !text.startsWith("# Comment Sicko"))) {
    assert.ok(body.includes(line), `comment-sicko lost: ${line}`);
  }
  assert.match(body, /\]\(\.\.\/docs\/harness\/pi\.md\)/, "the agent points at the Pi adapter");
  assert.equal(fields.get("async"), "true");
  assert.equal(fields.get("inheritProjectContext"), "true");
  assert.ok(!fields.has("allowNestedSubagents"), "comment-sicko is not a delegating agent");
  for (const field of ["is_background", "run_in_background", "model", "thinking", "tools", "extensions"]) {
    assert.ok(!fields.has(field), `comment-sicko must not set ${field}`);
  }
});

test("helper stays neutral, inherits context, and delegates natively", (t) => {
  const root = generated(t);
  const { fields, body } = split(readFileSync(join(root, output, "agents", "helper.md"), "utf8"));
  assert.equal(fields.get("systemPromptMode"), "append");
  assert.equal(fields.get("inheritProjectContext"), "true");
  assert.equal(fields.get("inheritGlobalContext"), "true");
  assert.equal(fields.get("inheritSkills"), "true");
  assert.equal(fields.get("async"), "true");
  assert.equal(fields.get("allowNestedSubagents"), "true");
  assert.match(fields.get("description"), /generalPurpose/);
  for (const field of ["model", "thinking", "tools", "excludeTools", "extensions", "subagentOnlyExtensions", "outputSchema", "maxSubagentDepth", "allowedAgents"]) {
    assert.ok(!fields.has(field), `helper must not set ${field}`);
  }
  // The brief decides the role, so the prompt names no persona, model, or provider.
  assert.doesNotMatch(body, /claude-|grok-|gpt-|anthropic|openai/i);
  assert.match(body, /brief/i);
});

test("the original agent sources stay as Cursor ships them", () => {
  for (const file of ["poteto-agent", "comment-sicko"]) {
    const text = readFileSync(join(repoRoot, "pstack", "agents", `${file}.md`), "utf8");
    assert.doesNotMatch(text, /^package: pstack$/m, `${file} source must not carry Pi frontmatter`);
  }
  assert.match(readFileSync(join(repoRoot, "pstack", "agents", "poteto-agent.md"), "utf8"), /^is_background: true$/m);
});

test("generation converts the agent sources from an isolated copy", (t) => {
  const root = generated(t);
  const source = readFileSync(join(root, "pstack", "agents", "poteto-agent.md"), "utf8");
  assert.match(source, /^is_background: true$/m, "generation edits no source agent file");
  for (const file of agentFiles(root)) {
    const text = readFileSync(join(root, output, "agents", file), "utf8");
    assert.doesNotMatch(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} embeds the source root`);
  }
});

test("a missing original agent source fails instead of shipping two agents", (t) => {
  const root = makeSource(t);
  rmSync(join(root, "pstack", "agents", "comment-sicko.md"));
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required source pstack\/agents\/comment-sicko\.md/);
  assert.ok(!existsSync(join(root, output)), "a failed generation wrote a package");
});
