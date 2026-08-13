import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, Msg, Provider, TurnResult } from "./types.js";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.model = model;
    const url = baseURL || process.env.ANTHROPIC_BASE_URL;
    this.client = new Anthropic({ apiKey, ...(url ? { baseURL: url } : {}) });
  }

  async send(system: string, messages: Msg[]): Promise<TurnResult> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      messages: messages.map(toAnthropic),
    });

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
