# COViS

COViS 包含两个模式，由左上角 `COViS` 标志右侧的导航切换：**T2I-Explorer**（本地实验对比浏览器，地址和 URL 状态不变，见下文）和 **Scoring**（`/scoring`，预测与 GT 的盲评打分，见[Scoring 模式](#scoring-模式)）。

T2I Explorer 是本地实验对比浏览器。数据按 collection → task → dataset → exp 组织，每个实验独立保存完整样本和图片资源。支持 Task / Exp 两种浏览顺序，同一任务、数据来源的实验按稳定 `sample_id` 对齐；不同来源按各组排序后的行序比较。

需要 Node.js 24.21.0、pnpm 12.4.2。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 http://localhost:4173/ 。默认数据根目录 `data/datasets`，可用 `T2I_DATA_ROOT` 设置。演示数据：`T2I_DATA_ROOT=fixtures/datasets pnpm start`。

两种启动方式已分别封装为 skill，并安装到本机 `~/.codex/skills`：

| 版本 | 启动 skill | 默认地址 |
| --- | --- | --- |
| Prob 正式版 | [start-covis-prob](.agents/skills/start-covis-prob/SKILL.md) | http://localhost:4173/ · https://covis.ouruizhe.top（T2I-Explorer 在 `/`，Scoring 在 `/scoring`；旧域名 dive.ouruizhe.top 已配置为 302 跳转） |
| Dev 组件标注版 | [start-covis-dev](.agents/skills/start-covis-dev/SKILL.md) | http://localhost:4180/?dataset=sft-e6.0-r30 |

使用 `$start-covis-prob` 构建、启动正式版并检查已有 Cloudflare Tunnel；域名访问需要本机已有命名 tunnel 及凭据。使用 `$start-covis-dev` 启动组件标注版，支持边框、中文名称、组件目录和标注开关。Dev 使用 Prob 当前的界面和数据，每次请求自动读取最新前端资源地址，文件保存在 `tools/component-map`。两个版本均由 systemd 用户服务后台运行；用户指定的端口、上游、域名或数据根目录优先。

本机直连 Cloudflare 的 7844 端口超时时，隧道可通过现有本机 HTTP 代理建立 HTTP/2 连接。当前部署使用 `covis-relay.service` 运行 [TCP 中继](tools/tunnel-proxy-relay.py)，并由 tunnel 用户服务 `covis-tunnel.service` 自动启动它；具体配置和验收方法见 [代理中继部署说明](tools/tunnel-proxy-relay.md)。已有 tunnel 配置中的 `protocol`、`edge` 和服务依赖需保留。`systemctl` 显示 running 仅表示进程运行，必须同时检查 tunnel 的 `/ready` 和公网接口。

每条样本的 Input / Pred / GT text 标题带箭头按钮，可分别展开、收起文本；列表和图片详情均支持，默认展开。结果数量与页码摘要行可一键展开／收起全部文本，翻页或新加实验会沿用该状态；“清空实验”移除所有已选对比列，返回当前数据集的实验选择页面。

对比列头按 `任务-数据集-实验` 单行显示，采用紧凑高度；名称过长时省略显示，悬停可查看完整名称。

样本列表与详情优先显示原始数据集的 Source ID（例如 `106.tiff`、`REFSEGRS_1657`）和 split。搜索同时支持原始 ID、pipeline 的 `source_sample_id` 和内部 `sample_id`。原始 ID 未提供时回退显示 Sample ID；内部 ID 仍可在详情 JSON 查看，并继续用于跨实验对齐、图片地址和分享链接。

数据包仅接受新格式，没有旧格式或旧 API 的兼容层：

```text
<collection>/collection.json
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/experiment.json
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/samples.jsonl
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/assets/...
```

`collection.json` 声明任务、数据来源及实验 ID；实验名称、配置和样本数由各自的 `experiment.json` 定义。每个来源必填 `data_origin: "native" | "derived"`，分别显示蓝色和紫色图标，前端不推断分类。

本机发布范围（用户于 2026-10-13 更新）：保留 `basemodel-task-r30` 和 `sft-e6.0-r30`。`sft-e6.0-train-r30` 是同一 E6 数据体系的训练 GT 验收预览，不纳入 T2I Explorer；其已发布副本已移入 `data/datasets/.backups/`。后续训练数据构建可保留自身的验收产物，但不要把这个集合导入 Explorer，也不要用它替换现有的 `sft-e6.0-r30`。此约定取代先前发布流程中单独部署训练 GT 预览的安排。

CLI 接入：

```bash
pnpm data validate /path/to/collection
pnpm data import-collection --from /path/to/collection --root data/datasets
pnpm data import-exp --from /path/to/experiment --root data/datasets --collection sft-e6.0-r30 --task refseg --dataset sior-t
```

实验包包含 `experiment.json`、`samples.jsonl` 和 `assets/`，所属任务和数据来源需已声明。默认拒绝重复发布；显式加 `--replace` 可替换。CLI 校验格式、样本身份、数量和图片；复制后校验内容摘要，在同一数据根目录暂存后发布，替换前保留 `.backups/` 原目录。导入期间用 `.import-lock` 阻止并发写入；意外中断后需先确认导入进程已退出再移除残留锁。页面 Reload data 可立即刷新，后台也检测数据文件变化。

每条样本包含 `sample_id`、`index`、`input_text`、`pred_text`、`gt_text`、`panels`、`metadata`，可加 `extra_texts`。`null` 表示不可用，`""` 表示原始空字符串。图片按 `panels` 数组顺序等宽横排；点击任意图片打开整组及文本、JSON 详情。缺图必须显式写 `asset: null` 并提供 `unavailable_reason`。图片格式 PNG/JPEG/WebP，路径只能在该实验的 `assets/` 下。精确示例、JSON Schema 和接口见 [数据规范](spec.md)。

列表按可见区域渐进加载 512px WebP 缩略图（最多 4 张并发），详情独立加载原图（最多 2 张并发）。单图失败不阻塞其余图片；临时错误自动重试最多 2 次，最终失败可点该图的 Retry。原始图片不修改。缩略图按需生成，服务端转换最多 2 个并发、10 秒处理超时，内存缓存最多 64 MiB，重启后重新按需生成。

启动、目录刷新只读取元数据，后台变更检查跳过图片目录；图片在各自请求时检查路径、文件版本和格式。运行中出现损坏或丢失图片只影响该面板，CLI 校验和导入仍拒绝不完整数据包。侧栏左下角的刷新图标 Reload data 同时重新请求图片，替换源文件后会失效旧缓存。

侧栏顶部箭头可收起／展开，桌面收起后保留窄栏。任务卡片和添加列面板使用向右展开的级联菜单。已选列和对比列头统一显示 `任务-数据来源-实验`，样本始终按对齐后的固定顺序展示。点击列表图片打开整组详情，再点击其中子图可在大图预览区内放大至同区高度；点击外侧或按 Escape 逐层关闭。

一次性旧数据转换工具独立于应用和 CLI 数据接入。它只处理本次已审计的两份 v2 目录，不是运行时适配器：

```bash
pnpm data:convert --source /path/to/old-data-root --output /path/to/new-staging-root
```

转换逐张核对 SHA-256，保留所有原文本和证据，输出 `conversion-report.json`。SFT 归入 Baseline，来源参考归入 Reference；参考输出保留为额外文本，不伪装为预测或 GT。转换结果再用新 CLI 导入，原目录进入备份。后续实验应沿用相同逻辑样本的 `sample_id`；转换后的 ID 是原 `source_sample_id` 的完整 SHA-256。

验证：

```bash
pnpm check
T2I_E2E_PORT=4182 pnpm test:e2e
```

默认服务仅绑定本机。网络绑定需设置 `T2I_ALLOW_NETWORK=true` 和 `T2I_ALLOWED_HOSTS`。数据服务只通过声明的 collection/task/dataset/exp/sample/panel 身份返回图片，不接受任意文件路径。

Collection manifests may declare an optional `aliases` array of retired IDs.
Aliases resolve read-only page, record and media links to the canonical collection
without adding menu entries. The browser preserves columns, filters, pagination
and the active sample when normalizing a link. Imports must target the canonical
ID; alias writes and colliding identities fail explicitly. The shared GeoBanana
collection is `sft-e6-r30`, with `sft-e6.1-r30` retained as a read-only alias.

## Scoring 模式

`/scoring` 用于人工盲评：每个 item 显示原图和两个匿名候选标注（Candidate 1 / 2），评审选择 `1`、`2` 或 `tie` 并写理由。哪个候选是预测（`blind_map`）只保存在服务端，界面仅能通过确认后的 Reveal 操作查看，且会记入该评审此后为该 item 保存的标签（`revealed: true`）。

- 评审名首次输入后保存在浏览器 localStorage（`[A-Za-z0-9_-]{1,32}`，不能以 `agent-` 开头）。
- 侧栏：scoring set、prefill（`agent-*` 标签集）、pair / 已标注 / 与 prefill 一致或不一致的过滤、进度 `已标注/总数`、导出 JSONL。
- item 视图：任务文本、presentation 切换（如 overlay / outline / 拼接画布）、点击图片打开复用的大图弹窗；只读显示所选 prefill 的选择、理由和可选 regions；评审尚无标签时以 prefill 预填可编辑的选择和理由。快捷键 `1` `2` `t` 选择，`n` `p` 切换，在理由框中 Ctrl/Cmd+Enter 保存。
- 深链接：`/scoring?set=<set>&item=<item>&prefill=<agent-…>&pres=<presentation>&pair=…&status=labelled|unlabelled&agree=agree|disagree`；`prefill=`（空值）表示明确不使用 prefill。

数据目录默认 `data/scoring`，可用 `T2I_SCORING_ROOT` 设置；演示数据：`T2I_SCORING_ROOT=fixtures/scoring pnpm start`（会向 fixture 写入标签，演示时请先复制）。目录结构：

```text
<set_id>/set.json                  # 集合说明、来源 cohort/round、blind_seed、评审说明、presentations
<set_id>/items.jsonl               # 每行一个 item，含 blind_map（不发送给前端）
<set_id>/assets/...                # 图片，只能通过 item/presentation/角色访问
<set_id>/labels/<reviewer>.jsonl   # 只追加；每个 item 以最后一行为当前标签
<set_id>/labels/agent-<round>-<judge>-<effort>.jsonl  # 只读的 agent 预填结果
```

服务端除了追加 `labels/<reviewer>.jsonl` 外全部只读，没有删除或覆盖接口；`agent-*` 标签集拒绝写入。格式、Schema 和接口见 [spec.md](spec.md#scoring-模式)。fixture 由 `pnpm exec tsx tools/create-scoring-fixtures.ts` 生成，favicon 由 `pnpm exec tsx tools/create-favicon.ts` 生成。

旧域名跳转：设置 `COVIS_REDIRECT_HOSTS=dive.ouruizhe.top` 和 `COVIS_CANONICAL_ORIGIN=https://covis.ouruizhe.top` 后，Host 为该域名的请求收到 302，跳到规范域名下的相同路径和查询；两个变量都未设置时不跳转。跳转先于 Host 白名单检查，因此旧域名无需加入 `T2I_ALLOWED_HOSTS`，规范域名需要加入。当前部署的 `covis.service` 已按此配置，`dive.ouruizhe.top` 保留在 tunnel ingress 中以便请求到达应用并被跳转。
