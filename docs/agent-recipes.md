# Agent recipes: make your coding agent verify its own UI changes

vlm-diff's MCP server turns "did my UI change, and what exactly?" into a tool call. After an agent edits UI code, it can capture the page before/after, diff them, and read a structured verdict — deterministic-first (zero tokens for DOM-explained changes), with severity and DOM evidence, plus the annotated frame showing where the regions are.

The server exposes two tools over stdio:

| Tool | What it does |
|---|---|
| `snapshot_url` | Capture a URL's DOM snapshot (`.dom.json`) + screenshot (`.png`) into the OS temp dir, and returns both paths plus the screenshot itself |
| `diff_screenshots` | Diff a before/after pair (optionally with DOM snapshots); returns a text summary, a **structured verdict** (changed / changeType / severity / regions with descriptions + DOM evidence), and the **annotated after frame** with numbered severity-colored boxes |

Exit semantics mirror the CLI: DOM-observable changes are described deterministically at zero tokens; pixel-only deltas (canvas repaints, image swaps) escalate to a VLM when an API key is configured, otherwise they come back marked `pending`.

---

## Claude Code

Register once:

```bash
claude mcp add vlm-diff -- node /path/to/vlm-diff/dist/mcp/server.js
```

Then teach the agent the habit — add to your project's `CLAUDE.md`:

```md
## Visual verification
After changing any UI code (components, CSS, layout), verify the render:
1. Call `snapshot_url` for the page BEFORE your change is applied (or read the existing baseline), and again AFTER.
2. Call `diff_screenshots` with both snapshots (pass the .dom.json paths too).
3. If the verdict's `severity` is "breaking", treat it as a bug you introduced — fix it before finishing. "moderate"/"cosmetic": report it and continue.
4. Pixel-only regions may return `pending` — that means a VLM key is needed (DASHSCOPE_API_KEY etc.). Ask the user if you see it.
```

## Cursor

Cursor reads MCP config from `.cursor/mcp.json` in the project (or globally). Add:

```json
{
  "mcpServers": {
    "vlm-diff": {
      "command": "node",
      "args": ["/path/to/vlm-diff/dist/mcp/server.js"]
    }
  }
}
```

Add the same "Visual verification" block to your `.cursor/rules` (or `.cursorrules`) so the agent runs the verify loop after UI edits.

## ZCode

Register the server in your MCP config (same stdio command):

```json
{
  "mcpServers": {
    "vlm-diff": { "command": "node", "args": ["/path/to/vlm-diff/dist/mcp/server.js"] }
  }
}
```

Add the verification rule to `AGENTS.md` in your project root — same "Visual verification" block as above.

---

## Why the agent trusts the output

- **Evidence, not vibes**: deterministic descriptions carry the raw DOM values they came from (`backgroundColor: rgb(37,99,235) → rgb(220,38,38)`) — the agent can check the claim, not just believe it.
- **Severity tiers**: `breaking` (element add/remove, numeric/price text), `moderate` (large moves/resizes, copy), `cosmetic` (color/style) — the agent can gate its own behavior ("never ship breaking").
- **Structured output**: the verdict is typed JSON (`structuredContent`), not text to re-parse.
- **Visible regions**: the annotated frame shows numbered boxes exactly where the changes are, color-coded by severity — the agent (or you) can see them at a glance.
- **Cost is bounded**: DOM-explained changes cost zero tokens; only pixel-only deltas escalate, and every escalated call is logged to `.cache/cost-log.jsonl`.

## CI variant (no agent needed)

The same engine runs as a GitHub Action on every PR — see the GitHub Action section in the README. Agents verify locally; CI verifies on merge. Same verdict, same evidence, same exit codes.
