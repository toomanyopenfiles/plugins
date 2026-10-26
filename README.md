# Cursor plugins

Official Cursor plugins for popular developer tools, frameworks, and SaaS products. Each plugin is a standalone directory at the repository root with its own `.cursor-plugin/plugin.json` manifest.

## Plugins

| `name` | Plugin | Author | Category | `description` (from marketplace) |
|:-------|:-------|:-------|:---------|:-------------------------------------|
| `teaching` | [Teaching](teaching/) | Cursor | Utilities | Skill mapping, practice plans, and learning retrospectives. |
| `continual-learning` | [Continual Learning](continual-learning/) | Eric Zakariasson | Developer Tools | Incremental transcript-driven memory updates for AGENTS.md using high-signal bullet points only. |
| `cursor-team-kit` | [Cursor Team Kit](cursor-team-kit/) | Eric Zakariasson | Developer Tools | Internal team workflows for CI, code review, shipping, local automation, and verification. |
| `thermos` | [Thermos](thermos/) | Cursor | Developer Tools | Thermo-nuclear branch review: deep security/correctness audits, harsh code-quality rubrics, parallel subagents, thermos orchestration, and optional merge-ready PR flows. |
| `create-plugin` | [Create Plugin](create-plugin/) | Cursor | Developer Tools | Scaffold and validate new agent plugins. |
| `ralph-loop` | [Ralph Loop](ralph-loop/) | Cursor | Developer Tools | Iterative self-referential AI loops using the Ralph Wiggum technique. |
| `agent-compatibility` | [Agent Compatibility](agent-compatibility/) | Cursor | Developer Tools | CLI-backed repo compatibility scans plus agents that audit startup, validation, and docs against reality. |
| `cli-for-agent` | [CLI for Agents](cli-for-agent/) | Eric Zakariasson | Developer Tools | Patterns for designing CLIs that coding agents can run reliably: flags, help with examples, pipelines, errors, idempotency, dry-run. |
| `pr-review-canvas` | [PR Review Canvas](pr-review-canvas/) | Cursor | Developer Tools | Render PR diffs as review canvases grouped by importance. |
| `docs-canvas` | [Docs Canvas](docs-canvas/) | Cursor | Developer Tools | Render documentation as a navigable canvas. |
| `cursor-sdk` | [Cursor SDK](cursor-sdk/) | Cursor | Developer Tools | Build apps, scripts, and automations with the TypeScript SDK. |
| `origin-apps` | [Origin Apps](origin-apps/) | Cursor | Developer Tools | Skills for building on the Cursor Origin API. Fetch the live spec first, then follow the Origin rules for credentials, scopes, webhooks, paging, and errors. Includes a skill that plans the port of an existing GitHub App. |
| `orchestrate` | [Orchestrate](orchestrate/) | Cursor | Developer Tools | Fan large tasks out across parallel cloud agents with planners, workers, verifiers, and structured handoffs. |
| `pstack` | [pstack](pstack/) | Lauren Tan | Developer Tools | if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence. |
| `dyl-stack` | [dyl-stack](dyl-stack/) | Dylan Gattey | Developer Tools | Dylan's agent style on top of pstack: root causes over symptom patches, The Algorithm before design, terse verified delivery, a PR review that fits in a paste, and Figma-to-UI with a visual judge. |
| `advisor` | [Advisor](advisor/) | Cursor | Developer Tools | Consult a stronger model before major decisions, when stuck, and before declaring done. |
| `grok-voice` | [Grok Voice](grok-voice/) | Eric Zakariasson | Developer Tools | Add Grok voice to an app: realtime speech-to-speech, speech-to-text dictation, text-to-speech read-aloud, and a log-driven fix loop for voice sessions. |
| `gmail` | [Gmail](third_party/gmail/) | Cursor | Productivity | Search, read, draft, and manage email. |
| `google-drive` | [Google Drive](third_party/google-drive/) | Cursor | Productivity | Search, read, create, and share files. |
| `google-calendar` | [Google Calendar](third_party/google-calendar/) | Cursor | Productivity | Search events and schedule meetings. |
| `google-docs` | [Google Docs](third_party/google-docs/) | Cursor | Productivity | Read, create, and edit documents. |
| `google-sheets` | [Google Sheets](third_party/google-sheets/) | Cursor | Productivity | Read, write, and append spreadsheet data. |
| `google-slides` | [Google Slides](third_party/google-slides/) | Cursor | Productivity | Create, edit, and render presentations. |
| `google-ads` | [Google Ads](third_party/google-ads/) | Cursor | Integrations | Report on campaigns, research keywords, and make previewed changes. |
| `gong` | [Gong](third_party/gong/) | Cursor | Integrations | Pull account summaries, deal insights, and call briefs. |
| `salesforce` | [Salesforce](third_party/salesforce/) | Cursor | Integrations | Query, create, and update records in your org. |
| `salesforce-headless-360` | [Salesforce (Headless 360, Beta)](third_party/salesforce-headless-360/) | Cursor | Integrations | Manage records, users, and org setup across Salesforce. |
| `playwright` | [Playwright](third_party/playwright/) | Cursor | Integrations | Navigate, click, screenshot, and test in a real browser. |
| `github` | [GitHub](third_party/github/) | Cursor | Integrations | Manage repos, issues, pull requests, and Actions. |
| `ashby` | [Ashby](third_party/ashby/) | Cursor | Integrations | Search candidates, prep interviews, and manage pipeline tasks. |
| `hubspot` | [HubSpot](third_party/hubspot/) | Cursor | Integrations | Search and update contacts, companies, deals, and tickets. |
| `intercom` | [Intercom](third_party/intercom/) | Cursor | Integrations | Search conversations, contacts, and Help Center articles. |
| `zoom` | [Zoom](third_party/zoom/) | Cursor | Integrations | Search meetings, pull transcripts, and work with Zoom Docs. |
| `x` | [X](third_party/x/) | Cursor | Integrations | Search posts, read timelines, pull trends, explore Spaces and communities, manage lists and bookmarks, access X Chat, schedule X calls, and manage livestreams. |
| `clay` | [Clay](third_party/clay/) | Cursor | Integrations | Enrich people and companies, run AI research agents. |
| `circleback` | [Circleback](third_party/circleback/) | Cursor | Integrations | Search meetings, transcripts, action items, and emails. |
| `docusign` | [Docusign](third_party/docusign/) | Cursor | Integrations | Manage envelopes, templates, workflows, and agreements. |
| `navan` | [Navan](third_party/navan/) | Cursor | Integrations | Query expenses, travel bookings, policies, and cards. |
| `profound` | [Profound](third_party/profound/) | Cursor | Integrations | Track AI visibility, sentiment, and citations. |
| `juicebox` | [Juicebox](third_party/juicebox/) | Cursor | Integrations | Query recruiting analytics, shortlists, and sourcing agents. |
| `outreach` | [Outreach](third_party/outreach/) | Cursor | Integrations | Search sequences, prospects, and Kaia meetings. |
| `amplemarket` | [Amplemarket](third_party/amplemarket/) | Cursor | Integrations | Search people and companies, enrich leads, run sequences. |
| `klaviyo` | [Klaviyo](third_party/klaviyo/) | Cursor | Integrations | Manage profiles, segments, campaigns, and flows. |
| `customer-io` | [Customer.io](third_party/customer-io/) | Cursor | Integrations | Build campaigns, manage segments, and query people. |
| `mailerlite` | [MailerLite](third_party/mailerlite/) | Cursor | Integrations | Manage subscribers, groups, campaigns, and automations. |
| `brevo` | [Brevo](third_party/brevo/) | Cursor | Integrations | Manage contacts, email and SMS campaigns, and CRM deals. |
| `typeform` | [Typeform](third_party/typeform/) | Cursor | Integrations | Build forms, analyze responses, and manage contacts. |
| `jotform` | [Jotform](third_party/jotform/) | Cursor | Integrations | Create and edit forms, then read submissions. |
| `semrush` | [Semrush](third_party/semrush/) | Cursor | Integrations | Research keywords, backlinks, traffic, and competitors. |
| `ahrefs` | [Ahrefs](third_party/ahrefs/) | Cursor | Integrations | Research keywords, backlinks, rankings, and site health. |
| `godaddy` | [GoDaddy](third_party/godaddy/) | Cursor | Integrations | Brainstorm domain names and check availability. |
| `upwork` | [Upwork](third_party/upwork/) | Cursor | Integrations | Search talent, post jobs, and manage contracts. |
| `workable` | [Workable](third_party/workable/) | Cursor | Integrations | Search candidates, move pipelines, and manage HR records. |
| `brex` | [Brex](third_party/brex/) | Cursor | Integrations | Query expenses, receipts, bills, cards, and travel. |
| `todoist` | [Todoist](third_party/todoist/) | Cursor | Integrations | Create, find, and complete tasks and projects. |
| `calendly` | [Calendly](third_party/calendly/) | Cursor | Integrations | Check availability and book, cancel, or reschedule. |
| `smartsheet` | [Smartsheet](third_party/smartsheet/) | Cursor | Integrations | Query and update sheets, rows, and workspaces. |
| `wrike` | [Wrike](third_party/wrike/) | Cursor | Integrations | Search projects, create tasks, and post comments. |
| `coda` | [Coda](third_party/coda/) | Cursor | Integrations | Search docs, read pages, and update tables. |
| `guru` | [Guru](third_party/guru/) | Cursor | Integrations | Search company knowledge and draft verified answers. |
| `fireflies` | [Fireflies](third_party/fireflies/) | Cursor | Integrations | Search meeting transcripts, summaries, and action items. |
| `otter` | [Otter.ai](third_party/otter/) | Cursor | Integrations | Search meeting history and pull full transcripts. |
| `fathom` | [Fathom](third_party/fathom/) | Cursor | Integrations | Search meetings and pull transcripts and summaries. |
| `craft` | [Craft](third_party/craft/) | Cursor | Integrations | Search, create, and update documents and daily notes. |
| `mem` | [Mem](third_party/mem/) | Cursor | Integrations | Capture, search, and organize notes and collections. |
| `readwise` | [Readwise](third_party/readwise/) | Cursor | Integrations | Search highlights and Reader documents, save articles. |
| `similarweb` | [Similarweb](third_party/similarweb/) | Cursor | Integrations | Analyze website traffic, audiences, and competitors. |
| `xero` | [Xero](third_party/xero/) | Cursor | Integrations | Read and write invoices, contacts, reports, and payroll. |
| `x-ads` | [X Ads](third_party/x-ads/) | Cursor | Integrations | Manage ad campaigns, create ads, track conversions, and pull performance stats. |
| `meta-ads` | [Meta Ads](third_party/meta-ads/) | Cursor | Integrations | Manage campaigns, ads, audiences, and catalogs, and pull performance insights. |
| `attio` | [Attio](third_party/attio/) | Cursor | Integrations | Search and update CRM records, lists, notes, and tasks. |
| `hunter` | [Hunter](third_party/hunter/) | Cursor | Integrations | Find and verify emails, discover companies, and save leads. |
| `stable` | [Stable](third_party/stable/) | Cursor | Integrations | Find mail, read scanned documents, and call Stable API endpoints. |
| `gamma` | [Gamma](third_party/gamma/) | Cursor | Integrations | Generate presentations, documents, and webpages. |
| `teams` | [Teams](third_party/teams/) | Cursor | Productivity | Search, read, and send Microsoft Teams chats and channel messages. |
| `sharepoint` | [SharePoint](third_party/sharepoint/) | Cursor | Productivity | Search and read Microsoft SharePoint sites, document libraries, files, and lists. |
| `finance` | [Finance](third_party/finance/) | Cursor | Integrations | Securely connect your accounts so Grok can help with questions about your spending, subscriptions, balances, and investments. |
| `webull` | [Webull](third_party/webull/) | Cursor | Integrations | View accounts, positions, orders, watchlists, and market data. |
| `sp-global` | [S&P Global](third_party/sp-global/) | Cursor | Integrations | Query S&P Capital IQ financials, prices, and transcripts. |
| `interactive-brokers` | [Interactive Brokers](third_party/interactive-brokers/) | Cursor | Integrations | Review positions, balances, P&L, and draft trade instructions. |
| `meltwater` | [Meltwater](third_party/meltwater/) | Cursor | Integrations | Search media and social mentions and pull analytics. |
| `daloopa` | [Daloopa](third_party/daloopa/) | Cursor | Integrations | Pull source-linked fundamentals, KPIs, filings, and prices. |
| `excalidraw` | [Excalidraw](third_party/excalidraw/) | Cursor | Integrations | Draw and export hand-drawn diagrams from chat. |
| `google-cloud-bigquery` | [Google Cloud BigQuery](third_party/google-cloud-bigquery/) | Cursor | Integrations | Explore datasets and tables and run SQL queries. |
| `statsig` | [Statsig](third_party/statsig/) | Cursor | Integrations | Inspect and manage feature gates, experiments, dynamic configs, and metrics. |
| `robinhood` | [Robinhood](third_party/robinhood/) | Cursor | Integrations | View portfolios, positions, orders, watchlists, and market data, and trade in a Robinhood Agentic account. |
| `coinbase` | [Coinbase](third_party/coinbase/) | Cursor | Integrations | Check balances, get quotes, and preview or place trades. |
| `etoro-trading` | [eToro Trading](third_party/etoro-trading/) | Cursor | Integrations | View your eToro portfolio, balances, positions, and watchlists, research instruments and traders, and prepare and place trades. |
| `x-money` | [X Money](third_party/x-money/) | Cursor | Integrations | Use your X Money Card, send money to users on X, manage your finances, view your balance and browse through your transaction history. |
| `shopify-store` | [Shopify](third_party/shopify-store/) | Cursor | Integrations | Connect your Shopify store so Grok can answer questions about products, orders, customers, inventory, and sales. |
| `quickbooks-online` | [QuickBooks Online](third_party/quickbooks-online/) | Cursor | Integrations | Read invoices, bills, expenses, customers, accounts, and financial reports. |
| `workday` | [Workday](third_party/workday/) | Cursor | Integrations | Look up workers, organizations, time off, payroll, and recruiting data in Workday. |
| `whatsapp-business` | [WhatsApp Business](third_party/whatsapp-business/) | Cursor | Integrations | Send messages and manage templates, contacts, and phone numbers in WhatsApp Business. |
| `zoho-crm` | [Zoho CRM](third_party/zoho-crm/) | Cursor | Integrations | Work with leads, contacts, accounts, deals, and other Zoho CRM records. |
| `zoho-desk` | [Zoho Desk](third_party/zoho-desk/) | Cursor | Integrations | Work with tickets, contacts, tasks, and knowledge base articles in Zoho Desk. |
| `zoho-books` | [Zoho Books](third_party/zoho-books/) | Cursor | Integrations | Work with contacts, invoices, estimates, and items in Zoho Books. |
| `square` | [Square](third_party/square/) | Cursor | Integrations | Work with payments, orders, catalog, customers, and invoices. |
| `tailscale` | [Tailscale](third_party/tailscale/) | Cursor | Integrations | Let Grok Bot reach MCP servers on your private Tailscale network. On your own tailnet it joins as one tag:grokbot device; on your team's company tailnet, turned on by a team admin, it uses each member's own device. |
| `highlevel` | [HighLevel](third_party/highlevel/) | Cursor | Integrations | Work with contacts, conversations, opportunities, calendars, and payments. |
| `finary` | [Finary](third_party/finary/) | Cursor | Integrations | Read your net worth, accounts, holdings, spending, and budgets. |
| `tiktok-for-business` | [TikTok for Business](third_party/tiktok-for-business/) | Cursor | Integrations | Manage TikTok ad campaigns, ad groups, ads, audiences, creatives, and reports. |
| `gusto` | [Gusto](third_party/gusto/) | Cursor | Integrations | Work with payroll, employees, contractors, time off, and reports. |
| `gopuff` | [Gopuff](third_party/gopuff/) | Cursor | Integrations | Shop Gopuff from Grok Bot through Gopuff's official MCP server. Sign in with your Gopuff account; Gopuff handles the sign-in, and your searches, carts, and orders go to Gopuff under that account, so any order you place is charged and delivered like a normal Gopuff order. |
| `jobber` | [Jobber](third_party/jobber/) | Cursor | Integrations | Work with clients, requests, quotes, jobs, visits, and invoices. |
| `databricks-genie-one` | [Databricks Genie One](third_party/databricks-genie-one/) | Cursor | Integrations | Ask Databricks Genie questions about your workspace's data in plain language. |
| `lark` | [Lark](third_party/lark/) | Cursor | Integrations | Search, create, and update Lark Suite docs, and read Lark messages and groups. |
| `feishu` | [Feishu](third_party/feishu/) | Cursor | Integrations | Search, create, and update Feishu docs, and read Feishu messages and groups. |
| `framer` | [Framer](third_party/framer/) | Cursor | Integrations | Design, build, and edit your Framer sites, pages, and CMS content. |
| `vanta` | [Vanta](third_party/vanta/) | Cursor | Integrations | Query and remediate compliance tests, controls, frameworks, risks, and vulnerabilities in Vanta. |
Author values match each plugin’s `plugin.json` `author.name` (Cursor lists `plugins@cursor.com` in the manifest).

