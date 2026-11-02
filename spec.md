# 数据架构与交互规范

唯一有效数据包版本：`schema_version: 3`。不读取旧 manifest/set/composite 格式，不提供 `/api/v2/*`、`/api/v3/*` 路由。

## Collection 声明

```json
{
  "schema_version": 3,
  "id": "sft-e6.0-r30",
  "title": "sft-e6.0-r30",
  "tasks": [{
    "id": "refseg", "title": "Refseg",
    "datasets": [{
      "id": "sior-t", "title": "SIOR_T", "data_origin": "native",
      "exps": [{ "id": "baseline" }]
    }]
  }]
}
```

实验目录为 `tasks/refseg/datasets/sior-t/exps/baseline/`。其中 `experiment.json`：

```json
{
  "schema_version": 3, "id": "baseline", "title": "Baseline",
  "record_count": 1,
  "metadata": { "checkpoint": "step50", "role": "prediction" }
}
```

`metadata` 为普通 JSON 对象，保存训练配置、执行状态、证据等，不参与任务卡片显示。collection 的 `exps` 只引用 ID，不复制实验配置。

## 完整样本

`samples.jsonl` 每行一个对象，不允许空白行、重复 sample_id 或 index。每个实验独立包含 input/pred/GT 和自己的全部 panels，可使用任意正整数 index，不要求连续或固定 30 条。

```json
{"sample_id":"request-A","index":1,"input_text":"Segment airplane","pred_text":"","gt_text":null,"panels":[{"id":"original","title":"Original","asset":"assets/request-A/original.png"},{"id":"pred","title":"Pred overlay","asset":null,"unavailable_reason":"Prediction was not produced"}],"extra_texts":[{"title":"Source annotation text","text":"airplane"}],"metadata":{"seed":42}}
```

sample_id 是逻辑样本身份，在同任务、来源的所有实验中稳定复用。index 仅定义实验内顺序，不代替跨实验身份。不得按同名原图或相同 index 推断身份。输入、预测、GT 均必填，可以为 null，空字符串保持独立含义。额外文本不替换这三项；不从来源标注或参考输出猜测 GT 或预测。

原始数据集的记录 ID 可放在 `metadata.source_id`，划分可放在 `metadata.source_split`。显示 Source ID 时按 `metadata`、`metadata.evidence`、`metadata.original_record`、`metadata.original_record.evidence` 的顺序读取首个有效 `source_id`，兼容已发布包保留证据的位置；未提供时显示 `sample_id` 并标记为 Sample ID。原始 ID 用于显示和搜索，不代替逻辑样本身份；同一来源记录可能生成多条任务请求。

panel 顺序完全由数组决定，支持 1–32 个独立面板。每个 panel ID 在样本内唯一；asset 是该实验内 `assets/` 下的相对路径，不允许绝对路径、`..`、符号链接或未声明资源。缺少资源必须使用显式 null 和非空原因；声明有资源但找不到、格式错误的包拒绝发布。

ID 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。JSON 单文件配置和单行样本各不超过 1 MiB，samples.jsonl 不超过 100 MiB，单实验最多 100000 样本，单样本 JSON 最多 50000 节点、嵌套深度 100；单图最多 50 MiB，校验后缀、签名、尺寸。Schema：[collection](schemas/collection.schema.json)、[experiment](schemas/experiment.schema.json)、[sample](schemas/sample.schema.json)。

## 接口

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态 |
| GET | `/api/catalog` | collections、组装后的实验元数据、snapshot_id、diagnostics |
| GET | `/api/collections/:collection/tasks/:task/datasets/:dataset/exps/:exp/records` | 完整实验样本，panel 含 status/url/thumbnail_url，不含 asset 文件路径；mime/尺寸可省略 |
| GET | `/api/media/:collection/:task/:dataset/:exp/:sample/:panel` | 已声明的原始图片；`?variant=thumbnail` 返回最长边 512px、质量 80 的 WebP |
| POST | `/api/reload` | 刷新后的 catalog；同源校验、频率限制 |

metadata 中原始证据按普通 JSON 原样保留，服务端不解释其文件路径。catalog 中结构化元数据无效的包隔离并给出诊断；启动和刷新不遍历或读取 assets。CLI 继续严格验证所有图片。运行时 `available` 表示有已声明的资源，其是否可用在单图请求时确认，坏图不移除整个 collection。

catalog/records 使用元数据快照 ETag；自动刷新在后台检查元数据，期间请求使用当前快照。手动 Reload 等待元数据刷新，并重置前端图片请求。图片每次请求确认安全路径和文件版本，原图与缩略图使用独立 ETag 和 `private, no-cache`，不能通过未知 sample/panel 访问 assets。源文件替换后原图和缩略图缓存均失效。

缩略图按需生成：不裁剪、不放大小图，保留透明度；原图字节保持不变。转换并发最多 2 个，每次转换最多 10 秒；待转换队列最多 64 个，排队超时或队列满返回 503，处理超时返回 504。已生成图片使用 64 MiB 内存 LRU 缓存，相同版本的并发转换合并；不写入数据包。

