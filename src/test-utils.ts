import type { Msg, Provider, TurnResult } from "./provider/types.js";

/** A scripted provider: returns each entry in `turns` in order, one per send() call. */
export function scriptedProvider(turns: Array<{ text: string }>): Provider & { calls: Msg[][] } {
  let i = 0;
  const calls: Msg[][] = [];
  return {
    name: "stub",
    model: "stub-model",
    calls,
    async send(_system: string, messages: Msg[]): Promise<TurnResult> {
      calls.push(messages);
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      return { text: turn.text, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}
