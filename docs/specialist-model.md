# Specialist model: free labels → a cheaper, decisive classifier

Status: **data + harness ready, baseline measured**. The deterministic tier is a label factory — this document covers what's exported, the baseline it must beat, and the exact path to a fine-tuned specialist when someone wants to pay for training + hosting.

## What exists today

- **`npm run export:labels`** (`scripts/export-training-data.ts`) → `data/training/`:
  - 652 labeled (beforeCrop, afterCrop) region pairs
  - 636 with **deterministic labels at zero cost** (the tier already knows changeType + description exactly)
  - 16 pixel-only labels **already paid for** in the v0.2 live run (qwen3.8-max)
  - distribution: spatial-shift 346, size-change 146, color-change 44, element-remove 42, style-change 29, element-add 23, text-change 22
- **`npm run eval:specialist`** (`scripts/eval-specialist.ts`): classify exported crops with the pipeline's hint-free prompt, score exact-match changeType accuracy (overall + per-kind). Cost-logged automatically.

## Baseline to beat (measured 2026-09-08, n=24 stratified, qwen3.8-max, hint-free)

**50.0% overall type accuracy** — and every miss is the same failure mode: the model hedges subtle changes (small color/size/shift/style deltas) into `other`. The two things this proves:

1. The DOM hint is load-bearing (with it, classification is 90%+); a specialist must learn decisiveness from data, not from hints.
2. There is clear headroom: the deterministic labels ARE the answer key a specialist can be trained to reproduce — targeting decisiveness on exactly the classes the big model refuses to call.

## Path to an actual fine-tune (entitlement verified)

- DashScope **native** fine-tuning API is entitled on this account (`GET /api/v1/fine-tunes` → 200). The OpenAI-compatible mode does **not** expose fine-tuning (404).
- Data prep: convert `labels.jsonl` + crops into DashScope's fine-tune JSONL (`{"messages":[{role,content:[{type:"image",...},{type:"text",...}]}]}` per row; images as base64 or OSS URLs).
- `POST /api/v1/fine-tunes` with the training file + a qwen-vl base model → wait for the job → the model deploys as a dedicated endpoint.
- **Why we didn't run it**: a fine-tune job plus a hosted endpoint is recurring paid infrastructure, not a one-off experiment. That's a deliberate product/cost decision to make with real usage data first — the export and harness make it a two-command decision whenever the time comes.
- Success criterion when run: hint-free type accuracy on the held-out export ≥90% at classification-tier cost (a fraction of qwen3.8-max), letting the cheap tier drop its price floor again.

## Honest caveats

- The deterministic labels are synthetic-fixture-biased (same as the dataset); a specialist trained only on them inherits that bias. Mix in real-repo crops before production use.
- `other` vs `color-change` boundary (e.g. the image-swap pair) is a label-granularity question, not a model question — the export inherits the dataset's labels verbatim.
