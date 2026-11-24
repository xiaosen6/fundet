## 企业微信速查（本机已装 wecom-cli）

企业微信域的常见查询**直接执行 wecom-cli 命令**：输出即 JSON；出错时退出码非 0，stdout 是 `{"error":{"type","code","message"}}`。时间参数一律 `YYYY-MM-DD HH:mm:ss`（本地时间）；对象型参数用 `--json '<JSON>'` 传。

- 找人（姓名/拼音/英文名/别名 → 部门、职务、邮箱）：`wecom-cli contact users search --json '{"keywords":["张三"]}'`；命中多人时列候选让用户确认，禁止默认取第一个
- 我的身份：`wecom-cli identity whoami`
- 日程：某时间段 `wecom-cli calendar schedules list --json '{"begin_time":"<YYYY-MM-DD HH:mm:ss>","end_time":"<YYYY-MM-DD HH:mm:ss>"}'`；按关键词找 `wecom-cli calendar schedules search --json '{"keywords":["周会"],"begin_time":"<开始>","end_time":"<结束>"}'`；多人空闲时段 `wecom-cli calendar schedules free list --json '{"userids":[{"userid":"…"}],"begin_time":"<开始>","end_time":"<结束>"}'`
- 会议：时间段内 `wecom-cli meeting list --json '{"begin_time":"<开始>","end_time":"<结束>"}'`
- 待办：未完成清单 `wecom-cli todo list --json '{"status_filter":["proceed"],"limit":20}'`（可加 `deadline_begin_time` / `deadline_end_time` / `keywords`）；详情 `wecom-cli todo get --json '{"items":[{"todo_id":"…"}]}'`
- 邮件：搜索 `wecom-cli mail search --json '{"keywords":["周报"],"limit":10}'`；只要未读再加 `"only_unread":true`；读正文 `wecom-cli mail get --json '{"mail_ids":["…"]}'`
- 文档：搜公司文档 `wecom-cli doc search --json '{"keywords":["制度"],"search_scope":"title_content","limit":10}'`；读正文 `wecom-cli doc contents get --json '{"docid":"…","content_type":"text/markdown"}'`
- 微盘：搜文件 `wecom-cli disk files search --json '{"keywords":["汇总"],"search_type":"file","limit":10}'`
- 消息：机器人最近对话过的会话 `wecom-cli message aibot sessions list`

**写操作**（发消息/发邮件/建日程/建待办/改文档等）：先说明对象与影响，经用户确认后再执行；可先加 `--dry-run` 只预览请求。回复里不要展示 userid、chat_id、todo_id、docid、mail_id 等内部标识，用名称指代。

上述之外的企业微信操作：先读对应的 `wecomcli-*` 官方技能（已装配在本机技能目录，按它的接口路由表执行）；都不支持就如实说，不要编造命令。
