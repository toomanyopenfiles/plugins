import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeSource, runScript, writeSkill } from "./helpers.mjs";

const output = "harness/pstack/pi";
const adapter = "docs/harness/pi.md";

function generated(t) {
  const root = makeSource(t);
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

// Each row is a decision the ticket names, so the adapter cannot quietly lose one.
const coverage = [
  [/`Task`/, "`Task` maps to the subagent tool"],
  [/`subagent`/, "the subagent tool is named"],
  [/runs\.all/, "a parallel wave uses runs.all"],
  [/ordered array, not a key map/, "runs.all resolves to an ordered array"],
  [/in dependency order/, "dependent steps keep their order"],
  [/pstack\.helper/, "generalPurpose maps to pstack.helper"],
  [/pstack\.poteto-agent/, "the poteto delegate keeps its pstack name"],
  [/pstack\.comment-sicko/, "the comment reviewer keeps its pstack name"],
  [/`AskQuestion`/, "asking is mapped"],
  [/todolist/, "the todolist is mapped"],
  [/`Grep`, `Glob`/, "search falls back to the shell"],
  [/\/skill:<name>/, "the user-facing command is /skill:<name>"],
  [/`readonly: true`/, "the read-only field is mapped"],
  [/not a sandbox/, "a read-only task claims no sandbox"],
  [/`environment: "cloud"`/, "the cloud environment is mapped"],
  [/not a cloud machine/, "a worktree is not called a cloud machine"],
  [/options\.baseRef/, "the base ref field is named"],
  [/full commit id/, "a full commit id is refused"],
  [/`cwd`/, "an exact commit is reached through cwd"],
  [/`run_in_background: true`/, "the background field is mapped"],
  [/completion notice/, "background completion is a native notice"],
  [/do not poll/, "polling is refused"],
  [/`resume`/, "the resume field is mapped"],
  [/does not revive a dead process/, "resume claims no process revival"],
  [/`file_attachments`/, "attachments are mapped"],
  [/`output`/, "the real output is read"],
  [/artifact paths/, "artifacts are read"],
  [/is not acceptance/, "a launch receipt is not acceptance"],
  [/`outputSchema`/, "no forced output schema"],
  [/file-only/, "no global file-only output"],
  [/`reflect`/, "reflect keeps its contract"],
  [/`claude-<family>/, "Cursor model slugs are mapped"],
  [/`grok-\*`/, "a grok slug is mapped"],
  [/`gpt-\*`/, "a gpt slug is mapped"],
  [/inherit-parent/, "inherit-parent is mapped"],
  [/pstack-models\.mdc/, "the role model file is mapped"],
  [/\.pi\/skills\//, "project skills map to .pi/skills/"],
  [/~\/\.pi\/agent\/skills\//, "user skills map to the Pi agent directory"],
  [/`AGENTS\.md`/, "Cursor rules map to project instructions"],
  [/~\/\.pi\/agent\/sessions\//, "the transcript path is mapped"],
  [/current session/, "the current session keeps its meaning"],
  [/LAST_CHAT/, "the worktree audit note names the column"],
  [/worktree-audit\.sh/, "the worktree audit script is named"],
  [/`ledger\.tsv`/, "the pstack ledger is named"],
  [/`gh pr create`/, "the built-in PR tool falls back to the forge command"],
  [/Bugbot/, "Bugbot has a row"],
  [/Automations/, "Cursor Automations have a row"],
  [/Custom Mode/, "Custom Modes have a row"],
  [/\/loop/, "the loop command has a row"],
  [/Skipped in Pi: <step>/, "a missing capability is reported in one line"],
];

test("the package ships the Pi adapter as a source document", (t) => {
  const root = generated(t);
  assert.equal(
    readFileSync(join(root, output, adapter), "utf8"),
    readFileSync(join(root, "pstack", "docs", "harness", "pi.md"), "utf8"),
  );
});

test("the adapter carries every decision this package depends on", (t) => {
  const text = readFileSync(join(generated(t), output, adapter), "utf8");
  for (const [pattern, reason] of coverage) assert.match(text, pattern, `the Pi adapter does not state: ${reason}`);
});

test("the adapter names no local machine path or personal provider", (t) => {
  const text = readFileSync(join(generated(t), output, adapter), "utf8");
  assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|[A-Za-z]:\\\\/);
  assert.doesNotMatch(text, /\b(?:github-copilot|anthropic|openai)\/[a-z0-9.-]+/i);
});

test("a host difference the adapter does not explain fails generation", (t) => {
  const root = makeSource(t);
  const source = join(root, "pstack", "docs", "harness", "pi.md");
  writeFileSync(source, readFileSync(source, "utf8").replace(/`file_attachments`/g, "attachments"));
  writeSkill(root, "zzz-attachments", "A fixture that forwards attachments.", "# Fixture\n\nPass `file_attachments` through.\n");
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the Pi adapter does not mention `file_attachments`, used by skills\/zzz-attachments/);
});

test("the adapter source is required", (t) => {
  const root = makeSource(t);
  rmSync(join(root, "pstack", "docs", "harness", "pi.md"));
  const result = runScript("generate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required source pstack\/docs\/harness\/pi\.md/);
});