## 浏览和比较

首页数据集卡片只有 collection title，高度随内容撑开，上下内边距 12px。首页标题、圆角搜索框、数量摘要及卡片区左边对齐。数据集名称和 ID 支持模糊搜索：忽略大小写、空白和分隔符，按输入字符顺序匹配不连续片段。应用名称为 COViS，浏览器标题与名称栏一致，favicon 为白底黑字 “CO/ViS” SVG（同时提供 16/32/48px ICO）。首页标题为 COViS。点击顶部 COViS 名称回到首页，清空当前数据集、对比列及样本搜索，支持浏览器前进／后退。顶部名称栏只显示 COViS 和右侧的模式导航（T2I-Explorer、Scoring，当前模式高亮，链接返回各模式本标签页上次的查询），不含操作按钮；侧栏顶部左侧使用箭头收起／展开，底部左侧使用 SVG 图标 Reload data。桌面收起后保留 44px 窄栏和两个图标，展开时恢复已保存宽度；侧栏中间控制区独立滚动。任务名称首字母大写，GCG/VGD 全大写、Relative Height 分词。任务卡片只显示名称和展开按钮，高度随内容撑开，上下内边距 8px。来源图标按声明的原生/衍生分类显示。

侧栏从上到下为 Dataset、View by（Task/Exp）、Search examples、已选列、Page size。已选列与对比列头使用同一单行标题：任务-数据来源-实验；超长省略并提供完整标题提示。Task 模式选择顺序 task → dataset → exp；Exp 模式 exp → task → dataset，只列实际存在的实验。卡片下拉和侧栏添加列均使用级联菜单，每层向右展开并保留之前的层级；切换父项替换右侧分支，最终选择才添加列。各列独立纵向滚动，空间不足时菜单内部横向滚动。切换模式保留列和浏览状态。同一实验允许多个独立列实例，列可排序、删除，菜单在选择、点击外部和 Escape 时关闭。

同一 collection/task/dataset 的多个实验按 sample_id 联合对齐。优先用已选 Baseline 的 index 排序；无 Baseline 时，以已选实验在 collection 中的声明顺序为锚点。缺失样本显式留空，新增样本在锚点样本后追加。不同 cohort 按各自排好后的行序并排，不跨来源对齐身份。对齐后的顺序固定，过滤和分页保留该顺序；拖动列不改变行顺序，不显示单独 index 列或排序控制。

每个样本的 panels 保持一行、等宽、全部可见，缺图占据自己的位置，长文本在列内折行。点击任意缩略图打开整组和完整文本/JSON。点击大图预览区内的可用子图，在同一区域内将单图放大至预览区的可用高度，宽度按图片比例自适应；超宽图在预览区内横向滚动，记录详情保持可见。单图复用现有原图请求；缺图保持占位。弹窗没有 Close 按钮，点击单图外侧或 Escape 先恢复整组；再点击整组外侧背景或 Escape 关闭详情并恢复焦点。内部点击和从内部拖动到外部不关闭。手机上 panels 仍然横排，详情可向下滚动。单图状态仅在当前详情内保存，关闭或切换记录时清除。

列表在面板接近可见区域 300px 时请求缩略图，最多 4 张并发，完成一张立即显示并补位；弹窗使用独立的 2 个原图请求名额，可先显示已有缩略图。缩略图单次请求超时 15 秒，原图 60 秒；网络错误、超时、429、5xx 最多自动重试 2 次，默认退避 0.5/1.5 秒并尊重 Retry-After。退避不占请求名额；404、解码失败不自动重试。失败图提供独立 Retry 按钮，显式缺图保持原因占位。无人使用的请求被取消，Blob URL 在最后一个使用者离开时释放。

实验 GET 请求最多 4 列并发、单次超时 20 秒，使用相同有限重试策略；失败列可独立 Retry，不重载正常列。Reload POST 不自动重试。

Input/Pred/GT 均显示。合法 `<p>airplane-3<color>(254, 91, 109)</color></p>` 整个 token 按指定颜色显示，保留标签和空白、提供对比背景，禁止执行 HTML。GT、额外文本参与搜索。原始 metadata 可展开、复制查看。

## URL

collection 导航保持 `?dataset=sft-e6.0-r30`。列为 `cols=task:dataset:exp:instance,...`；active 为 `task:dataset:exp:instance:sample_id`。不接受三段旧列格式，不将旧 active 中的数字序号转换为 sample_id。可持久化 mode、q、page、pageSize，页面刷新和浏览器历史还原状态。旧链接的 order、seed 被忽略并从 URL 清除。无效或未发布的列移除，不转换为默认实验。

## Scoring 模式

