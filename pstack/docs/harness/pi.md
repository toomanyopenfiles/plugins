# pstack in Pi

pstack skills use Cursor names. In Pi, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the installed pstack package: the directory that holds `skills/`, `agents/`, and `docs/`. If a Cursor field has no row, drop it and say so. Never pass a field or a value that the `subagent` tool schema rejects.

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
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh` | Never pass the Cursor slug as `model`. Use the role's model from the Pi role-model configuration when the operator set one; otherwise omit `model` and let Pi resolve its normal default. Report an explicit configuration that fails; never swap in another model or drop a reasoning level silently. |
| A `grok-*`, `gpt-*`, or other slug Pi does not know | Omit `model`, as above. |
| `auto` or `inherit-parent` | Omit `model`. |
| The `pstack-models.mdc` rule | The role lines live in Pi's own role-model configuration in the Pi agent directory, never in project instructions, and Pi never reads `.mdc` files. If the file or the role's line is missing, use the skill's default and say so. |

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

## Records

The pstack ledger (`ledger.tsv`, through `orch ledger record`) and Pi's own run records keep separate jobs: the ledger answers whether a unit was verified, while Pi's run status and artifacts describe one run. Do not sync them both ways and do not force a second record of the same fact.

`reflect` keeps its own behavior as written: the user's skills are handled as it says, the Backlog entry is committed as it says, the review material is complete, and the approval boundary is the one the skill states. Do not add a platform approval step on top.
