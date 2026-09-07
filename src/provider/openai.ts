import OpenAI from "openai";
import type { ContentBlock, Msg, Provider, SendOpts, TurnResult } from "./types.js";
import { withRetry, withTimeout } from "./retry.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenAICompatProvider implements Provider {
  readonly name: string;
  readonly model: string;
  private client: OpenAI;

  constructor(name: string, apiKey: string, baseURL: string, model: string) {
    this.name = name;
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  }

  async send(system: string, messages: Msg[], opts?: SendOpts): Promise<TurnResult> {
    const timeoutMs = Number(process.env.VLM_DIFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const resp = await withRetry(() =>
      withTimeout(
        this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: "system", content: system }, ...messages.map(toOpenAI)],
          // the OpenAI adapter previously sent NO output cap at all
          ...(opts?.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
        }),
        timeoutMs,
        `${this.name}/${this.model}`,
      ),
    );

    const text = resp.choices[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function toOpenAI(m: Msg): OpenAI.Chat.ChatCompletionMessageParam {
  if (m.role === "assistant") {
    // Assistant turns in this pipeline are always plain text (the model
    // replying with its classification); images only ever appear in user
    // turns, so the SDK's stricter assistant-content type is fine here.
    const text = m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { role: "assistant", content: text };
  }
  return { role: "user", content: m.content.map(toOpenAIBlock) };
}

function toOpenAIBlock(b: ContentBlock): OpenAI.Chat.ChatCompletionContentPart {
  if (b.type === "text") return { type: "text", text: b.text };
  return { type: "image_url", image_url: { url: `data:${b.mimeType};base64,${b.data}` } };
}
