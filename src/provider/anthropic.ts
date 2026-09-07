import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, Msg, Provider, SendOpts, TurnResult } from "./types.js";
import { withRetry, withTimeout } from "./retry.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.model = model;
    const url = baseURL || process.env.ANTHROPIC_BASE_URL;
    this.client = new Anthropic({ apiKey, maxRetries: 0, ...(url ? { baseURL: url } : {}) });
  }

  async send(system: string, messages: Msg[], opts?: SendOpts): Promise<TurnResult> {
    const timeoutMs = Number(process.env.VLM_DIFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const resp = await withRetry(() =>
      withTimeout(
        this.client.messages.create({
          model: this.model,
          // per-call cap; the old hardcoded 2048 stays the ceiling
          max_tokens: Math.min(opts?.maxTokens ?? 2048, 2048),
          system,
          messages: messages.map(toAnthropic),
        }),
        timeoutMs,
        `${this.name}/${this.model}`,
      ),
    );

    let text = "";
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
    }
    return {
      text,
      usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
    };
  }
}

function toAnthropic(m: Msg): Anthropic.MessageParam {
  return { role: m.role, content: m.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(b: ContentBlock): Anthropic.ContentBlockParam {
  if (b.type === "text") return { type: "text", text: b.text };
  return {
    type: "image",
    source: { type: "base64", media_type: b.mimeType, data: b.data },
  };
}
