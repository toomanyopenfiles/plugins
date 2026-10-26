import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const bundledSkills = ["control-cli", "control-ui", "deslop"];

const sources = [
  "pstack/skills",
  "pstack/docs",
  "pstack/agents",
  "pstack/automations",
  "pstack/assets",
  "pstack/README.md",
  "pstack/LICENSE",
  "pstack/plugin.json",
  "cursor-team-kit/LICENSE",
  ...bundledSkills.map((name) => `cursor-team-kit/skills/${name}`),
];

export function toPosix(path) {
  return path.split(sep).join("/");
}

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function relativeFiles(root) {
  return walk(root).map((path) => toPosix(relative(root, path))).sort();
}

/**
 * Copy the real pstack and cursor-team-kit sources into an isolated repository root.
 * Tests only ever mutate this copy, never the checkout.
 */
export function makeSource(t, { harness = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pstack-pi-source-"));
  for (const path of sources) {
    const from = join(repoRoot, path);
    const to = join(root, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  if (harness) {
    mkdirSync(join(root, "harness", "pstack", "claude-code"), { recursive: true });
    writeFileSync(join(root, "harness", "pstack", "claude-code", "README.md"), "claude code tree canary\n");
    writeFileSync(join(root, "harness", "other-output.txt"), "other output canary\n");
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function runScript(script, args = [], options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", "pstack-pi", script), ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: 120_000,
  });
}

export function treeState(root) {
  const entries = new Map();
  for (const path of walk(root)) {
    const stat = statSync(path);
    entries.set(toPosix(relative(root, path)), {
      bytes: readFileSync(path).toString("base64"),
      mode: stat.mode & 0o777,
      mtimeMs: stat.mtimeMs,
    });
  }
  return entries;
}

export function assertTreeUnchanged(assert, before, after, message) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changed = paths.filter((path) => {
    const [a, b] = [before.get(path), after.get(path)];
    return !a || !b || a.bytes !== b.bytes || a.mode !== b.mode || a.mtimeMs !== b.mtimeMs;
  });
  assert.deepEqual(changed, [], message);
}

export function skillDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
