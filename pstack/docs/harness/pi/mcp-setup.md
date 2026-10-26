# MCP setup in Pi

pstack skills use MCP servers for external evidence: tickets, long-form docs, team chat, observability, error tracking, analytics. MCP is the one host difference with its own flow; every other Cursor name is mapped in the [Pi adapter](../pi.md).

Run this flow only when a skill or a delegate needs a direct MCP tool. Listing which evidence sources exist needs no configuration: read the servers, as the adapter says.

## 1. Confirm what the work needs

Ask which service the task actually needs and which evidence category it serves. Do not configure a server because it is installed: configure the one the task names. Source control usually arrives through `git` and `gh` and needs no server. If the operator cannot name the service, stop and say the category has no source; that gap is a finding, not a reason to install something.

## 2. Use the server configuration the host already has

Read the configuration; do not connect it:

- `<agent-dir>/mcp.json`, which is `~/.pi/agent/mcp.json` by default, for user-level servers.
- `.pi/mcp.json` in a trusted project for project servers.
- The installed adapter's own configuration when one is installed. Pi's built-in MCP and `pi-mcp-adapter` both work: the adapter replaces the built-in `/mcp` and reads its own files, and `mcp:` selections then resolve from the adapter. Do not install an adapter to follow this flow, and do not migrate an operator between the two.

The entry shape the host reads, for reference only; this flow never writes it:

```json pstack-mcp-servers
{
  "mcpServers": {
    "docs": {
      "url": "https://mcp.example.com/mcp",
      "description": "Search and read the product documentation"
    },
    "tickets": {
      "command": "npx",
      "args": ["-y", "@example/tickets-mcp"],
      "env": { "TICKETS_TOKEN": "${TICKETS_API_TOKEN}" }
    }
  }
}
```

If the needed server is missing, give the operator the `pi mcp add` command that would add it and let them run it. This flow installs nothing, never connects, never signs in, and never reconnects.

## 3. Give only the agent that needs it a static selection

pi-subagents 0.81.0 resolves `mcp:<server>/<tool>` entries in an agent's `tools` list as direct MCP selections. The entry is static: it names a server and tool that the configuration above already defines. It discovers nothing, synchronizes nothing, and connects to nothing.

Only the agent that needs the direct tool gets the entry; every other agent keeps its tools. A `tools` list is a strict allowlist, so the list must repeat the normal and extension tools that agent already uses. An override that lists only MCP tools strips `read`, `bash`, and the extension tools the brief relies on. A selected tool is a hard dependency: the child waits for that server's current connection attempt and the launch is rejected when the tool is missing, or hidden by the server's exposure. When an installed adapter provides the tools, that agent must run as a background child (`async: true`), because a foreground child loads no ambient extensions; the three packaged agents already do.

Show this preview, then stop for confirmation:

```json pstack-agent-overrides-merge
{
  "before": {
    "defaultModel": "provider/model-id",
    "subagents": {
      "agentOverrides": {
        "pstack.helper": { "thinking": "high" },
        "pstack.comment-sicko": { "tools": ["read", "bash"] }
      }
    }
  },
  "preview": {
    "agentOverrides": {
      "pstack.helper": {
        "tools": ["read", "bash", "grep", "find", "ls", "fixture_search", "mcp:docs/search"]
      }
    }
  },
  "after": {
    "defaultModel": "provider/model-id",
    "subagents": {
      "agentOverrides": {
        "pstack.helper": {
          "thinking": "high",
          "tools": ["read", "bash", "grep", "find", "ls", "fixture_search", "mcp:docs/search"]
        },
        "pstack.comment-sicko": { "tools": ["read", "bash"] }
      }
    }
  }
}
```

Read the three parts:

- `before` is the settings file as it is: the operator's own global default model, another role's fields, and the target role's existing fields all stay.
- `preview` is the only change: `tools` for the named agent. It carries the whole list, because the override replaces any frontmatter `tools` and a non-empty list is the allowlist. `fixture_search` stands for an extension tool the agent already uses; keep the real name.
- `after` is the file after the confirmed merge. Only those fields differ; every other key and every other role is unchanged.

Ask before writing: show the preview, say which file it goes into and which fields it changes, and merge only those `agentOverrides` fields. Do not rewrite the file from scratch, reformat unrelated keys, touch a role the preview does not name, or add `model`, `thinking`, or any global setting. If the operator declines, change nothing.

## 4. Reload, then let the operator verify

The change takes effect after `/reload`; restart Pi after editing `mcp.json` or adding a server, and after connecting a server for the first time when the installed adapter caches tool metadata at startup. Ask the operator to check with `/mcp` or `pi mcp list` and one real call.

A validated selection proves the configuration shape and that the server name exists; it is not proof of connectivity. This flow never proves the edit by connecting: the server may be down, unauthorized, missing the tool, or reachable only from the operator's machine.

## Known issue: `+tools` next to MCP selections

pi-subagents 0.81.0 parses an agent's `tools` list as a strict allowlist of tool names. The `+name` form is Pi's `defaultTools` syntax, which applies to settings and the command line, not to an agent's allowlist. So `+codemode` in an agent's `tools` stays a literal name: it does not add `codemode`, it does not keep the default tools, and the launch fails when the strict allowlist meets a registry without that tool. Put `mcp:` selections in the same list and the launch resolves them too before it fails, so the report carries a registration mismatch for both and the real cause is easy to mistake for a broken MCP entry.

Do not write `+codemode` or any other `+tool` in an agent's `tools`. Write the plain names the child needs, such as `codemode`, `read`, and `bash`. Do not add a tool-list synchronizer, a `+` expander, or a wrapper that hides the grammar; the host owns it.

## What this flow does not do

- Install an adapter, a server, or an extension, or run `pi mcp add` for the operator.
- Connect, sign in, reconnect, or test a server call.
- Discover tools, synchronize a tool list, or inject tools per run.
- Edit project instructions or change a global model or tool default.
- Treat a passing check as a working connection.
