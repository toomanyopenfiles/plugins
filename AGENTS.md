# 项目指令

## 变更边界

只变更当前 fork `toomanyopenfiles/plugins`。上游 `cursor/plugins`
仅作只读参考和同步来源。Git push 显式指定 fork remote；
GitHub 操作显式指定目标仓库，不依赖自动推断。

## pstack → Pi 本轮实施

实施、拆票或评审前，读取 `docs/agents/issue-tracker.md` 中的
pstack → Pi MVP 总规格，以及当前任务正文、评论和阻塞任务。

实施使用用户指定的 Pi Matt spec 编排流程，允许该流程调用模型，
启动其必要的编码、修复和静态代码审查子代理。这是实施手段，
不属于对 pstack → Pi 适配产物的真实运行验证。

产物验证只做静态检查、确定性的程序化验证和回归。
不为验证适配效果而真实调用模型、运行被测代理或连接真实 MCP。
测试程序不得间接启动这些运行验证。真实远端触发验证留待后续授权。
实施代理也必须遵守这些验证边界，不能把实施委派当作运行验收证据。

## Agent skills

### Issue tracker

任务和规格使用当前 fork 的 GitHub Issues。
读取、发布、更新或关闭任务前，先读 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认角色标签。
分诊或修改任务状态前，先读 `docs/agents/triage-labels.md`。
`ready-for-agent` 只表示规格完整；实施委派以用户对所选流程的授权为准，
标签本身不扩大模型调用、子代理运行或产物验证权限。

### Domain docs

采用单上下文布局。
探索领域术语或设计决策前，先读 `docs/agents/domain.md`。
