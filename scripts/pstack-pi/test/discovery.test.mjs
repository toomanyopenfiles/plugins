import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { makeSource, relativeFiles, runScript, skillDirs } from "./helpers.mjs";

const output = "harness/pstack/pi";

function makeIsolatedPackage(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  const isolated = mkdtempSync(join(tmpdir(), "pstack-pi-isolated-"));
  cpSync(join(root, output), isolated, { recursive: true });
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  return { root, isolated };
}

/** The discovery rule Pi documents: a directory with SKILL.md is a skill root, otherwise recurse. */
function discover(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const roots = manifest.pi?.skills;
  assert.ok(Array.isArray(roots) && roots.length > 0);
  const skills = [];
  const visit = (dir) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
    if (existsSync(join(dir, "SKILL.md"))) {
      skills.push({ name: dir.split("/").at(-1), file: join(dir, "SKILL.md") });
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name));
    }
  };
  for (const root of roots) {
    assert.ok(!root.startsWith("/") && !root.split("/").includes(".."), `${root} is not a relative package path`);
    visit(join(packageDir, ...root.split("/")));
  }
  return { manifest, skills };
}

test("an isolated copy discovers exactly the generated skills without the source tree", (t) => {
  const { isolated } = makeIsolatedPackage(t);
  const { skills } = discover(isolated);
  const packageSkills = skillDirs(join(isolated, "skills"));
  assert.deepEqual(skills.map((skill) => skill.name).sort(), packageSkills);
  assert.ok(skills.length > 0);

  for (const skill of skills) {
    assert.ok(existsSync(skill.file), `${skill.file} is missing`);
    assert.match(readFileSync(skill.file, "utf8"), /^---\n[\s\S]*?^name: /m);
  }

  // Nothing in the package points back at the checkout it was generated from.
  for (const path of relativeFiles(isolated)) {
    const full = join(isolated, path);
    assert.ok(!lstatSync(full).isSymbolicLink(), `${path} is a symlink`);
    if (!/\.(md|json|mjs|ts|sh)$/.test(path)) continue;
    const text = readFileSync(full, "utf8");
    assert.doesNotMatch(text, /\/pstack-pi-source-/, `${path} contains a source checkout path`);
  }
});

test("the native Pi skill loader reads the isolated package", async (t) => {
  const pi = locatePi();
  if (!pi) {
    t.skip("the Pi coding agent package is not installed; the static discovery check above still runs");
    return;
  }
  const { isolated } = makeIsolatedPackage(t);
  const { manifest, skills } = discover(isolated);
  const expected = skills.map((skill) => skill.name).sort();
  const { loadSkillsFromDir } = await import(pathToFileURL(pi.entry).href);
  const loaded = { skills: [], diagnostics: [] };
  for (const root of manifest.pi.skills) {
    const result = loadSkillsFromDir({ dir: join(isolated, ...root.split("/")), source: "path" });
    loaded.skills.push(...result.skills);
    loaded.diagnostics.push(...result.diagnostics);
  }
  t.diagnostic(`Pi ${pi.version} native loader`);
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(loaded.skills.map((skill) => skill.name).sort(), expected);
  for (const skill of loaded.skills) {
    assert.ok(skill.description.trim().length > 0, `${skill.name} has no description`);
    assert.ok(existsSync(skill.filePath), `${skill.name} lost its file path`);
  }
});

/** Find the installed Pi package without hard-coding this machine's absolute path in the product. */
function locatePi() {
  if (process.env.PI_CODING_AGENT_PACKAGE) {
    const entry = process.env.PI_CODING_AGENT_PACKAGE;
    if (!existsSync(entry)) return undefined;
    return { entry, version: versionOf(entry) };
  }
  const agentDir = join(homedir(), ".pi", "agent");
  const current = join(agentDir, "install", "current-version");
  if (!existsSync(current)) return undefined;
  const version = readFileSync(current, "utf8").trim();
  const entry = join(agentDir, "install", "releases", version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
  if (!existsSync(entry)) return undefined;
  return { entry, version };
}

function versionOf(entry) {
  const packageJson = join(dirname(dirname(entry)), "package.json");
  return existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")).version : "unknown";
}
