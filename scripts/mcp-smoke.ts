#!/usr/bin/env tsx
/**
 * MCP server smoke test: spawns dist/mcp/server.js over stdio and walks the
 * real client handshake (initialize → initialized → tools/list → tools/call
 * diff_screenshots on a dataset pair). Zero API calls needed — without keys,
 * escalated regions come back pending, which still exercises the full path.
 *
 * Usage: npm run build && npx tsx scripts/mcp-smoke.ts
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

async function main() {
  const server = spawn("node", [path.join(ROOT, "dist", "mcp", "server.js")], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const pending = new Map<number, (r: RpcResponse) => void>();
  server.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* non-JSON line on stdout — ignore */
      }
    }
  });
  server.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) console.log(`  [server] ${text}`);
  });

  let nextId = 1;
  function send(method: string, params?: unknown): void {
    server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");
  }
  function call(method: string, params?: unknown): Promise<RpcResponse> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000);
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }) + "\n");
    });
  }

  try {
    // 1. initialize handshake
    const init = await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vlm-diff-smoke", version: "0.0.1" },
    });
    const serverInfo = (init.result as { serverInfo?: { name?: string } })?.serverInfo;
    console.log(`✓ initialize: server="${serverInfo?.name}"`);
    send("notifications/initialized");

    // 2. tools/list
    const tools = await call("tools/list");
    const names = ((tools.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    console.log(`✓ tools/list: ${names.join(", ")}`);
    if (!names.includes("diff_screenshots") || !names.includes("snapshot_url")) {
      throw new Error(`missing expected tools in ${JSON.stringify(names)}`);
    }

    // 3. tools/call diff_screenshots on a real dataset pair with its DOM
    // snapshots → fully deterministic path, no API keys needed
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dataset: Array<{ id: string; before: string; after: string; domBefore: string; domAfter: string }> = JSON.parse(
      await readFile(path.join(ROOT, "data", "dataset.json"), "utf8"),
    );
    const pair = dataset.find((p) => p.id === "card-list-color-change-large")!;
    const scratch = await mkdtemp(path.join(tmpdir(), "vlm-diff-mcp-smoke-"));
    const domBeforePath = path.join(scratch, "dom-before.json");
    const domAfterPath = path.join(scratch, "dom-after.json");
    await writeFile(domBeforePath, pair.domBefore);
    await writeFile(domAfterPath, pair.domAfter);

    const callResult = await call("tools/call", {
      name: "diff_screenshots",
      arguments: {
        before: path.join(ROOT, "data", pair.before),
        after: path.join(ROOT, "data", pair.after),
        dom_before: domBeforePath,
        dom_after: domAfterPath,
      },
    });
    const content = (callResult.result as { content?: Array<{ type: string; text: string }> })?.content ?? [];
    const text = content.map((c) => c.text).join("\n");
    console.log("✓ tools/call diff_screenshots:");
    console.log(text.split("\n").slice(0, 4).map((l) => `    ${l}`).join("\n"));
    if (!/CHANGE DETECTED/.test(text)) {
      throw new Error("expected CHANGE DETECTED for the color-change pair");
    }
    if (!/background color changed from blue/.test(text)) {
      throw new Error("expected the deterministic color description in the verdict");
    }

    console.log("\n✅ MCP smoke test passed");
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
