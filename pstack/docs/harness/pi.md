# pstack in Pi

pstack skills use Cursor names. In Pi, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the installed pstack package: the directory that holds `skills/`, `agents/`, and `docs/`. If a Cursor field has no row, drop it and say so. Never pass a field or a value that the `subagent` tool schema rejects. MCP is the one host difference with its own flow: read [the Pi MCP setup](pi/mcp-setup.md) before you configure a delegate or classify an evidence source.

## Tools

| Cursor | Pi |
| --- | --- |
| `Task` | `subagent`, with `agent` and `task`. One wave of independent children is a workflow script that awaits `runs.all([{ key, agent, task }, ...])`; a step that consumes an earlier result is an awaited `runs.run(...)`, in dependency order. `runs.all` resolves to an ordered array, not a key map, so index it or map it. |
| `AskQuestion` | Pi has no question tool. Ask in your reply and stop until the operator answers. |
| Open a todolist | Pi has no todolist tool. Keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | Read `<pstack>/skills/<name>/SKILL.md` and follow it, including its supporting files. When you tell the user to type it, write `/skill:<name>`. |
| `Grep`, `Glob` | `grep` and `find` when the session has them, otherwise `bash` with `rg` or `git ls-files`. |

## Subagent fields

| Cursor | Pi |
| --- | --- |
| `subagent_type: generalPurpose` | `agent: "pstack.helper"`. Its role comes from the brief you write, not from the agent file. |
| `poteto-agent`, `comment-sicko` | `agent: "pstack.poteto-agent"`, `agent: "pstack.comment-sicko"`. |
| `readonly: true` | Drop the field. Keep the read-only requirement in the task and keep `bash`: Pi's read-only instruction is a task constraint, not a sandbox, so never call it enforced. Check `git status` afterward. |
| `readonly: false` | Drop the field. Writable work still comes from the task, as before. |
| `environment: "cloud"` | `worktree: true`. That is a managed worktree on this machine, not a cloud machine: no dashboard, no hosted lifetime, no separate machine to inspect. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | `options.baseRef`, with `HEAD`, `refs/heads/<b>`, `refs/tags/<tag>`, or `origin/<b>`. A full commit id or a revision expression is refused: for an exact commit, prepare a normal Git worktree yourself and pass that path as `cwd`. |
| `run_in_background: true` | `async: true`. The native completion notice wakes you when the child finishes; do not poll, sleep, or re-read status in a loop. |
| `resume` | Resume the retained run natively: `subagent({ action: "resume", id, message })` for a direct child, or `resume` inside `runs.run`. When the run is not eligible, start a new agent and hand it the earlier result and state, as the workflow already says. Pi does not revive a dead process, so never say it did. |
| `file_attachments` | Name the files in the task with their paths. There is no attachment field. |

Nesting is a grant on the agent, not a tool allowlist: `allowNestedSubagents` gives that child the child-safe `subagent` tool, and the host's depth and capability ceilings still apply. Delegate only what the original workflow and the parent's task authorize, and do not add `maxSubagentDepth` or an `allowedAgents` list to imitate a fixed depth you picked.

## Reading results

Read what a child actually returned: its `output`, the output file it saved, the file references it names, and the run's artifact paths. A launch receipt, a running status, or `ok` on the launch is not acceptance of the work; the original workflow still decides what done means.

Do not add an `outputSchema`, a `gate`, a uniform return format, or a global file-only output because the host offers them. Use them only where the workflow itself asks for that shape, and use file-only output only when a saved file is what the parent needs. `reflect` and every other full-body contract stay exactly as written.

New work gets a new agent, but that is not an order to pass a fresh context every time. Keep the context choice the workflow names.

## Models