## Repository structure

This is a multi-plugin marketplace repository. The root `.cursor-plugin/marketplace.json` lists all plugins, and each plugin has its own manifest:

```
plugins/
├── .cursor-plugin/
│   └── marketplace.json       # Marketplace manifest (lists all plugins)
├── plugin-name/
│   ├── .cursor-plugin/
│   │   └── plugin.json        # Per-plugin manifest
│   ├── skills/                # Agent skills (SKILL.md with frontmatter)
│   ├── rules/                 # Cursor rules (.mdc files)
│   ├── mcp.json               # MCP server definitions
│   ├── README.md
│   ├── CHANGELOG.md
│   └── LICENSE
└── ...
```

## Pi candidate sync (fork only)

`toomanyopenfiles/plugins` publishes the pstack-for-Pi package through a persistent candidate branch instead of a release. `.github/workflows/pstack-pi-sync.yml` runs every day at 08:00 Asia/Shanghai (UTC cron `0 0 * * *`) and can also be started by hand. Both triggers behave the same way.

Each round does one of the following:

- **Freeze first.** The workflow looks for any open pull request from `pi-candidate` into `main`, drafts included. If one exists it stops before touching the branch. A manual run does not unfreeze it; only merging or closing that pull request does.
- **Otherwise it syncs.** It pins one `cursor/plugins` commit for the round and merges `main` and that commit into `pi-candidate` with ordinary merges. The package is then rebuilt and checked in a **separate, credential-free job**, and only after that does a third job push the branch. It never resets the branch and never force-pushes: if another writer moved the branch between the freeze check and the push, the run stops instead of overwriting it. A round with nothing new pushes nothing and opens no empty pull request.
- **Merge conflicts stop the round.** The merge is aborted, no conflict state is committed, and nothing is pushed. Resolve it by hand on `pi-candidate`.
- **Build failures still leave a reviewable signal.** The merged source stays committed, but the package is not updated: nothing half-generated is committed, and the run opens a **draft** pull request stating that the committed package is out of sync with this round's source and is not a new candidate. The failing step, its bounded output, and the workflow log link are in the pull request body.

