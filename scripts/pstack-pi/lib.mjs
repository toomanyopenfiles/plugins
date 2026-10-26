import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

export const OUTPUT = "harness/pstack/pi";
export const BUNDLED_SKILLS = ["control-cli", "control-ui", "deslop"];

const UPSTREAM = "https://github.com/cursor/plugins";
const LINK = /\]\(([^)\s]+)\)/g;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKIP = new Set([".DS_Store", "node_modules"]);
const SOURCE_TREES = [
  { source: "pstack/skills", output: "skills" },
  { source: "cursor-team-kit/skills", output: "skills" },
  { source: "pstack/docs/guide", output: "docs/guide" },
];

export class PiPackageError extends Error {
  constructor(problems) {
    super(problems.join("\n"));
    this.name = "PiPackageError";
    this.problems = problems;
  }
}

export function toPosix(path) {
  return path.split(sep).join("/");
}

function sourcePath(root, path) {
  return join(root, ...path.split("/"));
}

function entry(path) {
  return { bytes: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0 };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Every file under `dir`, relative and sorted, so output order never depends on the filesystem. */
export function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((item) => !SKIP.has(item.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((item) => {
      const path = join(dir, item.name);
      if (isDirectory(path)) return walkFiles(path);
      return isFile(path) ? [path] : [];
    });
}

function skillNames(dir, label, problems) {
  if (!isDirectory(dir)) {
    problems.push(`missing required source directory: ${label}`);
    return [];
  }
  const names = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".") || SKIP.has(item.name)) continue;
    const path = join(dir, item.name);
    const name = item.name;
    if (!isDirectory(path) || !isFile(join(path, "SKILL.md"))) {
      problems.push(`${label}/${name} is not a skill directory with a SKILL.md`);
      continue;
    }
    names.push(name);
  }
  return names.sort();
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function descriptionPresent(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => /^description:/.test(line));
  if (index < 0) return { present: false };
  const inline = lines[index].replace(/^description:\s*/, "").trim();
  if (inline && !/^[>|][-+]?$/.test(inline)) return { present: true, length: inline.length };
  const block = lines.slice(index + 1).filter((line) => /^\s+\S/.test(line));
  return { present: block.length > 0 };
}

export function declaredSkillName(skillFile) {
  const text = readFileSync(skillFile, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
  const nameLine = /^name:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter);
  return nameLine ? unquote(nameLine[1]) : "";
}

/** Validate the frontmatter Pi's native loader needs, and that the portable name matches the folder. */
export function skillProblems(skillFile, folder, label = skillFile) {
  const problems = [];
  const text = readFileSync(skillFile, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return [`${label} has no frontmatter`];
  const frontmatter = match[1];
  const nameLine = /^name:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter);
  const name = nameLine ? unquote(nameLine[1]) : "";
  if (!name) problems.push(`${label} has no name`);
  else if (name !== folder) problems.push(`${label} declares name ${JSON.stringify(name)}, not its folder ${folder}`);
  if (name && !SKILL_NAME.test(name)) problems.push(`${label} name is not lowercase words joined by hyphens`);
  if (name.length > 64) problems.push(`${label} name exceeds 64 characters`);
  const description = descriptionPresent(frontmatter);
  if (!description.present) problems.push(`${label} has no description`);
  if (description.length > 1024) problems.push(`${label} description exceeds 1024 characters`);
  return problems;
}

export function inventory(root) {
  const problems = [];
  const pstackSkills = skillNames(join(root, "pstack", "skills"), "pstack/skills", problems);
  const bundled = [];
  for (const name of BUNDLED_SKILLS) {
    const dir = join(root, "cursor-team-kit", "skills", name);
    if (!isDirectory(dir)) {
      problems.push(`missing required bundled skill: cursor-team-kit/skills/${name}`);
      continue;
    }
    if (!isFile(join(dir, "SKILL.md"))) {
      problems.push(`missing required bundled skill entry: cursor-team-kit/skills/${name}/SKILL.md`);
      continue;
    }
    bundled.push(name);
  }
  for (const name of pstackSkills) {
    if (BUNDLED_SKILLS.includes(name)) problems.push(`skill name conflict: ${name} exists in pstack/skills and a bundled skill`);
  }
  for (const path of ["pstack/docs/guide", "pstack/README.md", "pstack/LICENSE", "cursor-team-kit/LICENSE"]) {
    const abs = sourcePath(root, path);
    const wanted = path.endsWith("LICENSE") || path.endsWith(".md") ? isFile(abs) : isDirectory(abs);
    if (!wanted) problems.push(`missing required source ${path}`);
  }
  for (const name of [...pstackSkills, ...bundled]) {
    const source = pstackSkills.includes(name) ? `pstack/skills/${name}` : `cursor-team-kit/skills/${name}`;
    problems.push(...skillProblems(join(root, source, "SKILL.md"), name, `${source}/SKILL.md`));
  }
  if (problems.length > 0) throw new PiPackageError(problems);
  return { pstackSkills, bundled };
}

