import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeSource, repoRoot, runScript, treeState } from "./helpers.mjs";

const output = "harness/pstack/pi";

function outputState(root) {
  const state = treeState(join(root, output));
  return new Map([...state].map(([path, { bytes, mode }]) => [path, { bytes, mode }]));
}

test("the Pi generate and check entries run no subprocess, so they cannot call the inherited generator", () => {
  for (const name of ["generate.mjs", "check.mjs", "lib.mjs"]) {
    const text = readFileSync(join(repoRoot, "scripts", "pstack-pi", name), "utf8");
    assert.doesNotMatch(text, /node:child_process|spawnSync|spawn\(|execFile|execSync/, `${name} starts a child process`);
  }
});

test("two independent generations from the same sources are identical", (t) => {
  const first = makeSource(t);
  const second = makeSource(t);
  assert.equal(runScript("generate.mjs", ["--root", first]).status, 0);
  assert.equal(runScript("generate.mjs", ["--root", second]).status, 0);
  assert.deepEqual(outputState(first), outputState(second));
});

test("running the generator twice rewrites the same package", (t) => {
  const root = makeSource(t);
  assert.equal(runScript("generate.mjs", ["--root", root]).status, 0);
  const before = outputState(root);
  assert.equal(runScript("generate.mjs", ["--root", root]).status, 0);
  assert.deepEqual(outputState(root), before);
});

test("the generated package records no timestamps or artifact hashes", (t) => {
  const root = makeSource(t);
  assert.equal(runScript("generate.mjs", ["--root", root]).status, 0);
  for (const path of ["README.md", "package.json"]) {
    const text = readFileSync(join(root, output, path), "utf8");
    assert.doesNotMatch(text, /\b20\d\d-\d\d-\d\dT\d\d:\d\d/, `${path} has a timestamp`);
    assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, `${path} has a hash`);
  }
});

test("deleting a source resource leaves no stale output after regeneration", (t) => {
  const root = makeSource(t);
  const note = join(root, "pstack", "skills", "tdd", "unreferenced-note.md");
  writeFileSync(note, "A note no other file links to.\n");
  const temporary = join(root, "pstack", "skills", "zzz-temporary-skill");
  mkdirSync(temporary);
  writeFileSync(
    join(temporary, "SKILL.md"),
    "---\nname: zzz-temporary-skill\ndescription: A temporary fixture skill.\n---\n\n# Temporary\n",
  );
  assert.equal(runScript("generate.mjs", ["--root", root]).status, 0);
  assert.ok(existsSync(join(root, output, "skills", "tdd", "unreferenced-note.md")));
  assert.ok(existsSync(join(root, output, "skills", "zzz-temporary-skill", "SKILL.md")));

  rmSync(note);
  rmSync(temporary, { recursive: true });
  assert.equal(runScript("generate.mjs", ["--root", root]).status, 0);
  assert.ok(!existsSync(join(root, output, "skills", "tdd", "unreferenced-note.md")), "a deleted resource is still in the package");
  assert.ok(!existsSync(join(root, output, "skills", "zzz-temporary-skill")), "a deleted skill is still in the package");
});
