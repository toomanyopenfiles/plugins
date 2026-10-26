import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const OUTPUT = "harness/pstack/pi";
export const BUNDLED_SKILLS = ["control-cli", "control-ui", "deslop"];
export const AGENTS_OUTPUT = "agents";
/** The public adapter this package ships, as a package-relative path. */
export const ADAPTER_OUTPUT = "docs/harness/pi.md";
export const ADAPTER_SOURCE = "pstack/docs/harness/pi.md";
/** The three agents this package publishes, by file name. `package: pstack` makes them `pstack.<name>`. */
export const AGENTS = ["comment-sicko", "helper", "poteto-agent"];

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_SOURCE = join(HERE, "agents", "helper.md");
const CURSOR_PLUGIN_LOOKUP =
  "With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. " +
  "If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`. " +
  "Your skill catalog hides this skill, so a missing catalog entry does not mean pstack is absent.";
const PI_SKILL_LOOKUP =
  "With no path, before any other work, take the `poteto-mode` entry from your skills catalog, whose location is that `SKILL.md` path. " +
  "If the catalog does not list it, search `~/.pi/agent/skills/` and the `skills/` directory of the installed pstack package for a file whose path ends in `skills/poteto-mode/SKILL.md`. " +
  "A missing catalog entry does not mean pstack is absent.";
/** The read entry into the adapter, relative to an agent file or to a skill's SKILL.md. */
const adapterEntry = (path) =>
  `In Pi, read [the Pi adapter](${path}) before you map a Cursor name. ` +
  "The package root is the parent of the `skills/` directory your skills catalog lists; if you cannot find it, tell your parent.";
const COMMENT_SICKO_FIRST_OUTPUT = "Yes... Ha ha ha... Yes!";

const UPSTREAM = "https://github.com/cursor/plugins";
const LINK = /\]\(([^)\s]+)\)/g;

/**
 * The Cursor names whose meaning changes on Pi, keyed by the text the Pi adapter must explain.
 * Same shape as the Claude Code generator's scan: a key earns a row only when a skill uses it.
 */
const HOST_TERMS = [
  { key: "`Task`", re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", re: /AskQuestion/ },
  { key: "todolist", re: /\btodo ?list\b/i },
  { key: "generalPurpose", re: /generalPurpose/ },
  { key: "poteto-agent", re: /poteto-agent/ },
  { key: "comment-sicko", re: /comment-sicko/ },
  { key: "`readonly: true`", re: /readonly: (true|false)|readonly\/Ask/ },
  { key: "`environment: \"cloud\"`", re: /environment: "(cloud|local)"/ },
  { key: "cloud_base_branch", re: /cloud_base_branch/ },
  { key: "`run_in_background: true`", re: /run_in_background/ },
  { key: "`resume`", re: /`resume`/ },
  { key: "`file_attachments`", re: /file_attachments/ },
  { key: "claude-", re: /\bclaude-[a-z]+-\d/ },
  { key: "grok-", re: /\bgrok-\d/ },
  { key: "gpt-", re: /\bgpt-\d/ },
  { key: "inherit-parent", re: /inherit-parent/ },
  { key: "pstack-models.mdc", re: /pstack-models\.mdc/ },
  { key: ".cursor/skills/", re: /\.cursor\/skills/ },
  { key: "~/.cursor/plugins/", re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: ".cursor/rules/", re: /\.cursor\/rules|always-applied rule/ },
  { key: "agent-transcripts", re: /agent-transcripts|\.cursor\/projects/ },
  { key: "Cursor-only features", re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/ },
  { key: "/loop", re: /\/loop\b|Custom Mode/ },
];
/** Skills that tell the reader to run another pstack skill by name, without a link to its file. */
const ROUTE_KEY = "Run another pstack skill";
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
  for (const path of ["pstack/docs/guide", ADAPTER_SOURCE, "pstack/README.md", "pstack/LICENSE", "cursor-team-kit/LICENSE"]) {
    const abs = sourcePath(root, path);
    const wanted = path.endsWith("LICENSE") || path.endsWith(".md") ? isFile(abs) : isDirectory(abs);
    if (!wanted) problems.push(`missing required source ${path}`);
  }
  for (const name of AGENTS) {
    if (name === "helper") continue;
    if (!isFile(sourcePath(root, `pstack/agents/${name}.md`))) problems.push(`missing required source pstack/agents/${name}.md`);
  }
  for (const name of [...pstackSkills, ...bundled]) {
    const source = pstackSkills.includes(name) ? `pstack/skills/${name}` : `cursor-team-kit/skills/${name}`;
    problems.push(...skillProblems(join(root, source, "SKILL.md"), name, `${source}/SKILL.md`));
  }
  if (problems.length > 0) throw new PiPackageError(problems);
  return { pstackSkills, bundled };
}