Review the pull request like any other change: it is a normal branch with normal commits, so push fixes to `pi-candidate` as ordinary commits (the freeze only stops the automation), then merge the pull request by hand. Merging keeps `pi-candidate`, so the next round continues from it.

### Trust boundary

The merged candidate tree contains whatever `cursor/plugins` and the fork's `main` agreed on, so the sync treats it as data, never as code:

- The **prepare** job runs scripts from `main`, pins the upstream commit, honours the freeze, and only produces a merged branch plus a bundle of structured metadata.
- The **validate** job rebuilds and checks the package with `node scripts/pstack-pi/generate.mjs` and `node scripts/pstack-pi/check.mjs` taken from `main`. It has no write token, no App key, and no Environment, and it never runs or imports anything carried by the candidate tree.
- The **publish** job runs the script from `main`, re-validates every field it received, and accepts the validated package only as history: exactly one commit, only inside `harness/pstack/pi/`, regular files only. It never checks candidate content out.

Removing token variables from a child process is not a boundary — a child on the same runner can still read its parent's environment — so isolation comes from the separate jobs and the protected Environment, not from environment scrubbing.

### Write credentials

All Pi workflows use the **same dedicated GitHub App**; nothing uses the default `GITHUB_TOKEN` or a personal token:

- Repository permissions: **Contents: read and write**, **Pull requests: read and write**, **Metadata: read**.
- Installation scope: only `toomanyopenfiles/plugins` under the fork owner.
- Repository variable `PSTACK_PI_APP_ID` holds the App id. The App private key exists only as the secret `PSTACK_PI_APP_PRIVATE_KEY` **inside the GitHub Environment `pstack-pi-write`**, and every job that mints the token declares `environment: pstack-pi-write`. Do not create a repository- or organization-level secret with that name; a same-named secret outside the Environment would be readable by unapproved jobs.
- The Environment needs a **deployment branch policy that allows only `main`**, so the key is only released to trusted control-plane runs. The `environment:` field in the YAML selects the Environment but does not protect it; reviewers must add that policy, and any required reviewers, by hand.

