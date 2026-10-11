# v6.43.0 视觉识别 spike 结论（2026-10-11）

## 任务
FC26 赛后 Player Performance 截图 → 结构化 JSON（左表行 POS/Name/RR/G/AST + 右栏详情），供成长录入预填。

## 实测（4 张真实截图 × 对拍人工标准答案 × 复跑 2 轮）
| 模型 | 费用 | 结果 | 速度 |
|---|---|---|---|
| **glm-4v-flash** | 免费 | **8 次（4图×2轮）全对**：48 格行数据、门将五项（gkRating/shotsAgainst/onTarget/saves/conceded）100% | 13-17s/图 |
| glm-4.1v-thinking-flash | 免费 | 47/48（1 处是省略 assists 键而非填错） | 17-27s/图 |
| glm-4.6v-flash | 免费但限流 | 始终 429 code 1305「访问量过大」，未测成 | - |
| glm-4.6v / 4.6v-flashx / 4.5v / glm-ocr / glm-4v-plus | 付费 | 429 code 1113「余额不足」（key 未充值） | - |

- 单图消耗：prompt ≈ 3302 tokens（图 ≈2600 + 提示词 ≈700）、completion ≈ 728。
- `GET /v4/models` 只回 11 个文本模型，视觉系列不在列表里，要按模型名直调探测。
- 测试 key 在 `.dev.vars` 的 `BIGMODEL_KEY`；BigModel OpenAI 兼容端点 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，图片走 `content:[{type:'image_url',image_url:{url:'data:image/png;base64,…'}}]`。
- 脚本与标准答案：`scratch/v643-spike/`（spike.mjs / ground-truth.json / out/）。

## 关键事实
- 标准答案四图交叉自洽：MILAN 2:4 LIVERPOOL；Kane 2 球 = Mamardashvili conceded 2；Mbappé 2+Orsolini 1+de Jong 1 = Maignan conceded 4（OnTarget 7 − Saves 3）。这些可作为识别结果的自动校验规则（进球和=比分、saves+conceded=onTarget、助攻和=详情区 team 列）。
- 识别语义约定：RR 是出「防守认定/预填」的评分项（<7.0 不给 XP 是产品规则）；门将取 GK 面板 Saves；夺回球权图上看不到、保持手填；零封联动=门将恒勾+外场手填夺权即勾。
- prompt 要点：声明「SUB 行 rating=N/A→null」「滚动条外的行绝不编造」「忽略顶部 MSI Afterburner 监控条」「严格 JSON 无围栏」；temperature 0.1 复跑零漂移。

## 生产建议
`LLM_VISION_MODEL` 默认 `glm-4v-flash`（免费、够准）；模型可配置，将来要更准就充值换 glm-4.6v。生产需用户自备 key（本地测试 key 不自动上生产）。

## 提示词 A/B（2026-10-11，prompt-master 优化，采纳 v3）
- V2（关键约束前置+全键必填+GK 自检锚 Saves+Conceded=OnTarget+左列口径显式化）：glm-4.1v-thinking-flash 从 47/48 修成 48/48（全键必填治好 assists 键省略）；但 schema 占位符全用字符串描述 ⇒ 模型把数字输出成字符串（"7.8"），值全对、类型漂移（端点 roundRating/asCount 收数字字符串，无害但不干净）。
- V3（=V2 结构 + schema 换成带真实数字的示例行 + 显式规则「数字字段一律 JSON number，禁止加引号」+ 用户裁决「最好类型统一」）：8 次调用行数据 48/48 格全对且类型全为 number；gk 五项全对。两个打分器 false 均为假象——tab 大写 "Goalkeeping"（端点 growth-ocr.ts:92 toLowerCase 归一）、thinking-flash #1 Kane 详情 assists 读成队均列 2（selected 字段无写库消费方，零影响）。
- 采纳：端点 OCR_PROMPT = V3（保留页签收窄 summary|goalkeeping）；spike.mjs 加 SPIKE_PROMPT=v1/v2/v3 开关可复跑。
- 教训：prompt schema 里「带真实数字的示例行」比「类型描述文字」更能钉住输出类型；描述文字反而诱导字符串化。
