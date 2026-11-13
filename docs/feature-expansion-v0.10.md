# 功能扩展方案 v0.10(6 方向评估 + 对抗性核验收敛)

> 产生方式:6 个设计 agent 并行调研,6 个对抗性核验 agent 逐个挑战"这真的值得做吗"。
> 本文只保留核验后仍然成立的部分,并标注核验者发现的草案缺陷。

## 总评

| 方向 | 核验结论 | 一句话 |
|---|---|---|
| 集成与生态 | **强烈推荐** | MCP 工具面是唯一"强烈推荐",因为它决定 agent 能不能用 |
| 语义/无障碍规则 | 可做(但要克制) | 只做 1-2 条 axe 没有、且 agent 高发的规则,别和 axe 正面刚 |
| 视觉区域理解 | 可做 | media-attachment(像素区域附着到宿主元素)是最高 ROI |
| 真实页面适配 | 可做 | settlePage(稳定采集)是所有真实页面前提,必须先做 |
| 报告与协作 | 可做(降级) | 只做索引页 + 结构化输出,SARIF/协作别当卖点 |
| 无障碍深度 | 可做(但有红海警告) | 只做"diff 侧 a11y 回归"这种 axe 结构性做不到的 |

---

## 一、强烈推荐:MCP 工具面扩展(先做)

**核验者原话**:"这是唯一一个'强烈推荐',因为它决定 agent 能不能用这个工具。"

### 做什么

MCP 现在只有 2 个工具(`snapshot_url`、`diff_screenshots`)。agent 想验证"我刚改的那页对不对"需要跑完整基线流程,太笨重。

**新增 4 个工具**(全部复用现有函数,零 API 变更):

| 工具 | 功能 | 解决的痛点 |
|---|---|---|
| `baseline_check` | 对已有基线跑 check,支持 **per-page 过滤** | agent 只想验刚改的那页,不是全站 |
| `audit_url` | 对 URL 跑零基线 audit | agent 改完代码立即自查,无需基线 |
| `why_url` | CSS 归因(已实现的 `why` 命令) | 知道"改哪行"而不只是"哪里变了" |
| `baseline_seed` | 从当前页面建立基线 | 首次使用的一步到位 |

**核验者发现的关键缺陷**(必须修):`baseline_check` 假设 `.vlm-diff/baseline/` 已存在,但真实会话里往往没有 init 过。方案:`baseline_seed` 必须在 `baseline_check` 失败时作为下一步提示返回,形成闭环。

**工作量**:S(纯封装,`runBaseline`/`runAudit`/`runWhy` 都已存在)。**全部离线可验证**(`mcp:smoke` 框架已有)。

---

## 二、可做:真实页面稳定采集(`settlePage`)

**核验者确认**:这是所有真实页面场景的前提。现在 `snapshot` 只等 `load + 100ms`,真实页面有懒加载/字体/动画,导致误报。

### 做什么

在 `src/snapshot/capture.ts` 加 `settlePage(page, opts)`:

1. `networkidle`(500ms 静默上限,超时降级到 `load` 并记录到 diagnostics)
2. `document.fonts.ready`(等字体加载完)
3. 双 `requestAnimationFrame`(等动画帧稳定)
4. CSS freeze 注入(禁用 CSS animation/transition)

**收益**:真实页面的"假阳性"(其实是采集时机问题)直接消失。**工作量**:S/M。

---

## 三、可做:视觉区域理解(media-attachment)

**核验者评价**:"唯一同时砍 token 成本(约省 85% 图像 token)和修复一个已被代码注释承认的失败模式的改动。"

### 做什么

像素独有区域(canvas/SVG/图片)现在直接裁剪送 VLM,裁剪失去上下文(参照系)。改成:

1. **附着**:像素区域反查最近的宿主元素(`<canvas>`/`<svg>`/`<img>` 的 rect 与像素区域求交)
2. **上下文**:把宿主元素的 id、前面的标题文本作为 DOM hint 传给 VLM
3. **聚合**:同一宿主的多个像素碎片合并成一个区域再裁剪

**效果**:canvas 场景从 8+6 次 VLM 调用降到 2 次;分类准确率上升(有上下文)。**工作量**:M。

**核验者的警告**:这削弱了"纯确定性"的叙事(hint 是文本证据喂给 VLM)。要在文档里讲清:"hint 是免费证据的传递,不是纯靠提示词"。

---

