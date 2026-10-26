import assert from "node:assert/strict";
import { appendFileSync, chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assertTreeUnchanged, makeSource, runScript, treeState } from "./helpers.mjs";

const output = "harness/pstack/pi";

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function check(root) {
  return runScript("check.mjs", ["--root", root]);
}

test("a freshly generated package passes the read-only check", (t) => {
  const root = generated(t);
  const before = treeState(root);
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok: \d+ pstack \+ 3 bundled skills/);
  assertTreeUnchanged(assert, before, treeState(root), "check mode wrote to the workspace");
});

test("an ungenerated tree fails with an actionable message", (t) => {
  const root = makeSource(t);
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /harness\/pstack\/pi is missing or empty; run node scripts\/pstack-pi\/generate\.mjs/);
});

test("content drift fails and check still writes nothing", (t) => {
  const root = generated(t);
  appendFileSync(join(root, output, "skills", "tdd", "SKILL.md"), "\nlocal edit\n");
  const before = treeState(root);
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/tdd\/SKILL\.md has different content/);
  assertTreeUnchanged(assert, before, treeState(root), "check mode wrote to the workspace");
});

test("source drift fails without rewriting the generated tree", (t) => {
  const root = generated(t);
  appendFileSync(join(root, "pstack", "skills", "tdd", "SKILL.md"), "\nsource edit\n");
  const before = treeState(join(root, output));
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/tdd\/SKILL\.md has different content/);
  assertTreeUnchanged(assert, before, treeState(join(root, output)), "check mode regenerated the tree");
});

test("executable-bit drift fails", (t) => {
  const root = generated(t);
  chmodSync(join(root, output, "skills", "show-me-your-work", "scripts", "log.sh"), 0o644);
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/show-me-your-work\/scripts\/log\.sh has a different executable bit/);
});

test("a missing generated file fails", (t) => {
  const root = generated(t);
  rmSync(join(root, output, "docs", "guide", "images", "router.jpg"));
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/guide\/images\/router\.jpg is missing/);
});

test("an extra generated file fails", (t) => {
  const root = generated(t);
  writeFileSync(join(root, output, "hand-edited.md"), "not generated\n");
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /harness\/pstack\/pi\/hand-edited\.md is not generated from any source/);
});

test("the manifest's declared paths are checked", (t) => {
  const root = generated(t);
  const path = join(root, output, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.pi.skills = ["./missing-skills"];
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package\.json does not declare pi\.skills as \.\/skills/);
  assert.match(result.stderr, /package\.json declares a missing path: \.\/missing-skills/);
});

test("skill frontmatter and duplicate names are checked", (t) => {
  const root = generated(t);
  const one = join(root, output, "skills", "tdd", "SKILL.md");
  writeFileSync(one, readFileSync(one, "utf8").replace(/^name: tdd$/m, "name: not-tdd"));
  const two = join(root, output, "skills", "bro", "SKILL.md");
  writeFileSync(two, readFileSync(two, "utf8").replace(/^name: bro$/m, "name: not-tdd"));
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/tdd\/SKILL\.md declares name "not-tdd", not its folder tdd/);
  assert.match(result.stderr, /harness\/pstack\/pi\/skills\/tdd and harness\/pstack\/pi\/skills\/bro both declare the skill name not-tdd/);
});

test("a packaged file linked through GitHub is reported instead of accepted", (t) => {
  const root = generated(t);
  const path = join(root, output, "skills", "poteto-help", "SKILL.md");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /\]\(\.\.\/\.\.\/docs\/guide\/01-setup\.md\)/,
      "](https://github.com/cursor/plugins/blob/main/pstack/docs/guide/01-setup.md)",
    ),
  );
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /links to GitHub for packaged docs\/guide\/01-setup\.md/);
});

test("a tampered license fails", (t) => {
  const root = generated(t);
  appendFileSync(join(root, output, "licenses", "cursor-team-kit-LICENSE"), "\nlocal addition\n");
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /licenses\/cursor-team-kit-LICENSE has different content/);
});
