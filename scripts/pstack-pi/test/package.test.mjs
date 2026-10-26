import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assertTreeUnchanged, bundledSkills, makeSource, relativeFiles, runScript, skillDirs, treeState } from "./helpers.mjs";

const output = "harness/pstack/pi";

test("generate builds a self-contained Pi package from the real sources", (t) => {
  const root = makeSource(t);
  const before = treeState(join(root, "harness"));
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);

  const packageDir = join(root, output);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  assert.equal(manifest.name, "pstack");
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.equal(manifest.private, true);

  const pstackSkills = skillDirs(join(root, "pstack", "skills"));
  assert.ok(pstackSkills.length > 0);
  assert.deepEqual(skillDirs(join(packageDir, "skills")), [...pstackSkills, ...bundledSkills].sort());

  for (const source of [...pstackSkills.map((name) => `pstack/skills/${name}`), ...bundledSkills.map((name) => `cursor-team-kit/skills/${name}`)]) {
    const skill = source.split("/").at(-1);
    for (const path of relativeFiles(join(root, source))) {
      const from = join(root, source, path);
      const to = join(packageDir, "skills", skill, path);
      assert.ok(existsSync(to), `${to} is missing`);
      const bytes = readFileSync(from);
      if (path.endsWith(".md")) {
        assert.equal(
          stripGenerated(readFileSync(to, "utf8")),
          stripGenerated(readFileSync(from, "utf8")),
          `${to} changed text outside its link targets and its adapter entry`,
        );
      } else {
        assert.deepEqual(readFileSync(to), bytes, `${to} does not match ${from}`);
      }
      const sourceExecutable = (statMode(from) & 0o111) !== 0;
      const outputExecutable = (statMode(to) & 0o111) !== 0;
      assert.equal(outputExecutable, sourceExecutable, `${to} did not keep its executable bit`);
    }
  }

  for (const path of relativeFiles(join(root, "pstack", "docs", "guide"))) {
    const have = readFileSync(join(packageDir, "docs", "guide", path));
    if (path.endsWith(".md")) {
      assert.ok(have.toString("utf8").trim().length > 0, `docs/guide/${path} is empty`);
    } else {
      assert.deepEqual(have, readFileSync(join(root, "pstack", "docs", "guide", path)), `guide/${path} does not match`);
    }
  }
  assert.deepEqual(
    relativeFiles(join(packageDir, "docs", "guide")),
    relativeFiles(join(root, "pstack", "docs", "guide")),
  );

  assert.equal(readFileSync(join(packageDir, "LICENSE"), "utf8"), readFileSync(join(root, "pstack", "LICENSE"), "utf8"));
  assert.match(readFileSync(join(packageDir, "LICENSE"), "utf8"), /Copyright \(c\) 2026 Lauren Tan/);
  assert.equal(
    readFileSync(join(packageDir, "licenses", "cursor-team-kit-LICENSE"), "utf8"),
    readFileSync(join(root, "cursor-team-kit", "LICENSE"), "utf8"),
  );
  assert.match(readFileSync(join(packageDir, "licenses", "cursor-team-kit-LICENSE"), "utf8"), /Copyright \(c\) 2026 Cursor/);

  const readme = readFileSync(join(packageDir, "README.md"), "utf8");
  assert.match(readme, /generated/i);
  assert.match(readme, /Do not edit/i);
  assert.match(readme, /scripts\/pstack-pi\/generate\.mjs/);
  assert.match(readme, /scripts\/pstack-pi\/check\.mjs/);
  assert.match(readme, /pstack-pi-sync\.yml/);
  assert.match(readme, /pstack-pi-validate\.yml/);
  assert.match(readme, /delivered but not enabled or remotely verified/i);
  assert.match(readme, /no remote workflow has run/i);
  assert.match(readFileSync(join(packageDir, "README.upstream.md"), "utf8"), /^# pstack/);

  const after = treeState(join(root, "harness"));
  assert.deepEqual([...after.keys()].filter((path) => path.startsWith("pstack/claude-code/")), ["pstack/claude-code/README.md"]);
  assert.equal(readFileSync(join(root, "harness", "pstack", "claude-code", "README.md"), "utf8"), "claude code tree canary\n");
  assert.equal(readFileSync(join(root, "harness", "other-output.txt"), "utf8"), "other output canary\n");
  for (const path of before.keys()) {
    if (path.startsWith("pstack/pi/")) continue;
    assert.ok(after.has(path), `${path} was removed`);
  }
  assertTreeUnchanged(
    assert,
    new Map([...before].filter(([path]) => !path.startsWith("pstack/pi/"))),
    new Map([...after].filter(([path]) => !path.startsWith("pstack/pi/"))),
    "generation touched files outside the Pi subtree",
  );
  assert.ok(readdirSync(join(root, "harness", "pstack")).includes("pi"));
});

function statMode(path) {
  return statSync(path).mode;
}

function stripLinks(text) {
  return text.replace(/\]\([^)\s]+\)/g, "]()");
}

/** The adapter entry is the one paragraph a packaged skill gains; prompts.test.mjs covers it. */
function stripGenerated(text) {
  return stripLinks(text).replace(/^In Pi, read \[the Pi adapter\]\(\)[^\n]*\n\n/m, "");
}