`cursor/plugins` stays a read-only input: the sync target is the fork, and `scripts/pstack-pi/sync.mjs` refuses to run against the upstream repository.

### Before this automation can run

**Not enabled in this round.** Three setup steps are still pending and need their own authorization:

1. Install the App on the fork only, add the repository variable `PSTACK_PI_APP_ID`, create the `pstack-pi-write` Environment, put the private key in it as `PSTACK_PI_APP_PRIVATE_KEY`, and give the Environment a deployment branch policy that allows only `main`; re-check that the pinned `actions/create-github-app-token@v2` major version is still the one you reviewed.
2. Disable the inherited `.github/workflows/validate-plugins.yml` runs in the fork's Actions settings. It invokes `node scripts/generate-pstack-harness-trees.mjs --check`, which owns the whole `harness/pstack/` tree and reports the Pi tree as drift. Adding the Pi workflows does not disable it, and editing the inherited YAML or the upstream project's settings is not the fix.
3. Start one round by hand, read the resulting pull request, and only then rely on the schedule.

No App installation, Environment, secret, inherited-workflow disable, or real workflow trigger was performed while these workflows were written. The local regression uses isolated temporary Git repositories, synthetic `gh` responses, and a local-only remote; it is not evidence that the automation is enabled or that a real round has run.

