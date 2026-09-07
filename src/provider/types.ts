// Provider-neutral multimodal chat turn, modeled on greenbump's src/agent/provider.ts
// but with images widened into the content model from day one.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" };

export type Msg = { role: "user" | "assistant"; content: ContentBlock[] };

export interface TurnResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface SendOpts {
  /** what this call is for ("classify-region", "judge", …) — recorded in the cost log */
  fn?: string;
  /** hard output cap for this call; descriptions are one sentence, judges return small JSON */
  maxTokens?: number;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  send(system: string, messages: Msg[], opts?: SendOpts): Promise<TurnResult>;
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

export function imageBlock(data: string, mimeType: "image/png" | "image/jpeg" = "image/png"): ContentBlock {
  return { type: "image", data, mimeType };
}
