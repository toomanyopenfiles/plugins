import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { roleModelProblems, roleTable, taggedExamples } from "../lib.mjs";
import { makeSource, runScript } from "./helpers.mjs";

const output = "harness/pstack/pi";
const adapter = "docs/harness/pi.md";

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function adapterText(root) {
  return readFileSync(join(root, output, adapter), "utf8");
}

function roleBlock(text) {
  const blocks = taggedExamples(text).get("pstack-models");
  assert.equal(blocks?.length, 1, "the Pi adapter does not carry exactly one role-model example");
  return blocks[0];
}

function skillRoles(root) {
  const source = readFileSync(join(root, "pstack", "skills", "setup-pstack", "SKILL.md"), "utf8");
  const fenced = /^```[a-z]*\n([\s\S]*?)^```$/gm;
  const body = [...source.matchAll(fenced)].map((match) => match[1]).find((candidate) => /^# budget:/m.test(candidate));
  assert.ok(body, "the setup skill no longer carries a role-model example");
  return roleTable(body);
}

// Each row is a setup decision this ticket settles, so the adapter cannot quietly lose one.
const coverage = [
  [/~\/\.pi\/agent\/pstack-models\.md/, "the role-model file defaults to the Pi user agent directory"],
  [/provider\/model-id:level/, "the model format is provider/model-id:level"],
  [/\boff\b[^\n]*\bminimal\b[^\n]*\blow\b[^\n]*\bmedium\b[^\n]*\bhigh\b[^\n]*\bxhigh\b[^\n]*\bmax\b/, "Pi's thinking levels are listed"],
  [/unlimited[^\n]*max[^\n]*large[^\n]*xhigh[^\n]*medium[^\n]*high[^\n]*small[^\n]*medium/i, "the four budgets map to Pi levels"],
  [/full role table[^\n]*panel|panel[^\n]*run count/i, "the full role table and panel run count are kept"],
  [/one child per entry|entry count is the run count/i, "a panel entry runs one child"],
  [/confirmation|confirm/i, "the user confirmation step is kept"],
  [/not a cross-model review/, "repeating one model is not a cross-model review"],
  [/inherit-parent/, "inherit-parent is mapped"],
  [/\bauto\b/, "auto is kept as an alias"],
  [/omit `model`/, "an unset role omits model"],
  [/Pi resolves its normal default/, "an unset role follows host resolution"],
  [/never fall back to the slug|never .*Cursor slug/i, "a missing role does not fall back to a Cursor slug"],
  [/report the role|Report a configured value that fails/i, "an explicit configuration failure is reported"],
  [/never swap in another model or drop a reasoning level/i, "no silent substitution or downgrade"],
  [/fast: true/, "Pi's fast flag is named"],
  [/service tier/, "fast is a service tier, not a model variant"],
  [/read (?:it|the file) when you dispatch|at dispatch time/i, "the role file is re-read at dispatch"],
  [/not project instructions|never write role lines into project instructions/i, "role lines stay out of project instructions"],
  [/defaultModel/, "the global default model is not changed"],
  [/provider table|alias map|model-resolution extension/i, "no provider table or model resolver is added"],
  [/create-skill/, "the skill-authoring capability is mapped"],
  [/ask the operator to install|pause/i, "a missing authoring capability pauses instead of installing"],
];

test("the adapter documents the Pi role-model file and every setup decision", (t) => {
  const text = adapterText(generated(t));
  for (const [pattern, reason] of coverage) assert.match(text, pattern, `the Pi adapter does not state: ${reason}`);
});

test("the role-model example keeps every upstream role, panel entry, and budget line", (t) => {
  const root = generated(t);
  const source = skillRoles(root);
  const block = roleBlock(adapterText(root));
  assert.deepEqual(roleModelProblems(block, { roles: source }), []);

  const example = roleTable(block);
  const exampleLabels = example.lines.flatMap((line) => line.labels).sort();
  const sourceLabels = source.lines.flatMap((line) => line.labels).sort();
  assert.deepEqual(exampleLabels, sourceLabels, "the role labels do not match the setup skill");
  for (const line of source.lines) {
    const match = example.lines.find((candidate) => candidate.labels.join(",") === line.labels.join(","));
    assert.ok(match, `the example dropped the role ${line.labels.join(", ")}`);
    assert.equal(
      match.values.length,
      line.values.length,
      `the example gave ${line.labels.join(", ")} ${match.values.length} entries instead of ${line.values.length}`,
    );
  }
});

test("a missing role, a shortened panel, or a wrong budget level fails generation", (t) => {
  const fixtures = [
    [
      (text) => text.replace(/^interrogate reviewers: .*$/m, ""),
      /the role example is missing interrogate reviewers/,
    ],
    [
      (text) => text.replace(/^arena runners: [^,\n]+, .*$/m, "arena runners: provider/model-id:xhigh"),
      /the example gave arena runners 1 entries instead of 2/,
    ],
    [
      (text) => text.replace(/^# budget: large \(xhigh\)$/m, "# budget: large (high)"),
      /budget "large" must use level xhigh/,
    ],
  ];
  for (const [index, [mutate, expected]] of fixtures.entries()) {
    const root = makeSource(t);
    const path = join(root, "pstack", "docs", "harness", "pi.md");
    const before = readFileSync(path, "utf8");
    const after = mutate(before);
    assert.notEqual(after, before, `fixture ${index} did not change the role example`);
    writeFileSync(path, after);
    const result = runScript("generate.mjs", ["--root", root]);
    assert.equal(result.status, 1, `fixture ${index} generated`);
    assert.match(result.stderr, expected, `fixture ${index} reported: ${result.stderr}`);
  }
});

test("a role value that is not provider/model-id:level, auto, or inherit-parent is rejected", () => {
  const base = "# budget: large (xhigh)\nfeature, refactoring: ";
  assert.deepEqual(roleModelProblems(`${base}provider/model-id:high\n`), []);
  assert.deepEqual(roleModelProblems(`${base}provider/model-id\n`), []);
  assert.deepEqual(roleModelProblems(`${base}auto\nswarm workers: inherit-parent\n`), []);
  assert.match(roleModelProblems(`${base}grok-4.7-xhigh-fast\n`).join("\n"), /feature, refactoring.*provider\/model-id:level/);
  assert.match(roleModelProblems(`${base}provider/model-id:ultra\n`).join("\n"), /level "ultra".*is not one of Pi's thinking levels/);
  assert.deepEqual(roleModelProblems("# budget: small (medium)\nswarm workers: auto\n"), []);
  assert.match(roleModelProblems("swarm workers: provider/model-id:high\n").join("\n"), /has no # budget line/);
  assert.match(
    roleModelProblems("# budget: large (xhigh)\nswarm workers provider/model-id:high\n").join("\n"),
    /"swarm workers provider\/model-id:high" is not a role: value line/,
  );
});

test("a role that the setup skill does not name is rejected instead of carried", (t) => {
  const root = generated(t);
  const text = `${roleBlock(adapterText(root))}\nretired role: provider/model-id:high\n`;
  assert.match(roleModelProblems(text, { roles: skillRoles(root) }).join("\n"), /names roles the skill no longer has: retired role/);
});

test("the adapter refuses a host difference its setup text does not explain", (t) => {
  const root = makeSource(t);
  const path = join(root, "pstack", "docs", "harness", "pi.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/create-skill/g, "the authoring skill"));
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the Pi adapter does not mention create-skill, used by skills\/poteto-mode/);
});

test("the package README states the setup, the external prerequisites, and the boundaries", (t) => {
  const readme = readFileSync(join(generated(t), output, "README.md"), "utf8");
  assert.match(readme, /## Setup/);
  assert.match(readme, /pstack-models\.md/);
  assert.match(readme, /provider\/model-id:level/);
  assert.match(readme, /docs\/harness\/pi\/mcp-setup\.md/);
  assert.match(readme, /external prerequisite/i);
  assert.match(readme, /Bun/, "the README does not name the Bun prerequisite");
  assert.match(readme, /TLC/, "the README does not name the model-checker prerequisite");
  assert.match(readme, /not .*(?:proof|evidence).*(?:connectivity|dispatch)/i, "the README does not bound what a check proves");
});