## Pi candidate package

pstack's Pi package is generated at `harness/pstack/pi/`. The candidate validation workflow is `.github/workflows/pstack-pi-validate.yml`; this section covers installing the candidate locally and reading its validation report. Nothing in this section is enabled or triggered by the local test entry.

### Install the candidate locally

1. In your Pi user settings (`~/.pi/agent/settings.json`), pin the generated package by absolute path:

   ```json
   {
     "packages": ["/absolute/path/to/plugins/harness/pstack/pi"]
   }
   ```

   Use the absolute path of your own checkout. `pi install /absolute/path/to/plugins/harness/pstack/pi` writes the same declaration if you prefer the CLI. This repository does not edit user settings or install the package for you.

2. Track the persistent candidate branch with a normal pull:

   ```bash
   git switch pi-candidate
   git pull
   ```

   Do not reset or force-push the branch. Keep `pi-candidate` after merging so the next sync can continue from it.

3. Restart Pi after pulling, then verify in a new session. A package that loads, or a green check, is not by itself evidence that a pstack workflow, subagent, or MCP connection works.

4. After you verify the candidate, merge it into `main` by hand, through the candidate pull request or a local merge. Keep the candidate branch.

This delivery does not publish npm, require a second Pi configuration, add a stable/candidate switcher or a candidate download archive, ask for a manual SHA check, or add an acceptance comment or extra approval step.

