# 菜单数据格式（version 1）

完整示例见 [data/menu.example.json](../data/menu.example.json)。不要直接拷贝示例金额到实际菜单。金额单位均为人民币元，最多两位小数，脚本以分核算。

## 整体信息

| 字段 | 说明 |
| --- | --- |
| `version` | 固定为 1 |
| `isDemo` | 示例 true；真正通过 MCP 查询 false |
| `title` | 页面标题，默认「今天的饭点，主角登场。」 |
| `clientName` | 对应运行客户端的可靠名称；未知时默认「当前客户端」。在无匹配页面里提示回到该客户端调整需求 |
| `result` | 默认 `{ "status": "ready" }`；没有符合要求的餐品时按下文设置 `no-match` |
| `request.text` | 脱敏后的需求摘要，不包含电话、精确地址、账号信息 |
| `request.budget` | 整单预算，非负金额；包括优惠、配送费和其他费用 |
| `request.people` | 用餐人数，1–50 的整数 |
| `request.dining` | `dine-in` / `takeaway` / `delivery` |
| `request.preferences` | 口味、用餐偏好的文本数组；最多 12 项 |
| `store` | 实际查询必须填写 `{ "name": "门店名" }`；不写用户地址 |
| `queriedAt` | 实际查询必须填写带时区的 ISO 时间，例如 `2026-10-10T18:30:00+08:00` |
| `sourceTools` | 按本轮首次实际调用顺序记录 Tool 名称；真实菜单必须包含 `auto-bind-coupons` → `query-store-coupons` → `query-meals` |
| `items` | ready 状态为 1–30 项餐品；no-match 状态必须为空数组；重复餐品合并数量 |

## 无匹配结果 result

预算不足时也生成 HTML，不能让生成器报错后直接在对话中解释。示例见 [data/menu.low-budget.example.json](../data/menu.low-budget.example.json)。

- `status: no-match`；`reason` 为 `budget` / `preferences` / `availability`，分别表示预算、需求或供应条件导致无匹配。
- `message` 是页面上的原因说明，最多 500 字；限定在本次门店与需求的查询范围内，不编造全店最低价或保证不存在免费券。
- `minimumTotal` 为本次已核验候选方案的最低整单金额，未知时为 null；只有 reason 为 budget 才能填写，且必须高于当前预算。真实数据还要求查询菜单之后调用 `calculate-price`。页面只在该值存在时显示起价与差额，不将其作为当前菜单总价。
- `items: []`、`quote.status: not-applicable`，报价金额全部为 null 或省略。不存在的菜单不能写成 0 元菜单，也不推荐超预算物品。
- 真实无匹配结果仍须保留门店、时间及先领券后查询的来源记录；查询失败不能假装是已查询的无匹配结果。示例不伪造工具调用。

客户端最终只返回生成的 HTML 附件或链接，餐品、价格、原因和调整建议全部在页面内展示。

## 报价 quote

`status` 为 `demo` / `verified` / `unknown`；无匹配结果专用 `not-applicable`。

- `demo` 必须搭配 `isDemo: true`。
- `verified` 必须搭配 `isDemo: false`，且 `sourceTools` 在上述流程之后包含本次实际调用的 `calculate-price`。仅仅填写工具名不是调用证据，也不能证明领券成功。
- `unknown` 必须搭配 `isDemo: false`，以下金额及所有餐品 `unitPrice` 为 null（或报价金额字段省略）。页面展示「待核价」，不显示预算余额或已满足预算的承诺。

已核价和演示的金额字段全部必填：

```text
subtotal - discount + deliveryFee + otherFees = total <= request.budget
```

`subtotal` 是优惠前的餐品小计，`discount` 是实际整单优惠；避免再次扣除已经体现在报价中的优惠。`deliveryFee` 是配送费，到店模式必须为 0。`otherFees` 是返回的其他费用总和。`couponLabel` 为优惠文字说明或 null，不包含券码或用户标识。

当服务只返回应付金额，无法明确区分优惠前小计、费用或优惠时，不凭空分摊；补查有效报价，或使用待核价模式。

领取成功不代表优惠适用于所选门店和餐品；以领取后查询的门店可用券及报价结果为准。无券可领或门店没有适用券时，仍保留上述工具记录，`discount` 按实际返回填写（可以为 0）。示例数据的 `sourceTools` 保持空数组，不伪造领券记录。

## 餐品 items

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一、非空字符串，可使用餐品编码；不包含用户标识 |
| `name` | 查询得到的名称，应包含必要规格 |
| `quantity` | 1–100 的整数 |
| `role` | 主食担当、小食担当、饮品担当等简短标签 |
| `art` | `burger` / `fries` / `drink` / `nuggets` / `wrap` / `salad` / `dessert` / `coffee` / `generic` |
| `unitPrice` | 单份优惠前价格，未知或无法分摊套餐价时为 null |
| `hints` | 1–3 条提示，先宽泛后具体，不要第一条就公布名字 |
| `entrance` | 例如「我就是——巨无霸汉堡！」 |
| `reason` | 为什么适合本次人数、预算及偏好；事实须有依据 |
| `nutrition` | 可选，查询确实返回的营养说明；否则 null 或省略 |
| `imageFile` | 可选，相对菜单 JSON 的本地 PNG / JPEG / WebP 路径；最多 5 MB |
| `image` | 可选，已嵌入的 PNG / JPEG / WebP base64 data URL |

当所有单价已知时，脚本要求「单价 × 数量」之和等于小计。无法分摊套餐价格时，相关单价留空，页面使用组合总价展示；不要为了通过校验而编造分摊价格。

输出会嵌入图片并移除 `imageFile` 的本地路径，其余未列入白名单的字段不导出。包含 Token、密码、Authorization、手机号、地址等字段时拒绝生成。导出前仍需检查需求摘要和文案是否已脱敏。
