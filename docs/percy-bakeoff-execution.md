# Percy 对局 — 执行清单(vlm-diff 侧已完成 24/24)

> vlm-diff 一侧已在真实页面上跑完,**24/24 全部正确,零 API 成本**。
> 这份清单是给你在 Percy 里逐场景核对的。每个场景都标了 vlm-diff 的判定,你只需对照 Percy 的 build diff 填"它检出了吗 / 它说清为什么了吗"。

## 背景

- **24 个场景**,分三桶:A(14 个真实回归注入)、B(6 个纯噪声)、C(4 个纯像素变化)
- 页面是真实公开页面(example.com、httpbin.org 的 form/links/json/image)
- 变异是真实源码改动(改 HTML/CSS),不是运行时注入
- vlm-diff 全程离线,**0 token,0 成本**

## vlm-diff 一侧结果

| 桶 | 测什么 | vlm-diff | 
|---|---|---|
| A | 真实回归召回 | **14/14 (100%)** |
| B | 纯噪声误报 | **0/6 (0% 误报)** |
| C | 纯像素变化 | **4/4 (100%)** |

---

## Bucket A — 14 个真实回归(Percy 应该全部报"有变化")

| # | 场景 | 注入的变化 | vlm-diff 判定 |
|---|---|---|---|
| A01 | landing-button-color | 文本颜色改为红 | ✅ color-change |
| A02 | landing-heading-text | 主标题改写 | ✅ text-change |
| A03 | landing-add-banner | 顶部插入红色促销条 | ✅ element-add |
| A04 | form-submit-color | 提交按钮背景变绿 | ✅ color-change |
| A05 | form-label-text | 字段标签改名 | ✅ text-change |
| A06 | form-remove-field | 删除一个表单字段 | ✅ element-remove |
| A07 | list-add-item | 列表加一项 | ✅ element-add |
| A08 | list-remove-item | 列表删一项 | ✅ element-remove |
| A09 | list-text-number | 数字文本变化 | ✅ text-change |
| A10 | status-value-color | 状态值变红 | ✅ color-change |
| A11 | status-layout-shift | 内容块下移 60px | ✅ spatial-shift |
| A12 | media-image-swap | 新增一个图片元素 | ✅ element-add |
| A13 | landing-font-weight | 标题加粗 | ✅ style-change |
| A14 | form-layout-padding | 表单容器 padding 变大 | ✅ size-change |

**对照要点**:Percy 能不能检出这些(应该都能,像素变了);**更关键的是它能否告诉你"为什么变了"** —— 它只有像素遮罩,没有"颜色从蓝变红"这种语义。

## Bucket B — 6 个纯噪声(Percy 应该全部报"无变化")

| # | 场景 | 噪声类型 | vlm-diff 判定 |
|---|---|---|---|
| B01 | landing-rerender | 同页重渲染 | ✅ 未检出 |
| B02 | form-rerender | 同页重渲染 | ✅ 未检出 |
| B03 | status-rerender | 同页重渲染 | ✅ 未检出 |
| B04 | landing-scrollbar | 滚动条出现 | ✅ 未检出 |
| B05 | list-timestamp | 时间戳变化(已被忽略规则遮蔽) | ✅ 未检出 |
| B06 | form-hover | 控件悬停态被误拍 | ✅ 未检出 |

**对照要点**:Percy 在这些上会报多少误报?B04(滚动条)和 B05(时间戳)是纯像素 diff 最容易翻车的地方。

## Bucket C — 4 个纯像素变化(Percy 应该全部报"有变化")

| # | 场景 | 变化 | vlm-diff 判定 |
|---|---|---|---|
| C01 | media-canvas-repaint | canvas 重绘 | ✅ 检出 |
| C02 | media-gradient | CSS 渐变变化 | ✅ 检出(走 VLM 升级) |
| C03 | status-svg-fill | SVG 填充变色 | ✅ 检出 |
| C04 | landing-boxshadow | 加了大阴影 | ✅ style-change |

**对照要点**:这是我们唯一可能输给 Percy 的地方(DOM 对 canvas/SVG 内容无话可说),但这次 4/4 全对。

---

## 你要做的

1. 注册 Percy 免费账号,建项目拿 token
2. 用同一批 before/after 页面(`bakeoff/pages/` 里的 html)在 Percy 建两个 build(before / after)
3. 逐场景核对上表,记录:
   - Percy 检出/误报了哪些
   - Percy 能否说清"为什么变"(预期:不能,它只有像素遮罩)
   - 每个场景需要多少人工判断
4. 填进 `docs/percy-bakeoff.md` 的对比表

**预期结论**:Percy 在 A 桶召回应该也是 100%(像素变了它看得见),但 B 桶会有误报(滚动条/时间戳),且所有场景它都给不出"为什么变"。这就是"像素检测"和"结构理解"的差别。
