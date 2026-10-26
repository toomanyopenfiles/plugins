import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const OUTPUT = "harness/pstack/pi";
export const BUNDLED_SKILLS = ["control-cli", "control-ui", "deslop"];
export const AGENTS_OUTPUT = "agents";
/** The public adapter this package ships, as a package-relative path. */
export const ADAPTER_OUTPUT = "docs/harness/pi.md";
export const ADAPTER_SOURCE = "pstack/docs/harness/pi.md";
/** MCP is the one host difference with its own flow, so it ships as a second document. */
export const MCP_FLOW_SOURCE = "pstack/docs/harness/pi/mcp-setup.md";
export const MCP_FLOW_OUTPUT = "docs/harness/pi/mcp-setup.md";
/** Pi's thinking levels, in the order Pi lists them. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** The setup skill's four budgets and the level each one asks for on Pi. */
export const BUDGET_LEVELS = { unlimited: "max", large: "xhigh", medium: "high", small: "medium" };
const ROLE_ALIASES = new Set(["auto", "inherit-parent"]);
const MODEL_VALUE = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*(?::([a-z]+))?$/;
const AGENT_OVERRIDE_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_.-]*$/;
const MCP_SELECTION = /^mcp:([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?$/;
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const SERVER_URL = /^https?:\/\//;
const EXPOSURES = new Set(["codemode", "deferred", "direct", "hidden"]);
const SERVER_TYPES = new Set(["stdio", "http", "streamable-http"]);
/** pi-subagents 0.81.0's supported `subagents.agentOverrides.<name>` fields. */
const OVERRIDE_FIELDS = new Set([
  "description",
  "advertise",
  "machine",
  "output",
  "outputMode",
  "defaultReads",
  "model",
  "defaultProvider",
  "thinking",
  "systemPromptMode",
  "inheritProjectContext",
  "inheritGlobalContext",
  "inheritSkills",
  "defaultContext",
  "acceptanceRole",
  "disabled",
  "skills",
  "tools",
  "systemPrompt",
]);
const LITERAL_CREDENTIAL = /^(?:Bearer\s+[A-Za-z0-9._-]{8,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})/;
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
  { key: "MCP", re: /MCP/ },
  { key: "create-skill", re: /create-skill/ },
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
  for (const path of ["pstack/docs/guide", ADAPTER_SOURCE, MCP_FLOW_SOURCE, "pstack/README.md", "pstack/LICENSE", "cursor-team-kit/LICENSE"]) {
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
  if (path === MCP_FLOW_SOURCE) return MCP_FLOW_OUTPUT;
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

/**
 * Fenced blocks this package checks: an info string of `text pstack-models` or `json pstack-*`
 * marks an example that the check validates against the host shape instead of trusting prose.
 */
export function taggedExamples(text) {
  const found = new Map();
  const block = /^```[A-Za-z0-9-]+[ \t]+(pstack-[a-z0-9-]+)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  for (const match of text.matchAll(block)) {
    if (!found.has(match[1])) found.set(match[1], []);
    found.get(match[1]).push(match[2]);
  }
  return found;
}

/** The `# budget` line and one entry per role, from a role-model block or the setup skill's example. */
export function roleTable(text) {
  const lines = [];
  let budget = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const budgetLine = /^#\s*budget:\s*([a-z]+)\s*\(([a-z]+)\)\s*$/.exec(line);
    if (budgetLine) {
      budget = { label: budgetLine[1], level: budgetLine[2] };
      continue;
    }
    if (/^\s*#/.test(line) || /^---\s*$/.test(line) || /^(description|alwaysApply|name):/.test(line)) continue;
    const at = line.indexOf(": ");
    if (at < 0) {
      lines.push({ problem: `"${line.trim()}" is not a role: value line` });
      continue;
    }
    const labels = line.slice(0, at).split(",").map((value) => value.trim()).filter(Boolean);
    const values = line.slice(at + 2).split(",").map((value) => value.trim()).filter(Boolean);
    if (labels.length > 0 && values.length > 0) lines.push({ labels, values });
  }
  return { budget, lines };
}

/**
 * Validate a Pi role-model file. With `options.roles`, the file also has to keep every role the
 * setup skill names, with the same panel length, because the documented example mirrors it.
 */
export function roleModelProblems(text, options = {}) {
  const problems = [];
  const table = roleTable(text);
  if (!table.budget) problems.push("the role example has no # budget line");
  else {
    const wanted = BUDGET_LEVELS[table.budget.label];
    if (!wanted) problems.push(`budget "${table.budget.label}" is not one of ${Object.keys(BUDGET_LEVELS).join(", ")}`);
    else if (table.budget.level !== wanted) {
      problems.push(`budget "${table.budget.label}" must use level ${wanted}, not "${table.budget.level}"`);
    }
  }
  if (table.lines.length === 0) problems.push("the role example has no role lines");

  const seen = new Map();
  for (const line of table.lines) {
    if (line.problem) {
      problems.push(line.problem);
      continue;
    }
    for (const label of line.labels) {
      if (seen.has(label)) problems.push(`role "${label}" appears twice`);
      else seen.set(label, line);
    }
    for (const value of line.values) {
      if (ROLE_ALIASES.has(value)) continue;
      const match = MODEL_VALUE.exec(value);
      if (!match) {
        problems.push(
          `role "${line.labels.join(", ")}" uses "${value}", which is not provider/model-id:level, auto, or inherit-parent`,
        );
        continue;
      }
      if (match[1] && !THINKING_LEVELS.includes(match[1])) {
        problems.push(`level "${match[1]}" in "${value}" is not one of Pi's thinking levels: ${THINKING_LEVELS.join(", ")}`);
      }
    }
  }

  const roles = options.roles;
  if (roles) {
    const sourceLabels = [...new Set(roles.lines.flatMap((line) => line.labels))];
    const missing = sourceLabels.filter((label) => !seen.has(label));
    if (missing.length > 0) problems.push(`the role example is missing ${missing.join(", ")}`);
    const extra = [...seen.keys()].filter((label) => !sourceLabels.includes(label));
    if (extra.length > 0) problems.push(`the role example names roles the skill no longer has: ${extra.join(", ")}`);
    for (const line of roles.lines) {
      const match = table.lines.find((candidate) => candidate.labels.join(",") === line.labels.join(","));
      if (!match) continue;
      if (match.values.length !== line.values.length) {
        problems.push(
          `the example gave ${line.labels.join(", ")} ${match.values.length} entries instead of ${line.values.length}; each entry runs one child`,
        );
      }
    }
  }
  return problems;
}

/** The setup skill's role example, which the Pi role-model block mirrors. */
function setupRoleTable(root) {
  const path = join(root, "pstack", "skills", "setup-pstack", "SKILL.md");
  if (!isFile(path)) return null;
  const text = readFileSync(path, "utf8");
  const tagged = taggedExamples(text).get("pstack-models")?.[0];
  if (tagged) return roleTable(tagged);
  for (const match of text.matchAll(/^```[a-z]*\r?\n([\s\S]*?)^```$/gm)) {
    if (/^# budget:/m.test(match[1])) return roleTable(match[1]);
  }
  return null;
}

function credentialProblems(server, path, problems) {
  const visit = (value, at) => {
    if (typeof value === "string") {
      if (LITERAL_CREDENTIAL.test(value)) {
        problems.push(`server "${server}" holds a literal credential at ${at}; use an environment reference such as \${NAME} or !command`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${at}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) visit(entry, at ? `${at}.${key}` : key);
    }
  };
  visit(server, path);
}

/** Validate an `mcpServers` example against the shape Pi's MCP documentation reads. */
export function mcpServersProblems(config) {
  const problems = [];
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return ["the example has no mcpServers object"];
  const normalized = new Map();
  for (const [name, server] of Object.entries(servers)) {
    if (!SERVER_NAME.test(name)) problems.push(`server "${name}" is not a valid server name: letters, digits, "_", and "-" only`);
    const key = name.replace(/-/g, "_");
    if (normalized.has(key)) problems.push(`servers "${normalized.get(key)}" and "${name}" differ only in "-" and "_"`);
    else normalized.set(key, name);
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      problems.push(`server "${name}" is not an object`);
      continue;
    }
    if (server.type === "sse") problems.push(`server "${name}" uses the removed "sse" transport; use a "url" for streamable HTTP`);
    else if (server.type !== undefined && !SERVER_TYPES.has(server.type)) {
      problems.push(`server "${name}" has an unknown type "${server.type}"; use stdio, http, or streamable-http`);
    }
    const hasCommand = typeof server.command === "string" && server.command.trim() !== "";
    const hasUrl = typeof server.url === "string" && server.url.trim() !== "";
    if (hasCommand === hasUrl) problems.push(`server "${name}" needs exactly one of "command" or "url"`);
    if (hasUrl && !SERVER_URL.test(server.url)) problems.push(`server "${name}" has a "url" that is not http or https`);
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))) {
      problems.push(`server "${name}" has "args" that is not a list of strings`);
    }
    if (server.exposure !== undefined && !EXPOSURES.has(server.exposure)) {
      problems.push(`server "${name}" has exposure "${server.exposure}", which is not a tool exposure (${[...EXPOSURES].join(", ")})`);
    }
    credentialProblems(server, "", problems);
  }
  return problems;
}

/** Validate `subagents.agentOverrides`, including the static `mcp:` selections in `tools`. */
export function agentOverrideProblems(overrides, options = {}) {
  const problems = [];
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return ["the agent overrides are not an object"];
  const servers = options.servers?.mcpServers ?? options.servers ?? {};
  for (const [agent, fields] of Object.entries(overrides)) {
    if (!AGENT_OVERRIDE_NAME.test(agent)) problems.push(`"${agent}" is not an agent name`);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      problems.push(`agent "${agent}" has no field object`);
      continue;
    }
    for (const field of Object.keys(fields)) {
      if (!OVERRIDE_FIELDS.has(field)) problems.push(`"${field}" is not a supported agent override field`);
    }
    const tools = fields.tools;
    if (tools === undefined) continue;
    if (!Array.isArray(tools) || tools.length === 0) {
      problems.push(`agent "${agent}" has a tools override that is not a non-empty list`);
      continue;
    }
    let plain = 0;
    let selected = 0;
    for (const tool of tools) {
      if (typeof tool !== "string" || tool.trim() === "") {
        problems.push(`agent "${agent}" has a tools entry that is not a name`);
        continue;
      }
      if (/^[+-]/.test(tool)) {
        problems.push(
          `"${tool}" is not a tool name: pi-subagents 0.81.0 reads an agent tools list as a strict allowlist, so "${tool}" never adds ${tool.slice(1)} and the launch fails; write plain tool names`,
        );
        continue;
      }
      const selection = MCP_SELECTION.exec(tool);
      if (selection) {
        selected += 1;
        if (!Object.hasOwn(servers, selection[1])) {
          problems.push(`"${tool}" names a server the configured servers do not define`);
        } else if (servers[selection[1]]?.exposure === "hidden") {
          problems.push(`"${tool}" selects a server configured "hidden"; a hidden server cannot be selected`);
        }
        continue;
      }
      if (!TOOL_NAME.test(tool)) problems.push(`"${tool}" is not a tool name or an mcp:<server>/<tool> selection`);
      else plain += 1;
    }
    if (selected > 0 && plain === 0) {
      problems.push(`agent "${agent}" keeps only MCP tools; keep the normal and extension tools the agent already uses`);
    }
  }
  return problems;
}

/** The MCP flow merges one field per named agent, so a preview that changes anything else is rejected. */
export function mcpPreviewProblems(preview, options = {}) {
  const overrides = preview?.agentOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return ['the preview is not shaped as { "agentOverrides": { "<agent>": { "tools": [...] } } }'];
  }
  const problems = [];
  for (const [agent, fields] of Object.entries(overrides)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      problems.push(`the preview for ${agent} is not a field object`);
      continue;
    }
    for (const field of Object.keys(fields)) {
      if (field !== "tools") {
        problems.push(`the preview changes subagents.agentOverrides.${agent}.${field}; the MCP flow merges only the tools field of subagents.agentOverrides`);
      }
    }
  }
  problems.push(...agentOverrideProblems(overrides, options));
  return problems;
}