### Candidate validation reports

`pstack-pi-validate.yml` has two separate entry paths.

- Candidate pull requests from this repository into `main` whose head branch is `pi-candidate` run only the `validate` job. It checks out the committed candidate head with a `contents: read` token and `persist-credentials: false`, then runs `node scripts/pstack-pi/check.mjs` and `node scripts/pstack-pi/test.mjs`. It does not declare a GitHub Environment, receive an App secret, mint an App token, generate or push to the branch, run a real model or product agent, or upload a candidate artifact; the Git branch is the only candidate delivery path. Pull requests from forks are not candidate reports.
- After that validation run completes, the `workflow_run`-triggered `report` job runs from the trusted `main` workflow definition. It declares the `pstack-pi-write` Environment before it can read the App private key, checks out `main` rather than the candidate head, and runs only `node scripts/pstack-pi/report.mjs`; it never executes candidate scripts. It consumes only trusted `workflow_run` fields (event, path, head branch, repository, PR number, the source run's immutable head SHA, run id and attempt, and conclusion) and verifies the current pull request through the API. The validation result is the GitHub-controlled `workflow_run.conclusion`, never candidate text used as a command.
- The report job maintains one comment marked `<!-- pstack-pi-candidate-report -->` with the checked head, the pass/fail result, and a link to the validation run's Actions log. Repeated runs update the same comment. Native workflow jobs provide the formal PR Checks status when the workflow is enabled.
- The report head is the source run's immutable `head_sha`, not the pull request association's current head. Immediately before writing, the report script reads the pull request's current head again and rechecks that the pull request is still the open `pi-candidate` → `main` candidate in this repository. A run for an older head, a closed or mismatched pull request, or an older run for the same head exits without writing, so an old conclusion cannot be attributed to a newer head and a stale run cannot overwrite a newer report.

One dedicated App, not installed by this delivery:

- Both candidate workflows must use the same App and the same protected write boundary. Its public App ID is repository variable `PSTACK_PI_APP_ID`; its private key is the `PSTACK_PI_APP_PRIVATE_KEY` secret inside the `pstack-pi-write` Environment. The sync workflow's credentialed job must also declare that Environment. Its existing `PSTACK_PI_SYNC_APP_ID` and `PSTACK_PI_SYNC_APP_PRIVATE_KEY` entries, if still present, must refer to this same App ID and private key, not a second App; prefer consolidating both workflows on the shared names above.
- Install the App only on `toomanyopenfiles/plugins`. Grant Issues: write and Pull requests: write for this report job, plus the contents write permission the sync workflow requires; the report token requests only Issues and Pull requests write, and Metadata: read is implicit.
- Create the `pstack-pi-write` Environment and set its deployment branch policy to `main` only. Do not allow all protected branches, `pi-candidate`, or pull request merge refs.
- Store the private key only in that Environment, never at repository or organization level. Do not leave a same-named repository or organization secret that a candidate-modified pull request workflow could read. The YAML `environment:` field alone is not a substitute for the Environment policy; verify the policy manually before enabling the workflow.
- Keep the fork's default workflow token permissions read-only. A same-repository candidate can rewrite its own pull request workflow file, so the checked-in read-only declaration is not a substitute for the repository setting or the Environment policy.
- Never commit the private key or any token.

`node scripts/pstack-pi/validate.mjs` statically checks the checked-in workflow for the two entry paths, the `workflow_run` source conditions, read-only validation permissions and checkout, the `pstack-pi-write` Environment, the shared App names, controlled report fields, the trusted `main` checkout, and the shell boundary. It does not contact GitHub.

### Not enabled or verified by this delivery

The workflow file is checked in, but this delivery did not install the App, configure the repository variable or Environment secret, create the `pstack-pi-write` Environment or its `main`-only deployment branch policy, enable or trigger the remote workflow, or verify remote permissions. A local fixture, a workflow static check, or a CI result is not evidence that the remote automation is enabled. Those steps require separate authorization.

The inherited `validate-plugins.yml` workflow still runs `node scripts/generate-pstack-harness-trees.mjs --check` over `harness/pstack/`. The Pi validation workflow never calls that generator, but the inherited workflow will report the Pi tree as drift until it is disabled or replaced in the fork. Disabling it is a separate authorized change; this delivery does not modify the inherited workflow or any upstream project setting.

### Later real verification (not executed)

These follow-ups require separate authorization. None ran for this delivery, and none is an acceptance condition:

- poteto-mode on a small change, background completion, and a parent agent reviewing the diff;
- how or interrogate as a parallel summarizer;
- reflect with the full review material and approval boundary;
- one nested or isolated write task that the original workflow needs;
- MCP connectivity verification if it becomes necessary.

A package that loads, a schema or fixture passing, or CI being green does not prove full workflow compatibility. Real model, agent, MCP, and remote-trigger verification remains unrun.

## License

MIT