## 四、可做但要克制:语义/无障碍规则

**核验者的红海警告**:axe-core 已经占了 a11y 审计的主导地位,且是 MIT 许可。**不要和 axe 正面刚"单帧能查多少条规则"**,要做的是 axe 结构性做不到的。

### 只做这两条

1. **`link-no-href`**(`<a>` 没有 href,或有 onclick 但无 href)—— axe 不查,且是 agent 重构时的高发错误(把 `<a href>` 改成 `<a onclick>` 或留下 `href="javascript:void(0)"`)。**在 diff 模式下价值翻倍**:before 有 href、after 没有 = 明确回归。

2. **`form-label-unlinked`**(input 没有关联的 label)—— 真实页面第一类 a11y 缺陷。需要 snapshot 多采一个字段(`<label>` 的 `for` 属性),成本低。

**不做的**:焦点陷阱(需要运行时模拟 Tab)、文本缩放 200%(需要二次渲染)——核验者确认这两条在纯 DOM 模型下做不了,别硬上。

**关键设计约束**(核验者发现):新采集的字段(如 `outline`、`fontSize`)**不能进 diff 比较**,否则所有旧 baseline 会集体报 phantom change。沿用 `inputType` 的先例:capture 但不 diff。

---

## 五、可做(降级):报告与协作

**核验者的定位警告**:"这个方向在'为人类 reviewer 打磨 GitHub 阅读体验',而项目定位是 agent 可编程消费的验证层。"

### 只做这两个

1. **`check` 的索引页**(`index.html`):多页 check 后生成一个汇总索引,列出所有页面 + 严重度徽章。这是所有其他东西的载体(PR 评论链接、SARIF 都共用这份数据)。

2. **JUnit XML 输出**:`check --format junit` 输出标准格式,所有 CI 都能消费。SARIF 核验者发现 GitHub 免费版私有仓库不可用,降级为"顺手做的 emitter",别当卖点。

**不做的**:托管 dashboard、多人审批、评论 @提及——和"agent 验证层"定位冲突,且是 Percy 的主场。

---

## 六、无障碍深度:只做"diff 侧回归"

**核验者的核心洞察**:a11y 静态审计是红海(axe 主导),但 **axe 是单帧工具,做不了"回归"**——"before 有 label,after 没了"这种 diff 语境下的 a11y 退化,axe 结构性看不见。

### 做什么

把现有的对比度检测泛化:**任何 a11y 属性的 before→after 退化**(label 丢失、tabindex 被移除、heading 层级变化)都在 diff 报告里标记为 a11y 回归。

这是唯一 axe 做不到、且我们是唯一能做到的(因为有 before/after 两份 DOM)。

---

## 落地顺序(按依赖和 ROI)

| 顺序 | 做什么 | 工作量 | 理由 |
|---|---|---|---|
| **1** | MCP 工具面扩展(4 个新工具) | S | 唯一"强烈推荐";决定 agent 能不能用 |
| **2** | `settlePage` 稳定采集 | S/M | 所有真实页面场景的前提 |
| **3** | media-attachment(视觉区域附着) | M | 最高 ROI;修复已知的裁剪失去参照系问题 |
| **4** | `check` 索引页 + JUnit 输出 | S | 协作的最低可用集合 |
| **5** | `link-no-href` + `form-label-unlinked` | S/M | axe 没有且 agent 高发的两条规则 |
| **6** | diff 侧 a11y 回归泛化 | M | axe 结构性做不到的差异化 |
| 7 | SARIF emitter | S | 顺手做,别当卖点 |

**明确不做的**:多浏览器(基础设施差距)、托管 dashboard(和定位冲突)、焦点陷阱/文本缩放(纯 DOM 做不了)、和 axe 正面刚规则数量(红海)。

---

## 核验者发现的、必须在实现时小心的坑

1. **新采集字段不能进 diff 比较**(否则旧 baseline 全报 phantom change)——沿用 `inputType` 的"capture 但不 diff"隔离设计。
2. **media-attachment 削弱了"纯确定性"叙事**——文档里要讲清 hint 是"免费证据传递"。
3. **SARIF 在 GitHub 免费版私有仓库不可用**——别当卖点。
4. **baseline_check 的 stateful 前置**——必须有"没有基线就提示先 seed"的闭环。
5. **别把 audit 扩成 axe 的复制品**——只做 axe 结构性做不到的(diff 侧回归),否则稀释了真正的差异化。