路径 `/scoring`（服务端对非 API 路径返回 index.html，前端按路径选择模式；模式切换为整页跳转，T2I-Explorer 的路由和 URL 状态不变）。数据根目录 `T2I_SCORING_ROOT`，默认 `data/scoring`。Schema：[scoring-set](schemas/scoring-set.schema.json)、[scoring-item](schemas/scoring-item.schema.json)、[scoring-label](schemas/scoring-label.schema.json)；示例：`fixtures/scoring/pj-demo/`。

`set.json`（`id` 必须等于目录名；未知字段如 `prefill_gaps`、`skipped_items`、脱敏日志被忽略且不发送给前端）：

```json
{"schema_version":1,"id":"pj-demo","title":"Pairwise judge demo","source":{"cohort":"pj-e61-r30-v1","round":"round-01"},"blind_seed":42,"instructions":"…","presentations":[{"id":"overlay","title":"Overlay"},{"id":"side_by_side","title":"Side by side"}]}
```

`items.jsonl` 每行一个 item，`item_id` 唯一并匹配 ID 规则；`presentations` 的键必须在 `set.json` 声明，界面按声明顺序显示。两种形态：逐候选图片（三个路径），或拼接画布（`candidate_1`/`candidate_2` 为 null，`views` 为 1–16 张同时包含两个候选、并在画布上标注 Candidate 1 / 2 的图片）。`blind_map.pred`、`blind_map.gt` 分别为 1、2 之一且不同。`metadata` 会原样发给前端，不能包含能识别候选的信息。

```json
{"item_id":"demo-refseg-01","pair":"refseg/sior-t","task":"refseg","task_text":"Segment …","presentations":{"overlay":{"original":"assets/…/original.png","candidate_1":"assets/…/candidate_1.png","candidate_2":"assets/…/candidate_2.png"},"side_by_side":{"original":"assets/…/original.png","candidate_1":null,"candidate_2":null,"views":["assets/…/view_1.png"]}},"blind_map":{"pred":1,"gt":2},"metadata":{}}
```

`labels/<name>.jsonl` 每行一个标签，同一 item 以最后一个有效行为当前值；无法解析或不符合 schema 的行被跳过并计入 `invalid_rows`。字段：`item_id`、`choice`（整数 `1`、`2` 或字符串 `"tie"`）、`reason`（≤4000 字符，可为空）、可选 `regions`（`[{window_id, present: yes|no|unsure, note?}]`）、`source`（人工为 `human`；agent 建议 `agent:<round>/<judge>/<effort>`）、可选 `revealed`、可选 `prefill`（保存时显示的 agent 标签集名）、可选 `confidence`（0–1）、`updated_at`（服务端写入的 ISO 8601 UTC 时间）。读取时允许其他附加字段。标签集名匹配 `[A-Za-z0-9_-]{1,32}`；以 `agent-`（不区分大小写）开头的是只读 prefill 来源。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scoring/sets` | 集合列表（id、title、item_count、label_sets）及无效集合诊断 |
| GET | `/api/scoring/sets/:set` | set（仅已知字段）、items（不含 `blind_map` 和资源路径；每个 presentation 为 `{kind:"candidates", original, candidate_1, candidate_2}` 或 `{kind:"composite", original, views[]}`，各含 url/thumbnail_url）、label_sets |
| GET | `/api/scoring/sets/:set/labels/:reviewer` | 当前标签（每 item 最后一行，按 item 顺序）、row_count、invalid_rows、read_only；无文件时为空 |
| POST | `/api/scoring/sets/:set/labels/:reviewer` | 追加一行。请求体 `item_id, choice, reason, regions?, source?, revealed?, prefill?`；服务端补 `updated_at`，默认 `source: "human"`，返回 201 和写入的行。`agent-*` 返回 403；评审名、请求体或未知 item 返回 400；跨源 Origin 返回 403 |
| GET | `/api/scoring/sets/:set/labels/:reviewer/export` | 当前标签 JSONL 下载（`<set>__<reviewer>.jsonl`） |
| POST | `/api/scoring/sets/:set/items/:item/reveal` | 请求体 `{reviewer}`，返回 `{item_id, blind_map}`；唯一返回 `blind_map` 的接口 |
| GET | `/api/scoring/media/:set/:item/:presentation/:role` | role 为 `original`、`candidate_1`、`candidate_2` 或 `view_<n>`；`?variant=thumbnail` 同实验图片 |

写入：每行以单次 `write(2)` 追加到 `O_APPEND|O_NOFOLLOW` 打开的文件并 `fdatasync`，同一文件在进程内串行；不同评审写不同文件，互不覆盖。没有删除、覆盖或 PUT/PATCH 接口。Reveal 后，该评审此后为该 item 写入的所有行都标记 `revealed: true`（服务端强制，且一旦文件中出现即保持）；前端同时在 localStorage 记住已显示的 `blind_map`。

旧域名跳转：`COVIS_REDIRECT_HOSTS`（逗号分隔）中的 Host 收到 302 到 `COVIS_CANONICAL_ORIGIN` + 原路径和查询，先于 Host 白名单；只设其一时启动失败，均未设置时关闭。