/** The package path for a source file, when this build ships it. */
export function mapSourcePath(sourceRel) {
  const path = sourceRel.replace(/\/+$/, "");
  for (const tree of SOURCE_TREES) {
    if (path === tree.source) return tree.output;
    if (path.startsWith(`${tree.source}/`)) {
      return `${tree.output}/${path.slice(tree.source.length + 1)}`;
    }
  }
  if (path === "pstack/README.md") return "README.upstream.md";
  return null;
}

function hasPath(files, path) {
  const clean = path.replace(/\/+$/, "");
  if (files.has(clean)) return true;
  return [...files.keys()].some((key) => key.startsWith(`${clean}/`));
}

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#");
}

function isPathLike(href) {
  const target = href.replace(/[#?].*/, "");
  if (!target) return false;
  return target.startsWith("./") || target.startsWith("../") || target.startsWith("/") || target.includes("/") || /\.[a-z0-9]+$/i.test(target);
}

function upstreamUrl(root, sourceRel) {
  if (!sourceRel.startsWith("pstack/") && !sourceRel.startsWith("cursor-team-kit/")) return undefined;
  if (sourceRel.startsWith("..")) return undefined;
  const abs = sourcePath(root, sourceRel);
  if (!existsSync(abs)) return undefined;
  return `${UPSTREAM}/${isDirectory(abs) ? "tree" : "blob"}/main/${sourceRel}`;
}

function rewriteLinks({ root, outRel, sourceRel, files, text }) {
  return text.replace(LINK, (link, href) => {
    if (isExternal(href)) return link;
    const suffixAt = href.search(/[#?]/);
    const suffix = suffixAt < 0 ? "" : href.slice(suffixAt);
    const target = suffixAt < 0 ? href : href.slice(0, suffixAt);
    if (!target) return link;
    const outputTarget = posix.normalize(posix.join(posix.dirname(outRel), target));
    const sourceTarget = posix.normalize(posix.join(posix.dirname(sourceRel), target));
    if (sourceTarget !== ".." && !sourceTarget.startsWith("../")) {
      const mapped = mapSourcePath(sourceTarget);
      if (mapped && hasPath(files, mapped)) {
        const relativePath = posix.relative(posix.dirname(outRel), mapped) || posix.basename(mapped);
        const slash = target.endsWith("/") && !relativePath.endsWith("/") ? "/" : "";
        return `](${relativePath}${slash}${suffix})`;
      }
    }
    if (hasPath(files, outputTarget)) return link;
    const upstream = upstreamUrl(root, sourceTarget);
    return upstream ? `](${upstream}${suffix})` : link;
  });
}

/** Broken or needlessly remote links in a package file map. */
export function linkProblems(files, root, sources = new Map()) {
  const problems = [];
  for (const [outRel, { bytes }] of files) {
    if (!outRel.endsWith(".md")) continue;
    const sourceRel = sources.get(outRel);
    for (const [, href] of bytes.toString("utf8").matchAll(LINK)) {
      if (isExternal(href)) {
        const match = /^https:\/\/github\.com\/cursor\/plugins\/(?:blob|tree)\/main\/((?:pstack|cursor-team-kit)\/[^#?]+)/.exec(href);
        if (!match) continue;
        const upstreamRel = match[1];
        const mapped = mapSourcePath(upstreamRel);
        if (mapped && hasPath(files, mapped)) {
          problems.push(`${OUTPUT}/${outRel} links to GitHub for packaged ${mapped}`);
        }
        if (!existsSync(sourcePath(root, upstreamRel))) {
          problems.push(`${OUTPUT}/${outRel} links to missing upstream ${upstreamRel}`);
        }
        continue;
      }
      if (!isPathLike(href)) continue;
      const target = href.replace(/[#?].*/, "");
      const resolved = posix.normalize(posix.join(posix.dirname(outRel), target));
      if (resolved === ".." || resolved.startsWith("../")) {
        problems.push(`${OUTPUT}/${outRel} links outside the package: ${href}`);
        continue;
      }
      if (sourceRel) {
        const sourceTarget = posix.normalize(posix.join(posix.dirname(sourceRel), target));
        const mapped = sourceTarget === ".." || sourceTarget.startsWith("../") ? null : mapSourcePath(sourceTarget);
        if (mapped && mapped !== resolved.replace(/\/+$/, "") && hasPath(files, mapped)) {
          problems.push(`${OUTPUT}/${outRel} links to ${target}; the packaged source is ${mapped}`);
          continue;
        }
      }
      if (!hasPath(files, resolved)) {
        problems.push(`${OUTPUT}/${outRel} has a broken relative link: ${href}`);
      }
    }
  }
  return problems;
}

const README = `# pstack for Pi

This directory is generated by \`node scripts/pstack-pi/generate.mjs\`. Do not edit anything under \`harness/pstack/pi/\` by hand. Change the sources under \`pstack/\` or \`cursor-team-kit/skills/\`, regenerate, and commit the result.

## Generate and check

Run these from the repository root:

- \`node scripts/pstack-pi/generate.mjs\` rebuilds \`harness/pstack/pi/\` only. It leaves \`harness/pstack/claude-code/\` and every other output alone.
- \`node scripts/pstack-pi/check.mjs\` builds the expected file set in memory and compares file names, bytes, and executable bits with the committed tree. It writes nothing.
- \`node scripts/pstack-pi/test.mjs\` runs the existing pstack deterministic tests, the Pi package regressions, and the read-only generated-package check.

The output records no timestamp and no artifact hash, so repeated generation from the same sources is identical. The skill list and count come from the source directories; there is no fixed baseline. The inherited Claude Code generator (\`node scripts/generate-pstack-harness-trees.mjs\`) owns the whole \`harness/pstack\` tree. Do not run it while this package exists: it deletes and rebuilds the parent tree. The Pi entries never call it. The inherited \`validate-plugins.yml\` workflow still runs that generator's check across \`harness/pstack/\`, so it will report this Pi tree as drift until the fork disables or replaces that inherited check; changing the inherited workflow is a separate authorized step.

## What is in the package

- Every skill in \`pstack/skills/\`, including \`make-bot-ui\` and the other skills with external prerequisites.
- The complete \`deslop\`, \`control-cli\`, and \`control-ui\` skill directories from \`cursor-team-kit/skills/\`, not just their entry documents.
- The pstack guide in \`docs/guide/\`, the upstream pstack README as \`README.upstream.md\`, and both MIT licenses: \`LICENSE\` for pstack and \`licenses/cursor-team-kit-LICENSE\` for the bundled Cursor Team Kit skills. The copyright lines are kept verbatim.
- \`package.json\` declares \`pi.skills\` as \`./skills\`, Pi's native skill resource discovery. The same skills also live in the conventional \`skills/\` directory.

Markdown links between packaged files are relative links inside this directory. Links to upstream files that this package does not ship, such as agents, automations, and the Claude Code adapter, point at the public \`cursor/plugins\` repository, the same GitHub fallback the Claude Code tree uses.

## Current boundary

This package ships skill resources only. The Pi adapter, the three \`pstack.*\` subagents, role-model setup, MCP setup, and the sync and validation workflows are later tickets and are not in this tree yet. Skills still mention Cursor-only features; those source sentences are preserved. A skill being discoverable or loadable is not evidence that a pstack workflow, subagent dispatch, MCP connection, or remote workflow works in Pi.

No real model, product agent, MCP server, or remote workflow was run to build or check this package. The checks are static and deterministic.
`;

function packageJson() {
  return `${JSON.stringify(
    {
      name: "pstack",
      private: true,
      description: "pstack skills packaged for Pi",
      license: "MIT",
      keywords: ["pi-package"],
      pi: { skills: ["./skills"] },
    },
    null,
    2,
  )}\n`;
}

/**
 * Build the complete expected package in memory. This is the only source of truth for
 * generation and checking, and it never writes to disk.
 */
export function renderPackage(root) {
  const { pstackSkills, bundled } = inventory(root);
  const files = new Map();
  const sources = new Map();
  const add = (sourceRel) => {
    const output = mapSourcePath(sourceRel);
    if (!output) throw new Error(`no package path for ${sourceRel}`);
    const abs = sourcePath(root, sourceRel);
    files.set(output, entry(abs));
    sources.set(output, sourceRel);
  };

  for (const name of pstackSkills) {
    for (const path of walkFiles(join(root, "pstack", "skills", name))) {
      add(toPosix(relative(root, path)));
    }
  }
  for (const name of bundled) {
    for (const path of walkFiles(join(root, "cursor-team-kit", "skills", name))) {
      add(toPosix(relative(root, path)));
    }
  }
  for (const path of walkFiles(join(root, "pstack", "docs", "guide"))) {
    add(toPosix(relative(root, path)));
  }
  add("pstack/README.md");
  files.set("LICENSE", entry(join(root, "pstack", "LICENSE")));
  files.set("licenses/cursor-team-kit-LICENSE", entry(join(root, "cursor-team-kit", "LICENSE")));

  sources.set("LICENSE", "pstack/LICENSE");
  sources.set("licenses/cursor-team-kit-LICENSE", "cursor-team-kit/LICENSE");

  files.set("package.json", { bytes: Buffer.from(packageJson()), executable: false });
  files.set("README.md", { bytes: Buffer.from(README), executable: false });

  for (const [outRel, sourceRel] of sources) {
    if (!outRel.endsWith(".md")) continue;
    const current = files.get(outRel);
    const text = current.bytes.toString("utf8");
    const rewritten = rewriteLinks({ root, outRel, sourceRel, files, text });
    if (rewritten !== text) files.set(outRel, { ...current, bytes: Buffer.from(rewritten) });
  }

  const problems = linkProblems(files, root, sources);
  if (problems.length > 0) throw new PiPackageError(problems);
  return { files, sources, pstackSkills, bundled };
}

function formatProblems(problems) {
  return problems.map((problem) => `FAIL ${problem}`);
}

function manifestPaths(manifest) {
  const paths = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    for (const path of value) if (typeof path === "string") paths.push(path);
  };
  for (const type of ["extensions", "skills", "prompts", "themes"]) collect(manifest.pi?.[type]);
  collect(manifest["pi-subagents"]?.agents);
  collect(manifest.pi?.subagents?.agents);
  return paths;
}

function manifestProblems(manifest, packageDir) {
  const problems = [];
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") problems.push(`${OUTPUT}/package.json has no name`);
  const skills = manifest.pi?.skills;
  if (!Array.isArray(skills) || !skills.includes("./skills")) {
    problems.push(`${OUTPUT}/package.json does not declare pi.skills as ./skills`);
  }
  for (const path of manifestPaths(manifest)) {
    if (/^([/\\]|[A-Za-z]:)/.test(path) || path.split(/[/\\]/).includes("..")) {
      problems.push(`${OUTPUT}/package.json declares an absolute or escaping path: ${path}`);
      continue;
    }
    const globAt = path.search(/[*?[{]/);
    const declared = globAt < 0 ? path : path.slice(0, globAt).replace(/[/\\]+$/, "");
    if (!declared) continue;
    if (!existsSync(join(packageDir, ...declared.split("/")))) {
      problems.push(`${OUTPUT}/package.json declares a missing path: ${path}`);
    }
  }
  return problems;
}

function driftProblems(expected, actual) {
  const problems = [];
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const path of paths) {
    const want = expected.get(path);
    const have = actual.get(path);
    if (!want) problems.push(`${OUTPUT}/${path} is not generated from any source`);
    else if (!have) problems.push(`${OUTPUT}/${path} is missing`);
    else if (!want.bytes.equals(have.bytes)) problems.push(`${OUTPUT}/${path} has different content`);
    else if (want.executable !== have.executable) problems.push(`${OUTPUT}/${path} has a different executable bit`);
  }
  return problems;
}

function sourceCoverageProblems(root, source, actual) {
  const problems = [];
  const trees = [
    ...source.pstackSkills.map((name) => `pstack/skills/${name}`),
    ...source.bundled.map((name) => `cursor-team-kit/skills/${name}`),
    "pstack/docs/guide",
  ];
  for (const tree of trees) {
    for (const path of walkFiles(sourcePath(root, tree))) {
      const sourceRel = toPosix(relative(root, path));
      const mapped = mapSourcePath(sourceRel);
      const have = actual.get(mapped);
      if (!have) {
        problems.push(`${OUTPUT}/${mapped} is missing for source ${sourceRel}`);
        continue;
      }
      if (sourceRel.endsWith(".md")) continue;
      const want = entry(path);
      if (!want.bytes.equals(have.bytes)) problems.push(`${OUTPUT}/${mapped} differs from ${sourceRel}`);
      else if (want.executable !== have.executable) problems.push(`${OUTPUT}/${mapped} lost the executable bit of ${sourceRel}`);
    }
  }
  return problems;
}

/**
 * Check the committed tree against the sources without touching the workspace.
 * Returns every problem found instead of stopping at the first one.
 */
export function inspectPackage(root) {
  const expected = renderPackage(root);
  const packageDir = join(root, OUTPUT);
  const problems = [];
  const actual = new Map(
    walkFiles(packageDir).map((path) => [toPosix(relative(packageDir, path)), entry(path)]),
  );
  if (actual.size === 0) {
    return {
      problems: [`${OUTPUT} is missing or empty; run node scripts/pstack-pi/generate.mjs`],
      skills: expected.pstackSkills.length + expected.bundled.length,
      pstackSkills: expected.pstackSkills.length,
      bundled: expected.bundled.length,
      files: 0,
    };
  }

  problems.push(...driftProblems(expected.files, actual));
  problems.push(...sourceCoverageProblems(root, expected, actual));

  const manifestEntry = actual.get("package.json");
  if (!manifestEntry) problems.push(`${OUTPUT}/package.json is missing`);
  else {
    try {
      problems.push(...manifestProblems(JSON.parse(manifestEntry.bytes.toString("utf8")), packageDir));
    } catch {
      problems.push(`${OUTPUT}/package.json is not valid JSON`);
    }
  }

  const skillsDir = join(packageDir, "skills");
  const generated = existsSync(skillsDir) ? skillNames(skillsDir, `${OUTPUT}/skills`, problems) : [];
  const wanted = [...expected.pstackSkills, ...expected.bundled].sort();
  const declared = new Map();
  for (const name of wanted) if (!generated.includes(name)) problems.push(`${OUTPUT}/skills/${name} is missing`);
  for (const name of generated) {
    if (!wanted.includes(name)) problems.push(`${OUTPUT}/skills/${name} does not come from a source skill`);
    problems.push(...skillProblems(join(skillsDir, name, "SKILL.md"), name, `${OUTPUT}/skills/${name}/SKILL.md`));
    const declaredName = declaredSkillName(join(skillsDir, name, "SKILL.md"));
    if (declaredName) {
      if (declared.has(declaredName)) {
        problems.push(`${OUTPUT}/skills/${name} and ${OUTPUT}/skills/${declared.get(declaredName)} both declare the skill name ${declaredName}`);
      } else {
        declared.set(declaredName, name);
      }
    }
  }
  if (generated.length !== wanted.length) problems.push(`${OUTPUT} has ${generated.length} skills; the sources have ${wanted.length}`);

  for (const [output, sourceRel] of [
    ["LICENSE", "pstack/LICENSE"],
    ["licenses/cursor-team-kit-LICENSE", "cursor-team-kit/LICENSE"],
  ]) {
    const have = actual.get(output);
    if (!have) continue;
    const want = readFileSync(sourcePath(root, sourceRel));
    if (!have.bytes.equals(want)) problems.push(`${OUTPUT}/${output} does not match ${sourceRel}`);
    if (!/Copyright \(c\) \d{4} /.test(have.bytes.toString("utf8"))) problems.push(`${OUTPUT}/${output} lost its copyright line`);
  }

  problems.push(...linkProblems(actual, root, expected.sources));
  return {
    problems: [...new Set(problems)],
    skills: generated.length,
    pstackSkills: expected.pstackSkills.length,
    bundled: expected.bundled.length,
    files: actual.size,
  };
}

export function generatePackage(root) {
  const { files, pstackSkills, bundled } = renderPackage(root);
  const packageDir = join(root, OUTPUT);
  rmSync(packageDir, { recursive: true, force: true });
  for (const [path, file] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const destination = join(packageDir, ...path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.bytes);
    chmodSync(destination, file.executable ? 0o755 : 0o644);
  }
  return {
    skills: pstackSkills.length + bundled.length,
    pstackSkills: pstackSkills.length,
    bundled: bundled.length,
    files: files.size,
  };
}

export function reportProblems(problems) {
  return formatProblems(problems).join("\n");
}
