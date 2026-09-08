# Publishing checklist (npm + GitHub Marketplace)

One-time setup is done as of 0.5.2; this documents the repeatable parts and the one step automation can't do.

## npm (done, repeatable per release)

```bash
npm run build
npm pack --dry-run          # sanity: tarball has both bins, no *.test.js, no eval/dataset/scripts
npm publish --access public # needs a 2FA OTP if the account has 2FA enabled
npm view vlm-diff           # verify it's live
```

The package ships runtime code only (`files` whitelist); `prepack` rebuilds dist and strips compiled tests.

## GitHub Marketplace listing (manual, once per repo)

GitHub has no API for this — the final step is a web checkbox:

1. Go to the repo's action page: https://github.com/shidesheng0218/vlm-diff/actions or open any `v*` release.
2. Open the release (e.g. `v0.5.1`) → **Edit release**.
3. Tick **"Publish this action to the GitHub Marketplace"** and save. (GitHub shows this option only because `action.yml` exists at the repo root with valid name/description/branding.)
4. Optionally add a Marketplace category (e.g. "Code review" / "Testing").

Repo discoverability already set via API: topics (visual-regression, dom-diff, vlm, mcp, ai-agents, playwright, screenshot-testing, verifier).

## Release cadence

- Code changes → bump `version` in package.json → commit → push master.
- Tag releases for the Action: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z` (consumers pin `@vX.Y.Z`; the Action's README snippet uses the tag).
- `gh release create vX.Y.Z --notes "…"` for the human-readable release + Marketplace.
- npm publish when the CLI/MCP surface changed (they're versioned together).
