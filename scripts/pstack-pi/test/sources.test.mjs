import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assertTreeUnchanged, makeSource, runScript, treeState } from "./helpers.mjs";

function assertFails(root, pattern) {
  const before = treeState(join(root, "harness"));
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1, `generation should fail with ${pattern}`);
  assert.match(result.stderr, pattern);
  assertTreeUnchanged(assert, before, treeState(join(root, "harness")), "a failed generation wrote files");
}

test("missing required pstack sources fails explicitly and writes nothing", (t) => {
  const root = makeSource(t);
  rmSync(join(root, "pstack", "skills"), { recursive: true });
  assertFails(root, /missing required source directory: pstack\/skills/);
});

test("a missing bundled skill fails explicitly", (t) => {
  const root = makeSource(t);
  rmSync(join(root, "cursor-team-kit", "skills", "control-cli"), { recursive: true });
  assertFails(root, /missing required bundled skill: cursor-team-kit\/skills\/control-cli/);
});

test("missing licenses fail explicitly", (t) => {
  const pstack = makeSource(t);
  rmSync(join(pstack, "pstack", "LICENSE"));
  assertFails(pstack, /missing required source pstack\/LICENSE/);

  const team = makeSource(t);
  rmSync(join(team, "cursor-team-kit", "LICENSE"));
  assertFails(team, /missing required source cursor-team-kit\/LICENSE/);
});

test("a missing guide or upstream README fails explicitly", (t) => {
  const guide = makeSource(t);
  rmSync(join(guide, "pstack", "docs", "guide"), { recursive: true });
  assertFails(guide, /missing required source pstack\/docs\/guide/);

  const readme = makeSource(t);
  rmSync(join(readme, "pstack", "README.md"));
  assertFails(readme, /missing required source pstack\/README.md/);
});

test("a skill name conflict between pstack and a bundled skill fails explicitly", (t) => {
  const root = makeSource(t);
  mkdirSync(join(root, "pstack", "skills", "deslop"));
  writeFileSync(
    join(root, "pstack", "skills", "deslop", "SKILL.md"),
    "---\nname: deslop\ndescription: Duplicate of the bundled skill.\n---\n\n# Duplicate\n",
  );
  assertFails(root, /skill name conflict: deslop/);
});

test("a directory under pstack/skills without SKILL.md fails instead of being skipped", (t) => {
  const root = makeSource(t);
  mkdirSync(join(root, "pstack", "skills", "half-skill"));
  writeFileSync(join(root, "pstack", "skills", "half-skill", "README.md"), "not a skill\n");
  assertFails(root, /pstack\/skills\/half-skill is not a skill directory with a SKILL\.md/);
});
