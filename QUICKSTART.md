# Quick Start Guide

Get VLM-Diff running in 5 minutes and see it detect visual changes in UI screenshots.

## Prerequisites

- Node.js 18+
- API key from Anthropic or OpenAI (vision-enabled)

## Installation

```bash
git clone https://github.com/shidesheng0218/vlm-diff.git
cd vlm-diff
npm install
```

## Setup API Key

Create a `.env` file:

```bash
# For Anthropic (recommended)
ANTHROPIC_API_KEY=sk-ant-...

# OR for OpenAI
OPENAI_API_KEY=sk-...
```

## Run a Demo

We include 3 pre-built test fixtures. Let's detect a color change:

```bash
# Generate test screenshots
npm run demo:generate

# Run detection
npm run demo:detect
```

You'll see output like:

```
✅ Change detected: Color change
   Location: {x: 20, y: 150, width: 280, height: 120}
   Description: Button background changed from blue to red
   Confidence: 0.92
```

## Try Your Own Screenshots

### Step 1: Capture screenshots with DOM snapshots

```typescript
import { chromium } from 'playwright';
import { serializeDom } from './src/dataset/serialize-dom';

const browser = await chromium.launch();
const page = await browser.newPage();

// Before state
await page.goto('http://localhost:3000');
const domBefore = await page.evaluate(serializeDom);
await page.screenshot({ path: 'before.png' });

// Make a change (e.g., click a button, change CSS)
await page.click('#toggle-theme');

// After state
const domAfter = await page.evaluate(serializeDom);
await page.screenshot({ path: 'after.png' });

await browser.close();
```

### Step 2: Run comparison

```typescript
import { detectChanges } from './src/detect';
import { classifyWithVlm } from './src/classify';
import { AnthropicProvider } from './src/provider/anthropic';

// Stage 1: Detect candidate regions
const candidates = await detectChanges({
  beforeImage: 'before.png',
  afterImage: 'after.png',
  domBefore,
  domAfter,
});

if (candidates.length === 0) {
  console.log('No changes detected');
} else {
  // Stage 2: Classify with VLM
  const provider = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-opus-4-20250514',
  });

  for (const candidate of candidates) {
    const result = await classifyWithVlm({
      beforeImage: 'before.png',
      afterImage: 'after.png',
      region: candidate.rect,
      provider,
    });
    
    console.log('✅', result.changeType);
    console.log('  ', result.description);
  }
}
```

### Step 3: Generate HTML report (optional)

```bash
npm run report:generate -- \
  --before before.png \
  --after after.png \
  --results results.json \
  --output report.html
```

Opens an HTML report with annotated screenshots showing detected regions.

## Understanding the Output

```json
{
  "changed": true,
  "regions": [
    {
      "rect": {"x": 20, "y": 150, "width": 280, "height": 120},
      "changeType": "color-change",
      "description": "Button background changed from blue (#2563eb) to red (#dc2626)",
      "confidence": 0.92,
      "source": "dom-diff"  // or "pixel-diff"
    }
  ],
  "tokenUsage": {
    "input": 842,
    "output": 45
  }
}
```

**Key fields**:
- `changed`: `false` if DOM reports no changes (suppresses pixel noise)
- `source: "dom-diff"`: Change detected via DOM comparison (structural)
- `source: "pixel-diff"`: Change detected via pixel comparison only (e.g., canvas repaint)
- `confidence`: VLM's self-reported confidence (0-1)

## Common Issues

### "No API key found"

Make sure `.env` is in the project root and contains:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Load it before running:
```bash
source .env  # or use dotenv
npm run demo:detect
```

### OpenAI connection timeout

If behind a firewall/proxy:
```bash
export https_proxy=http://your-proxy:port
npm run demo:detect
```

Or switch to Anthropic (no proxy needed in most regions).

### "Request not allowed" (Anthropic 403)

Your API key might not have Messages API access. Check:
- Key is from https://console.anthropic.com/settings/keys
- Account has Claude API access (not just claude.ai web)

### High false-positive rate

1. Check DOM snapshots are captured correctly:
```typescript
console.log(domBefore.elements.length); // should be >10
```

2. Adjust pixel diff threshold in `src/detect/pixel-diff.ts`:
```typescript
const threshold = 0.15;  // increase to 0.2 for noisier screenshots
```

## Cost Estimation

For a 960×500 screenshot pair with 2 detected regions:

**Anthropic (Claude Opus 4)**
- Input: ~800 tokens × 2 regions = 1600 tokens
- Output: ~40 tokens × 2 regions = 80 tokens
- Cost: ~$0.024 per comparison

**OpenAI (GPT-4o)**
- Input: ~850 tokens × 2 = 1700 tokens
- Output: ~35 tokens × 2 = 70 tokens
- Cost: ~$0.008 per comparison

**Tips**:
- Use pixel-diff-only mode for quick checks (free, but no descriptions)
- Batch multiple PRs before running VLM classification
- Cache baseline screenshots to avoid re-processing

## Next Steps

- **Integrate with CI**: See [CI_INTEGRATION.md](./CI_INTEGRATION.md)
- **Customize detection**: Edit `src/detect/config.ts` for your use case
- **Add your own fixtures**: Put HTML in `src/dataset/fixtures/`
- **Run benchmarks**: `npm run eval:run` (requires valid API key)

## Getting Help

- 📖 Full docs: [README.md](./README.md)
- 🐛 Report issues: https://github.com/shidesheng0218/vlm-diff/issues
- 💬 Discuss: https://github.com/shidesheng0218/vlm-diff/discussions
