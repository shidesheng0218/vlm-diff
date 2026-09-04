# Twitter 推广文案

## 版本 1：简洁版（推荐）

```
Built VLM-Diff: DOM+VLM pipeline for UI visual regression testing

✅ 92% recall, 0% false positives
✅ Suppresses anti-aliasing noise via DOM ground truth
✅ 68% token cost reduction

Quick demo (2 min): npm run demo:quick

📝 https://dev.to/shidesheng/building-a-visual-regression-tool-with-vlms-and-dom-diffing-1j4m
💻 https://github.com/shidesheng0218/vlm-diff

#WebDev #MachineLearning #Testing #OpenSource
```

## 版本 2：技术详细版

```
Just published: Building a Visual Regression Tool with VLMs and DOM Diffing

The key insight: if the DOM hasn't changed, pixel differences are just rendering noise.

Two-stage pipeline:
1️⃣ DOM diff + pixel diff → localize regions
2️⃣ Crop → VLM classify

Results: 92% recall, 0% false positives on no-change pairs

Read more: https://dev.to/shidesheng/building-a-visual-regression-tool-with-vlms-and-dom-diffing-1j4m

Code: https://github.com/shidesheng0218/vlm-diff
```

## 版本 3：问题导向版

```
Tired of false positives in visual regression testing? 🔴

Percy/Chromatic flag tons of anti-aliasing noise and font rendering jitter.

I built VLM-Diff to solve this using DOM structure as ground truth.

Result: 0% false positives ✅

How it works: https://dev.to/shidesheng/building-a-visual-regression-tool-with-vlms-and-dom-diffing-1j4m

GitHub: https://github.com/shidesheng0218/vlm-diff
```

---

## 发推特时机

**最佳时间**（北京时间）：
- **今晚 22:00-24:00**（美国东海岸早上）
- **明天 08:00-10:00**（美国西海岸下班时间）

**Tag 建议**：
- @simonw（Simon Willison，技术博主）
- @karpathy（Andrej Karpathy，AI 研究者）
- 或者不 tag，只用 hashtags

---

## LinkedIn 分享文案

```
🚀 Just published a deep dive on building a visual regression testing tool with VLMs

The challenge: Traditional tools like Percy and Chromatic produce high false-positive rates from anti-aliasing noise and font rendering jitter.

My solution: Use DOM structure as ground truth. If the DOM hasn't changed, pixel differences are just rendering noise—not semantic changes.

Key results on 39 UI screenshot pairs:
• 92% recall (catches real changes)
• 0% false positives (ignores rendering noise)
• 68% token cost reduction vs naive VLM approaches

The two-stage pipeline:
1. Deterministic detection: DOM diff + pixel diff fusion
2. VLM classification: Crop changed regions → Claude/GPT → classify

Open source (MIT): https://github.com/shidesheng0218/vlm-diff

Full technical writeup: https://dev.to/shidesheng/building-a-visual-regression-tool-with-vlms-and-dom-diffing-1j4m

Would love to hear thoughts from the community—should I productize this into a CLI tool, or continue as academic research?

#WebDevelopment #MachineLearning #Testing #OpenSource #AI
```
