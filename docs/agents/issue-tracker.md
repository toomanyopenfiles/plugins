# 任务记录：GitHub Issues

本项目的任务和规格存放在 `toomanyopenfiles/plugins` 的 GitHub Issues。
使用 `gh` CLI。

## 仓库边界

所有 `gh issue` 和 `gh pr` 命令显式添加
`--repo toomanyopenfiles/plugins`。

所有 `gh api` 仓库路径显式使用
`repos/toomanyopenfiles/plugins/...`。

不依赖 gh 自动选择仓库，不向上游 `cursor/plugins` 写入。
用户提供上游链接时，可读取参考内容；需要记录工作时，在 fork 中创建任务。

## 常用操作

- 创建：`gh issue create --repo toomanyopenfiles/plugins --title "..." --body-file <文件>`
- 读取：`gh issue view <编号> --repo toomanyopenfiles/plugins --comments`
- 列表：`gh issue list --repo toomanyopenfiles/plugins --state open --json number,title,body,labels,assignees`
- 评论：`gh issue comment <编号> --repo toomanyopenfiles/plugins --body-file <文件>`
- 标签：`gh issue edit <编号> --repo toomanyopenfiles/plugins --add-label <标签>`
- 认领：`gh issue edit <编号> --repo toomanyopenfiles/plugins --add-assignee @me`
- 关闭：`gh issue close <编号> --repo toomanyopenfiles/plugins --comment "..."`

标签含义见 `triage-labels.md`。缺少标签时，不静默创建；
先说明缺项，再取得创建授权。

## skill 指令映射

- “发布到 tracker”：在当前 fork 创建 GitHub Issue。
- “读取任务”：读取正文、标签和全部评论。
- `/to-tickets`：先展示任务拆分和依赖，用户确认后才发布。
- 本次 setup 只记录配置，不执行远端写入。

## pstack → Pi MVP 任务索引

[总规格 #6：最小适配包与候选交付](https://github.com/toomanyopenfiles/plugins/issues/6)
记录整体目标、跨票决策、测试边界、不做事项及整体完成条件。
以下五张任务保留局部交付与验收细则，均已作为 #6 的原生子任务关联。
总规格不是额外实现票，也不是子任务的前置 blocker。
用户后续明确决定优先于较早规格；任务标签不扩大执行权限。

实施采用用户指定的 Pi Matt spec 编排流程，允许其必要的模型调用、
编码、修复及静态代码审查子代理。产物验证仍限于静态与确定性检查，
不通过真实模型、运行被测代理或连接真实 MCP 验证适配效果。
实施工作流的子代理运行不算适配产物的真实运行验收证据。

- [T1：生成并校验自包含的 Pi 技能资源包](https://github.com/toomanyopenfiles/plugins/issues/1)。无阻塞。
- [T2：发现三个代理并提供最小 Pi 适配入口](https://github.com/toomanyopenfiles/plugins/issues/2)。阻塞于 #1。
- [T3：提供角色模型 setup 与按需 MCP 配置指引](https://github.com/toomanyopenfiles/plugins/issues/3)。阻塞于 #2。
- [T4：实现冻结候选 PR 的自动同步交付流程](https://github.com/toomanyopenfiles/plugins/issues/4)。阻塞于 #1。
- [T5：实现只读候选校验与防过期 PR 汇总报告](https://github.com/toomanyopenfiles/plugins/issues/5)。阻塞于 #1。

这些任务均已添加 `ready-for-agent`，并建立原生阻塞关系。
开始实施时，以 GitHub 当前任务和依赖状态为准。

本轮的主要维护入口约定保持不变：独立生成器与检查器放在
`scripts/pstack-pi/`；公共 adapter 为 `pstack/docs/harness/pi.md`；
唯一独立适配流程为 `pstack/docs/harness/pi/mcp-setup.md`；
两个 workflow 为 `.github/workflows/pstack-pi-sync.yml` 和
`.github/workflows/pstack-pi-validate.yml`。生成包仅管理
`harness/pstack/pi/`。这些入口待相应任务实现，不是已有交付。

## 依赖与任务图

每个任务单独创建 Issue，按阻塞者在前的顺序发布。

优先使用 GitHub 原生 issue dependency。创建阻塞关系时，
API 的 `issue_id` 使用阻塞任务的数字数据库 ID，
不是 Issue 编号或 node ID：

```sh
gh api --method POST \
  repos/toomanyopenfiles/plugins/issues/<被阻塞任务编号>/dependencies/blocked_by \
  -F issue_id=<阻塞任务数据库ID>
```

原生依赖不可用时，在正文顶部记录 `Blocked by: #编号`。
只有全部阻塞任务关闭后，任务才可开始。

使用 `/wayfinder` 时，map 为单独 Issue；决策任务作为 sub-issue。
不支持 sub-issue 时，使用 map 中的任务列表和子任务中的
`Part of #编号` 双向引用。认领用 assignee 记录；
完成后评论结果、关闭任务，并更新 map 的决策指针。

## Pull requests as a triage surface

PRs as a request surface: no.
