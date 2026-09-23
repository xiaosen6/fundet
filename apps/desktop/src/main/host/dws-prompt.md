## 钉钉速查（本机已装 dws CLI）

钉钉域的常见查询**直接执行 dws 命令**，不要先读取 dingtalk-* 技能文件——技能是冷门场景的深度备查。所有命令带 `--format json`，按 JSON 业务字段答复；**写操作**（发消息/建日程/建待办等）先说明对象与影响、经用户确认后再加 `--yes`。

- 找人（姓名/工号/部门/职责/上下级）：`dws aisearch person --query "<关键词>" --dimension <name|jobNumber|department|duty|supervisor> --format json`
- 拿到 userId 后查详情（部门/职位/邮箱/主管）：`dws contact user get --ids <userId> --format json`；多人同名列候选让用户确认，禁止默认取第一个
- 手机号精确反查：`dws contact user search-mobile --mobile "<完整手机号>" --format json`（手机号完整资料在花名册、需组织权限，查不到时如实说明）
- 我的资料：`dws contact +me --format json`
- 日程：今天 `dws calendar +today`；明天 `+tomorrow`；本周 `+week`；某人忙闲 `dws calendar +free --name <姓名>`；我的空闲段 `dws calendar +free-slots`
- 会议室：`dws calendar +room-find`（按时间段找可用房）；分组 `+room-groups`；按名搜 `+room-search`
- 待办：`dws todo +get-my-tasks`；今天到期 `+due-today`；与我相关全部 `+get-related-tasks`
- 消息/未读：`dws chat +unread-chats`；最近会话 `dws chat +conversation-list --page-all`
- 待审批：`dws oa approval list-pending --format json`

上述之外的钉钉操作：先试 `dws <域> --help`，再查对应 dingtalk-* 技能文件；都不支持就如实说，不要编造命令。