/** Apply a confirmed preview to a settings file, touching only the fields the preview names. */
export function mergeAgentOverrides(settings, preview) {
  const merged = JSON.parse(JSON.stringify(settings ?? {}));
  for (const [agent, fields] of Object.entries(preview?.agentOverrides ?? {})) {
    merged.subagents ??= {};
    merged.subagents.agentOverrides ??= {};
    merged.subagents.agentOverrides[agent] = {
      ...(merged.subagents.agentOverrides[agent] ?? {}),
      ...JSON.parse(JSON.stringify(fields)),
    };
  }
  return merged;
}

/** Validate every tagged example this package ships, so a doc example cannot drift from the host shape. */
function docExampleProblems(files, root) {
  const problems = [];
  const found = new Map();
  for (const [path, { bytes }] of files) {
    if (!path.endsWith(".md")) continue;
    for (const [kind, bodies] of taggedExamples(bytes.toString("utf8"))) {
      if (!found.has(kind)) found.set(kind, []);
      for (const body of bodies) found.get(kind).push({ path, body });
    }
  }
  const single = (kind) => {
    const entries = found.get(kind) ?? [];
    if (entries.length !== 1) problems.push(`${OUTPUT} ships ${entries.length} ${kind} examples; it needs exactly one`);
    return entries[0];
  };

  const roles = setupRoleTable(root);
  const models = single("pstack-models");
  if (!roles) problems.push("pstack/skills/setup-pstack/SKILL.md no longer carries a # budget role example");
  if (models) {
    for (const problem of roleModelProblems(models.body, { roles: roles ?? undefined })) {
      problems.push(`${OUTPUT}/${models.path}: ${problem}`);
    }
  }

  const servers = single("pstack-mcp-servers");
  let serverNames = {};
  if (servers) {
    let config;
    try {
      config = JSON.parse(servers.body);
    } catch {
      problems.push(`${OUTPUT}/${servers.path}: the mcpServers example is not valid JSON`);
    }
    if (config) {
      for (const problem of mcpServersProblems(config)) problems.push(`${OUTPUT}/${servers.path}: ${problem}`);
      serverNames = config.mcpServers ?? {};
    }
  }

  const merge = single("pstack-agent-overrides-merge");
  if (merge) {
    let parsed;
    try {
      parsed = JSON.parse(merge.body);
    } catch {
      problems.push(`${OUTPUT}/${merge.path}: the agent override example is not valid JSON`);
    }
    if (parsed) {
      for (const problem of mcpPreviewProblems(parsed.preview, { servers: serverNames })) {
        problems.push(`${OUTPUT}/${merge.path}: ${problem}`);
      }
      for (const problem of agentOverrideProblems(parsed.after?.subagents?.agentOverrides, { servers: serverNames })) {
        problems.push(`${OUTPUT}/${merge.path}: ${problem}`);
      }
      const merged = mergeAgentOverrides(parsed.before, parsed.preview);
      if (JSON.stringify(merged) !== JSON.stringify(parsed.after)) {
        problems.push(`${OUTPUT}/${merge.path}: the "after" settings are not the preview merged into "before"`);
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
- The MCP flow at \`docs/harness/pi/mcp-setup.md\`, generated from \`pstack/docs/harness/pi/mcp-setup.md\`. It is the one host difference with its own flow, and the adapter links it locally.
- The pstack guide in \`docs/guide/\`, the upstream pstack README as \`README.upstream.md\`, and both MIT licenses: \`LICENSE\` for pstack and \`licenses/cursor-team-kit-LICENSE\` for the bundled Cursor Team Kit skills. The copyright lines are kept verbatim.
- \`package.json\` declares \`pi.skills\` as \`./skills\` and \`pi-subagents.agents\` as \`./agents\`, the native Pi and pi-subagents discovery fields. The same skills also live in the conventional \`skills/\` directory.

Markdown links between packaged files are relative links inside this directory. Links to upstream files that this package does not ship, such as the automations and the Claude Code adapter, point at the public \`cursor/plugins\` repository, the same GitHub fallback the Claude Code tree uses.

## Setup

The setup wizard is the packaged \`setup-pstack\` skill. In Pi it writes one user-level file in Pi's agent directory, \`~/.pi/agent/pstack-models.md\` by default, with one line per role: \`provider/model-id:level\`, where the level is one of Pi's thinking levels (\`off\`, \`minimal\`, \`low\`, \`medium\`, \`high\`, \`xhigh\`, \`max\`). \`auto\`, \`inherit-parent\`, and a missing line all mean omit \`model\` and let Pi resolve it with its normal host resolution. The wizard keeps its role table, panel lists, budget question, and confirmation step; \`unlimited\`, \`large\`, \`medium\`, and \`small\` set the level instead of rewriting an effort token. A panel list runs one child per entry, and the same model repeated is repeated runs, not a cross-model review. Role lines never go into project instructions, the global default model is never changed, and a configured model that fails is reported instead of being swapped or downgraded. \`docs/harness/pi.md\` carries the exact rules, the role example, and the budget mapping.

MCP is the one host difference with its own flow: \`docs/harness/pi/mcp-setup.md\`. It uses the servers the operator already configured in \`~/.pi/agent/mcp.json\`, in a trusted project's \`.pi/mcp.json\`, or in an installed adapter's config, and it installs and connects nothing. Only an agent that needs a direct MCP tool gets static \`mcp:<server>/<tool>\` entries in \`subagents.agentOverrides.<name>.tools\`, after a preview and a confirmation that merge only those fields, then a reload or restart. pi-subagents 0.81.0 reads an agent's \`tools\` as a strict allowlist, so the flow never writes \`+codemode\`: it stays a literal unknown name and the launch fails. A passing selector or settings check is not proof of connectivity.

## External prerequisites and boundaries

- Model authentication and the model list come from the operator's Pi install. This package ships no provider table, alias map, or model resolver.
- MCP servers and their credentials are the operator's. This package ships no server definition, installs no adapter, and connects to nothing.
- The \`bun:test\` suites under \`pstack/skills/poteto-mode/scripts/\` need Bun, which this package neither installs nor assumes. The \`statechart\` tests keep their original skip when TLC is absent and do not download it.
- Skills with external prerequisites, such as \`make-bot-ui\`, ship as written. Their prerequisites stay the operator's.
- Skill authoring uses a skill-authoring skill the operator already has. When none is installed, the workflow pauses that step and asks the operator to install one; it does not install anything and does not carry a writing, scoring, or description-optimization toolchain.
- The package README is the only setup documentation outside the adapter and the MCP flow. There is no second wizard, no separate model-setup or skill-authoring flow document, and no model router.

## Current boundary

This package ships the skills, the three agents, the adapter, the role-model setup rules, the MCP flow, and the fork-only automation as source: \`scripts/pstack-pi/sync.mjs\` with \`.github/workflows/pstack-pi-sync.yml\` builds and pushes the \`pi-candidate\` branch, and \`.github/workflows/pstack-pi-validate.yml\` runs the read-only candidate check and report. Both workflows are delivered but not enabled or remotely verified: they wait for the dedicated GitHub App, the protected \`pstack-pi-write\` Environment, and a real Actions run described in the repository README, so no remote workflow has run. Skills still mention Cursor-only features; those source sentences are preserved and the adapter states what Pi does instead.

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
  add(MCP_FLOW_SOURCE);
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
  problems.push(...docExampleProblems(files, root));
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
