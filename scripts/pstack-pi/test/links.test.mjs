import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeSource, runScript } from "./helpers.mjs";

const output = "harness/pstack/pi";

test("packaged files link locally and unpackaged upstream files keep a GitHub fallback", (t) => {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  const packageDir = join(root, output);

  const help = readFileSync(join(packageDir, "skills", "poteto-help", "SKILL.md"), "utf8");
  assert.match(help, /\]\(\.\.\/\.\.\/README\.upstream\.md\)/);
  assert.match(help, /\]\(\.\.\/\.\.\/docs\/guide\/01-setup\.md\)/);
  assert.match(help, /\]\(https:\/\/github\.com\/cursor\/plugins\/blob\/main\/pstack\/docs\/harness\/claude-code\.md\)/);

  const guide = readFileSync(join(packageDir, "docs", "guide", "07-overnight.md"), "utf8");
  assert.match(guide, /\]\(https:\/\/github\.com\/cursor\/plugins\/blob\/main\/pstack\/automations\/benny\/README\.md\)/);
  assert.match(guide, /\]\(https:\/\/github\.com\/cursor\/plugins\/blob\/main\/pstack\/automations\/benny\/FOR_AGENTS\.md\)/);
  assert.match(guide, /\]\(08-principles\.md\)/);

  // This package ships the three agents, so the guide and README link them locally now.
  const setup = readFileSync(join(packageDir, "docs", "guide", "05-build-and-clean.md"), "utf8");
  assert.match(setup, /\]\(\.\.\/\.\.\/agents\/comment-sicko\.md\)/);

  const upstream = readFileSync(join(packageDir, "README.upstream.md"), "utf8");
  assert.match(upstream, /\]\(docs\/guide\/README\.md\)/);
  assert.match(upstream, /\]\(\.\/agents\/poteto-agent\.md\)/);
  assert.match(upstream, /\]\(https:\/\/github\.com\/cursor\/plugins\/tree\/main\/pstack\/automations\/benny\/\)/);

  // A local link that already works is not rewritten to GitHub.
  assert.doesNotMatch(
    readFileSync(join(packageDir, "docs", "guide", "README.md"), "utf8"),
    /github\.com\/cursor\/plugins.*pstack\/skills\/poteto-help/,
  );
});

test("a dangling relative link fails generation instead of shipping a broken package", (t) => {
  const root = makeSource(t);
  mkdirSync(join(root, "pstack", "skills", "tdd"), { recursive: true });
  writeFileSync(
    join(root, "pstack", "skills", "tdd", "SKILL.md"),
    "---\nname: tdd\ndescription: A broken fixture.\n---\n\nRead [the missing guide](./does-not-exist.md).\n",
  );
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/tdd\/SKILL\.md has a broken relative link: \.\/does-not-exist\.md/);
});

test("a link that escapes the package fails generation", (t) => {
  const root = makeSource(t);
  writeFileSync(
    join(root, "pstack", "skills", "tdd", "SKILL.md"),
    "---\nname: tdd\ndescription: A broken fixture.\n---\n\nRead [outside](../../../../outside.md).\n",
  );
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /links outside the package: \.\.\/\.\.\/\.\.\/\.\.\/outside\.md/);
});