| Cursor | Pi |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh` | Never pass the Cursor slug as `model`. Pass the role's value from the [role-model file](#role-model-file), or, when the role has none, omit `model` and Pi resolves its normal default. Report a configured value that fails; never swap in another model or drop a reasoning level silently, and never fall back to the slug the skill names. |
| A `grok-*`, `gpt-*`, or other Cursor slug | Never pass it. The same rule applies: the role's configured value, or no `model`. |
| `auto` or `inherit-parent` | Omit `model`. The role runs on the parent session model, which is how Auto users stay on Auto. |
| A `-fast` slug, such as `grok-4.7-xhigh-fast` | Not Pi's `fast: true`. In Cursor the suffix names a faster model variant; in Pi `fast: true` asks for the OpenAI priority service tier on a native `openai-codex` child, which can cost more and draw on a higher quota tier, and it fails before launch on any other provider. Keep the two apart: choose the intended Pi model id explicitly, and set `fast: true` only when the operator asks for that service tier. |
| The `pstack-models.mdc` rule | Replace it with the role-model file below. Never write role lines into project instructions, and never set `defaultModel` or `defaultThinkingLevel`. Pi never reads `.mdc` files. If the file or a role's line is missing, omit `model` and say the role has no configured model. |

### Role model file

`/setup-pstack` keeps the same wizard and writes the same roles to `<agent-dir>/pstack-models.md`, which is `~/.pi/agent/pstack-models.md` by default. Every role value is `provider/model-id:level`, where `level` is one of Pi's thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `auto`, `inherit-parent`, and a missing line all mean: omit `model`.

The skill's steps stay as written. Detect the models this session can actually pass: the `/model` picker, `/subagents-models`, or the values the operator names. Ask for one of the four budgets, then set `level` from it instead of rewriting an effort token inside a slug: `unlimited` sets `max`, `large` sets `xhigh`, `medium` sets `high`, and `small` sets `medium`. Pi clamps a level the chosen model does not support, and the wizard reports the level it wrote. Show the full role table with its model per role, mark any model this session cannot resolve as needing a choice, and ask for confirmation before writing. Keep every panel list: one child per entry, so the list length is the run count, and the same model repeated is that many runs of one model, not a cross-model review. Say so in the report rather than calling it one. Write the whole file on a rerun so the result is idempotent.

The role labels, the panel lists, and the `# budget` line mirror step 5 of `skills/setup-pstack/SKILL.md`. The package check fails when the example below loses a role, shortens a panel, or drifts from the budget mapping, so change both or neither.

```text pstack-models
# pstack role models for Pi. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent session model, so omit `model`.
# A panel list runs one child per entry, even when its entries share a model.
# budget: large (xhigh)
feature, refactoring: provider/model-id:high
bug-fix: provider/model-id:high
perf-issue: provider/model-id:high
hillclimb: provider/model-id:high
judgment and prose: provider/model-id:xhigh
hardest tasks: provider/model-id:xhigh
how explorer: provider/model-id:high
how explainer: provider/model-id:xhigh
why investigators: provider/model-id:high
why synthesizer: provider/model-id:xhigh
reflect tooling: provider/model-id:high
reflect judgment, divergent, synthesizer: provider/model-id:xhigh
arena runners: provider/model-id:xhigh, provider/other-model-id:xhigh
arena cross-judge pool: provider/model-id:xhigh, provider/other-model-id:xhigh
swarm workers: provider/model-id:high
architect runners: provider/model-id:xhigh, provider/other-model-id:xhigh
interrogate reviewers: provider/model-id:xhigh, provider/other-model-id:xhigh
```

Read the file when you dispatch a role, not once per session: a change applies to the next launch. Pass the role's value as `model` on the `subagent` call, or on the `runs.run`/`runs.all` item, so the role decides the model and the agent file does not. When a launch fails on a configured model, report the role, the configured value, and Pi's error, then stop that role: do not retry on another model, drop the level, or call it done.

Never add a provider table, an alias map, or a model-resolution extension. Pi's registry already resolves `provider/model-id`, and a personal table would pin one operator's providers into the package.

## MCP

MCP is the one host difference with its own flow: read [the Pi MCP setup](pi/mcp-setup.md) before you configure a delegate or classify an evidence source. In short:

| Cursor | Pi |
| --- | --- |
| `mcps/`, the available-tools map, "list the available MCPs" | Read the `mcp_servers` section of the system prompt and the server names in `<agent-dir>/mcp.json` plus the trusted project's `.pi/mcp.json`, or the installed adapter's config. Classify a server from its name, description, and tools without connecting it. |
| A readonly task keeps its MCP access | A read-only task loses no MCP tool: Pi does not strip MCP for it, and the delegate's own `tools` list decides what it has. |

Only an agent that needs a direct MCP tool gets `mcp:<server>/<tool>` entries in its `tools`, merged as `subagents.agentOverrides.<name>.tools` after a preview and a confirmation. Pi's built-in MCP and an installed `pi-mcp-adapter` both work; never install an adapter, a server, or an extension to follow the flow, and never connect or sign in to prove the edit. A passing selector or settings check is not proof of connectivity: the operator runs `/mcp` or `pi mcp list` and a real call.

pi-subagents 0.81.0 reads an agent's `tools` as a strict allowlist, so never write `+codemode` or another `+tool` there: that is Pi's `defaultTools` syntax, it stays a literal unknown name inside an allowlist, and the launch fails once `mcp:` selections are resolved too. Write plain names such as `codemode`, `read`, and `bash`, and do not add a tool-list synchronizer or a `+` expander.

## Paths

| Cursor | Pi |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/` for the project and `~/.pi/agent/skills/` for the user. Prefer a skills directory the project already uses; with no project convention, use `.pi/skills/`. Skills this package ships are already in `<pstack>/skills/`. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `<pstack>/`, whose `package.json` declares the skills, the agent directory, and this adapter. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` (or `CLAUDE.md`) in the directory where the rule applies, for the content and the scope the rule states. `.mdc` files are never loaded. Model lines are the exception; see Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when this package ships that file. Read the local copy and never fetch it; give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Pi sessions are JSONL under `~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl`, where `<path>` is the workspace path with its leading separator and each `/`, `\`, and `:` replaced by `-`. "The current session" keeps its original meaning: the session Pi is running now, whose file keeps growing. Read that file directly. Pi has no transcript resolver, so do not build one, bridge sessions, rebuild an active branch, or de-duplicate compaction. |

### Worktree audit

`worktree-audit.sh` reports the newest Cursor chat that touched each worktree. That scan does not cover Pi sessions, so an empty `LAST_CHAT` does not prove a worktree is idle. Check activity the way the playbook already says, and do not rewrite the script or add a transcript scanner.

## Cursor-only features

Pi has no Custom Modes, no `/loop` command, no Cursor Automations, no Bugbot, no cloud console, and no built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Pi: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. Pause only the steps that depend on the missing capability, and leave a placeholder for anything a later step needs from it.

| Cursor | Pi |
| --- | --- |
| A Custom Mode | Load the skill explicitly instead, once per task: read `<pstack>/skills/<name>/SKILL.md` or start the task with `/skill:<name>`. No mode stays in context between turns. |
| `/loop`, routine wakes, interval heartbeats | Use the scheduling or wakeup the host already has: a pi-subagents schedule, or a child that wakes you on completion. With neither, skip with the line. Do not add a scheduler. |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
| The built-in `create-skill` skill | Use an installed skill-authoring skill when the operator has one. If none is installed, say which step needs one and ask the operator to install it, then pause that step. Do not install anything yourself, do not hand-write a fallback authoring template, and do not carry a writing, scoring, or description-optimization toolchain in this package. The `create-verification-skill` and `create-formal-verification-skill` steps are pstack skills in this package, so they keep working; point the user at `/skill:<name>`. |

## Records

The pstack ledger (`ledger.tsv`, through `orch ledger record`) and Pi's own run records keep separate jobs: the ledger answers whether a unit was verified, while Pi's run status and artifacts describe one run. Do not sync them both ways and do not force a second record of the same fact.

`reflect` keeps its own behavior as written: the user's skills are handled as it says, the Backlog entry is committed as it says, the review material is complete, and the approval boundary is the one the skill states. Do not add a platform approval step on top.
