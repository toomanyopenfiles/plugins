import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeSource, repoRoot, runScript, skillDirs, writeSkill } from "./helpers.mjs";

const output = "harness/pstack/pi";
const note = "In Pi, read [the Pi adapter](../../docs/harness/pi.md)";
const placement = /^# .*\n\nIn Pi, read \[the Pi adapter\]\(\.\.\/\.\.\/docs\/harness\/pi\.md\) before you map a Cursor name\./m;

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function packagedSkills(root) {
  const dir = join(root, output, "skills");
  return skillDirs(dir).map((name) => ({ name, text: readFileSync(join(dir, name, "SKILL.md"), "utf8") }));
}

function noteCount(text) {
  return text.split(note).length - 1;
}

test("an entry prompt points at the adapter only for skills that name a host difference", (t) => {
  const skills = packagedSkills(generated(t));
  const withNote = skills.filter((skill) => noteCount(skill.text) > 0);
  assert.ok(withNote.length > 0, "no skill received the adapter entry");
  assert.ok(withNote.length < skills.length, "every skill received the adapter entry");
  for (const skill of withNote) {
    assert.equal(noteCount(skill.text), 1, `${skill.name} repeats the adapter entry`);
    assert.match(skill.text, placement, `${skill.name} places the adapter entry outside its opening heading`);
  }
});

test("known host differences get the entry prompt and unadapted skills do not", (t) => {
  const skills = new Map(packagedSkills(generated(t)).map((skill) => [skill.name, skill.text]));
  for (const name of ["poteto-mode", "how", "swarm", "reflect"]) {
    assert.equal(noteCount(skills.get(name)), 1, `${name} names Cursor tools but has no adapter entry`);
  }
  for (const name of ["tdd", "deslop", "control-cli", "control-ui"]) {
    assert.equal(noteCount(skills.get(name) ?? ""), 0, `${name} has no known host difference but got the adapter entry`);
  }
});

test("generic wording such as the current session or an approved change is not a host difference", (t) => {
  const root = makeSource(t);
  writeSkill(root, "zzz-generic", "A fixture that talks about sessions and approvals.", "# Generic\n\nCheck the current session, then make the change after it is approved.\n");
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(join(root, output, "skills", "zzz-generic", "SKILL.md"), "utf8");
  assert.equal(noteCount(text), 0);
  assert.match(text, /the current session/);
});

test("a bare cross-skill call gets the entry prompt so the reader maps it, a link does not", (t) => {
  const root = makeSource(t);
  writeSkill(root, "zzz-bare-call", "Runs another skill by name.", "# Bare call\n\nThen run the **how** skill on the diff.\n");
  writeSkill(root, "zzz-linked-call", "Links another skill.", "# Linked call\n\nThen follow [how](../how/SKILL.md) on the diff.\n");
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  const bare = readFileSync(join(root, output, "skills", "zzz-bare-call", "SKILL.md"), "utf8");
  const linked = readFileSync(join(root, output, "skills", "zzz-linked-call", "SKILL.md"), "utf8");
  assert.equal(noteCount(bare), 1);
  assert.equal(noteCount(linked), 0);
});

test("the entry prompt is added to the package only, never to the source skill", (t) => {
  const root = generated(t);
  for (const name of skillDirs(join(root, output, "skills"))) {
    const tree = ["pstack", "cursor-team-kit"].map((top) => join(top, "skills", name)).find((path) => existsSync(join(root, path, "SKILL.md")));
    assert.ok(tree, `${name} has no source skill`);
    const source = readFileSync(join(root, tree, "SKILL.md"), "utf8");
    assert.equal(source, readFileSync(join(repoRoot, tree, "SKILL.md"), "utf8"), `${name} source changed`);
    assert.equal(noteCount(source), 0, `${name} source received the entry prompt`);
  }
});

test("a skill that names a host difference but has no heading fails generation", (t) => {
  const root = makeSource(t);
  writeSkill(root, "zzz-no-heading", "A fixture without a heading.", "Delegate with `Task` and stop.\n");
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/zzz-no-heading\/SKILL\.md names `Task` but has no H1/);
});