/**
 * Split an agent file into its flat frontmatter fields and system prompt. Agent files hold one
 * `key: value` line per field, which is the subset pi-subagents 0.81.0 reads.
 */
function agentParts(text, label) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new PiPackageError([`${label} has no frontmatter`]);
  const fields = [];
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (field) fields.push([field[1], field[2].trim()]);
  }
  return { fields, body: text.slice(match[0].length) };
}

function fieldValue(fields, key) {
  return fields.find(([name]) => name === key)?.[1];
}

function renderAgent(fields, body) {
  return `---\n${fields.map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${body}`;
}

/** Swap one known Cursor-only passage for its Pi equivalent, and fail if the source moved. */
function replaceOnce(text, from, to, label) {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + from.length) >= 0) {
    throw new PiPackageError([`${label} changed: the Pi conversion no longer finds "${from.slice(0, 48)}"`]);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

function insertAfter(text, marker, addition, label) {
  const at = text.indexOf(marker);
  if (at < 0) throw new PiPackageError([`${label} changed: the Pi conversion cannot place the adapter entry after "${marker.trim()}"`]);
  const end = at + marker.length;
  return `${text.slice(0, end)}${addition}\n\n${text.slice(end)}`;
}

// The only frontmatter this conversion adds. A background Cursor delegate is a native async
// child, and the child keeps the repository instructions and the skills it navigates.
const CONVERTED_FIELDS = [
  ["package", "pstack"],
  ["async", "true"],
  ["inheritProjectContext", "true"],
  ["inheritSkills", "true"],
];
// Only the agents the original workflow lets delegate get the native nesting grant. The comment
// reviewer reports and never spawns.
const NESTING_FIELDS = [["allowNestedSubagents", "true"]];
const DELEGATING_AGENTS = ["poteto-agent"];
const CURSOR_ONLY_FIELDS = ["is_background", "run_in_background"];

/** One of the two Cursor agents, converted where Pi differs and left alone everywhere else. */
function cursorAgent(root, name) {
  const label = `pstack/agents/${name}.md`;
  const { fields, body } = agentParts(readFileSync(sourcePath(root, label), "utf8"), label);
  if (fieldValue(fields, "name") !== name) throw new PiPackageError([`${label} does not declare name ${name}`]);
  const added = [...CONVERTED_FIELDS, ...(DELEGATING_AGENTS.includes(name) ? NESTING_FIELDS : [])];
  const kept = fields.filter(([key]) => !CURSOR_ONLY_FIELDS.includes(key) && !added.some(([field]) => field === key));
  for (const field of added) kept.push(field);

  let prompt = body;
  if (name === "poteto-agent") {
    prompt = replaceOnce(prompt, CURSOR_PLUGIN_LOOKUP, PI_SKILL_LOOKUP, label);
    prompt = insertAfter(prompt, "# Poteto subagent\n\n", adapterEntry("../docs/harness/pi.md"), label);
  } else {
    prompt = insertAfter(prompt, `${COMMENT_SICKO_FIRST_OUTPUT}\n\n`, adapterEntry("../docs/harness/pi.md"), label);
  }
  return { bytes: Buffer.from(renderAgent(kept, prompt)), executable: false };
}

/** The helper has no Cursor original: its brief decides the role, so it ships as written. */
function helperAgent() {
  const label = toPosix(relative(join(HERE, "..", ".."), HELPER_SOURCE));
  if (!existsSync(HELPER_SOURCE)) throw new PiPackageError([`missing required source ${label}`]);
  const text = readFileSync(HELPER_SOURCE, "utf8");
  const { fields, body } = agentParts(text, label);
  if (fieldValue(fields, "name") !== "helper" || fieldValue(fields, "package") !== "pstack" || !fieldValue(fields, "description")) {
    throw new PiPackageError([`${label} must declare name helper, package pstack, and a description`]);
  }
  if (body.trim().length === 0) throw new PiPackageError([`${label} has no system prompt`]);
  return { bytes: Buffer.from(text), executable: false };
}

function renderAgents(root) {
  const files = new Map();
  for (const name of AGENTS) {
    files.set(`${AGENTS_OUTPUT}/${name}.md`, name === "helper" ? helperAgent() : cursorAgent(root, name));
  }
  return files;
}

/**
 * Which known host differences each packaged skill names. The scan reads every Markdown file in
 * the skill directory, so it follows the sources instead of a fixed list of skills.
 */
function classifySkills(root, pstackSkills, bundled) {
  const skills = [...pstackSkills, ...bundled].sort();
  const dir = (name) =>
    pstackSkills.includes(name) ? join(root, "pstack", "skills", name) : join(root, "cursor-team-kit", "skills", name);
  const classes = new Map();
  for (const name of skills) {
    const others = skills.filter((other) => other !== name).join("|");
    const route = new RegExp("the \\*\\*(?<bold>" + others + ")\\*\\* skill|`/(?<command>" + others + ")`", "g");
    const linksToSkill = (line, other) => line.includes(`(../${other}/`);
    const namesBareSkill = (line) =>
      [...line.matchAll(route)].some(({ groups }) => !linksToSkill(line, groups.bold ?? groups.command));
    const keys = new Set();
    for (const path of walkFiles(dir(name)).filter((file) => file.endsWith(".md"))) {
      const text = readFileSync(path, "utf8");
      for (const term of HOST_TERMS) if (term.re.test(text)) keys.add(term.key);
      if (text.split("\n").some(namesBareSkill)) keys.add(ROUTE_KEY);
    }
    if (keys.size > 0) classes.set(name, [...keys]);
  }
  return classes;
}

/**
 * Point a skill at the adapter only when it names a host difference, and refuse to ship a
 * skill whose host difference the adapter does not explain.
 */
function adaptSkills(root, files, pstackSkills, bundled) {
  const adapter = files.get(ADAPTER_OUTPUT)?.bytes.toString("utf8") ?? "";
  const problems = [];
  for (const [name, keys] of classifySkills(root, pstackSkills, bundled)) {
    const outRel = `skills/${name}/SKILL.md`;
    const current = files.get(outRel);
    for (const key of keys) {
      if (!adapter.includes(key)) problems.push(`the Pi adapter does not mention ${key}, used by skills/${name}`);
    }
    const text = current.bytes.toString("utf8");
    if (!/^# /m.test(text)) {
      problems.push(`${outRel} names ${keys.join(", ")} but has no H1 to place the adapter entry after`);
      continue;
    }
    const note = adapterEntry("../../docs/harness/pi.md");
    files.set(outRel, { ...current, bytes: Buffer.from(text.replace(/^(# .*)\n+/m, `$1\n\n${note}\n\n`)) });
  }
  if (problems.length > 0) throw new PiPackageError(problems);
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
  if (path === ADAPTER_SOURCE) return ADAPTER_OUTPUT;
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

This directory is generated by \`node scripts/pstack-pi/generate.mjs\`. Do not edit anything under \`harness/pstack/pi/\` by hand. Change the sources under \`pstack/\`, \`cursor-team-kit/skills/\`, or \`scripts/pstack-pi/agents/helper.md\`, regenerate, and commit the result.

## Generate and check

Run these from the repository root:

- \`node scripts/pstack-pi/generate.mjs\` rebuilds \`harness/pstack/pi/\` only. It leaves \`harness/pstack/claude-code/\` and every other output alone.
- \`node scripts/pstack-pi/check.mjs\` builds the expected file set in memory and compares file names, bytes, and executable bits with the committed tree. It then checks the manifest, the skill frontmatter, and the agent names pi-subagents would discover. It writes nothing.
- \`node scripts/pstack-pi/test.mjs\` runs the existing Node tests under \`pstack/skills/*/scripts/test/\`, the Pi regressions in \`scripts/pstack-pi/test/\`, and the read-only check above. It does not run the \`bun:test\` suites under \`pstack/skills/poteto-mode/scripts/\`: those need Bun, which this package neither installs nor assumes.

The output records no timestamp and no artifact hash, so repeated generation from the same sources is identical. The skill list and count come from the source directories; there is no fixed baseline. The inherited Claude Code generator (\`node scripts/generate-pstack-harness-trees.mjs\`) owns the whole \`harness/pstack\` tree. Do not run it while this package exists: it deletes and rebuilds the parent tree. The Pi entries never call it. The inherited \`validate-plugins.yml\` workflow still runs that generator's check across \`harness/pstack/\`, so it will report this Pi tree as drift until the fork disables or replaces that inherited check; changing the inherited workflow is a separate authorized step.

## What is in the package

- Every skill in \`pstack/skills/\`, including \`make-bot-ui\` and the other skills with external prerequisites.
- The complete \`deslop\`, \`control-cli\`, and \`control-ui\` skill directories from \`cursor-team-kit/skills/\`, not just their entry documents.
- Three agents in \`agents/\`, discovered through the manifest's \`pi-subagents.agents\`: \`pstack.poteto-agent\` and \`pstack.comment-sicko\`, converted from the Cursor agents only where Pi differs, and \`pstack.helper\`, a neutral delegate whose role comes from the brief it is given. The two converted agents keep their original responsibility, body, and output contract: the background field becomes \`async\`, the Cursor plugin lookup becomes a Pi skill lookup, and each points at the adapter. \`pstack.helper\` appends to Pi's normal prompt and inherits project instructions, the operator's global instructions, and the skills catalog. \`pstack.poteto-agent\` and \`pstack.helper\` carry the native \`allowNestedSubagents\` grant; none of the three sets a model, a thinking level, or a tool or extension allowlist.
- The Pi adapter at \`docs/harness/pi.md\`, generated from \`pstack/docs/harness/pi.md\`. A packaged skill gains one entry paragraph that points at it only when the skill directory names a known host difference such as \`Task\`, \`generalPurpose\`, \`run_in_background\`, or a Cursor path. The source skills are never edited, and the adapter is read locally instead of fetched.
- The pstack guide in \`docs/guide/\`, the upstream pstack README as \`README.upstream.md\`, and both MIT licenses: \`LICENSE\` for pstack and \`licenses/cursor-team-kit-LICENSE\` for the bundled Cursor Team Kit skills. The copyright lines are kept verbatim.
- \`package.json\` declares \`pi.skills\` as \`./skills\` and \`pi-subagents.agents\` as \`./agents\`, the native Pi and pi-subagents discovery fields. The same skills also live in the conventional \`skills/\` directory.

Markdown links between packaged files are relative links inside this directory. Links to upstream files that this package does not ship, such as the automations and the Claude Code adapter, point at the public \`cursor/plugins\` repository, the same GitHub fallback the Claude Code tree uses.

## Current boundary

This package ships the skills, the three agents, and the adapter. Role-model setup, MCP setup, the daily candidate sync, and the read-only validation workflow are later tickets and are not in this tree yet. Skills still mention Cursor-only features; those source sentences are preserved and the adapter states what Pi does instead.

The agent fields, the discovery paths, and the manifest keys here were checked against Pi 1.4.0 and pi-subagents 0.81.0. No real model, product agent, MCP server, or remote workflow was run to build or check this package. The checks are static and deterministic: they read the generated files, the source documents, and the manifest. A statically discovered agent, a loadable skill, or a passing check is not evidence that a pstack workflow, subagent dispatch, MCP connection, or remote workflow works in Pi.
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
      "pi-subagents": { agents: ["./agents"] },
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
  add(ADAPTER_SOURCE);
  files.set("LICENSE", entry(join(root, "pstack", "LICENSE")));
  files.set("licenses/cursor-team-kit-LICENSE", entry(join(root, "cursor-team-kit", "LICENSE")));

  sources.set("LICENSE", "pstack/LICENSE");
  sources.set("licenses/cursor-team-kit-LICENSE", "cursor-team-kit/LICENSE");

  files.set("package.json", { bytes: Buffer.from(packageJson()), executable: false });
  files.set("README.md", { bytes: Buffer.from(README), executable: false });
  for (const [outRel, file] of renderAgents(root)) files.set(outRel, file);

  adaptSkills(root, files, pstackSkills, bundled);

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
  // pi-subagents 0.81.0 reads either "pi-subagents".agents or "pi.subagents".agents from an installed package.
  const agents = manifest["pi-subagents"]?.agents;
  if (!Array.isArray(agents) || !agents.includes("./agents")) {
    problems.push(`${OUTPUT}/package.json does not declare pi-subagents.agents as ./agents`);
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

/**
 * The agents pi-subagents would discover from this manifest, named the way it names them.
 * Reading the packaged files catches a source edit that would rename an agent without changing
 * the file set.
 */
function discoveredAgents(packageDir) {
  const problems = [];
  const manifestPath = join(packageDir, "package.json");
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { problems, names: [] };
  }
  const roots = [manifest["pi-subagents"]?.agents, manifest.pi?.subagents?.agents]
    .filter(Array.isArray)
    .flat()
    .filter((path) => typeof path === "string" && !/^([/\\]|[A-Za-z]:)/.test(path) && !path.split(/[/\\]/).includes(".."));
  const names = new Map();
  for (const root of roots) {
    const dir = join(packageDir, ...root.split("/"));
    for (const path of walkFiles(dir).filter((file) => file.endsWith(".md"))) {
      const rel = `${OUTPUT}/${toPosix(relative(packageDir, path))}`;
      let parts;
      try {
        parts = agentParts(readFileSync(path, "utf8"), rel);
      } catch {
        problems.push(`${rel} has no frontmatter`);
        continue;
      }
      const name = fieldValue(parts.fields, "name");
      const pkg = fieldValue(parts.fields, "package");
      if (!name || !fieldValue(parts.fields, "description")) {
        problems.push(`${rel} is skipped by pi-subagents because it has no name or description`);
        continue;
      }
      if (parts.body.trim() === "") problems.push(`${rel} has no system prompt`);
      const runtime = pkg ? `${pkg}.${name}` : name;
      if (names.has(runtime)) problems.push(`${rel} and ${names.get(runtime)} both register the agent ${runtime}`);
      else names.set(runtime, rel);
    }
  }
  return { problems, names: [...names.keys()].sort() };
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
      agents: 0,
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

  const agents = discoveredAgents(packageDir);
  problems.push(...agents.problems);
  const wantedAgents = AGENTS.map((name) => `pstack.${name}`).sort();
  for (const name of wantedAgents) {
    if (!agents.names.includes(name)) problems.push(`${OUTPUT} does not discover the agent ${name}`);
  }
  for (const name of agents.names) {
    if (!wantedAgents.includes(name)) problems.push(`${OUTPUT} discovers an agent that is not one of the three: ${name}`);
  }

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
    agents: agents.names.length,
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
