import type { Msg, Provider, TurnResult } from "./provider/types.js";

/** A scripted provider: returns each entry in `turns` in order, one per send() call. */
export function scriptedProvider(turns: Array<{ text: string }>): Provider & { calls: Msg[][]; systems: string[] } {
  let i = 0;
  const calls: Msg[][] = [];
  const systems: string[] = [];
  return {
    name: "stub",
    model: "stub-model",
    calls,
    systems,
    async send(system: string, messages: Msg[]): Promise<TurnResult> {
      systems.push(system);
      calls.push(messages);
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      return { text: turn.text, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}
