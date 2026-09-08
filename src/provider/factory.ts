import type { Provider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai.js";
import { InstrumentedProvider } from "./instrumented.js";

// Prototype needs only the two providers whose image-block shape we validate.
// Modeled on greenbump's src/agent/factory.ts PRESETS/DETECT_ORDER pattern.
type Protocol = "openai" | "anthropic";

interface Preset {
  label: string;
  protocol: Protocol;
  baseURL?: string;
  keyEnv: string;
  defaultModel: string;
  /** cheaper model for high-volume, low-complexity calls (region classification).
   *  Override globally with VLM_DIFF_CLASSIFY_MODEL. */
  cheapModel?: string;
}

export const PRESETS: Record<string, Preset> = {
  anthropic: { label: "Anthropic (Claude)", protocol: "anthropic", keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5", cheapModel: "claude-haiku-4.5" },
  openai: { label: "OpenAI", protocol: "openai", baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-5", cheapModel: "gpt-4o-mini" },
  // Moonshot's API is OpenAI-compatible; any vision-capable Kimi model works.
  // Override the model via MOONSHOT_MODEL if the exact ID differs.
  moonshot: { label: "Moonshot (Kimi)", protocol: "openai", baseURL: "https://api.moonshot.cn/v1", keyEnv: "MOONSHOT_API_KEY", defaultModel: "kimi-k3", cheapModel: "kimi-k3" },
  // Alibaba DashScope OpenAI-compatible mode; hosts third-party models incl. Kimi.
  // cheapModel is a documented default — account entitlements vary; set
  // VLM_DIFF_CLASSIFY_MODEL to what your account can actually call.
  dashscope: { label: "Alibaba DashScope", protocol: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY", defaultModel: "kimi/kimi-k3", cheapModel: "qwen3.8-flash" },
  // OpenCode Zen gateway (https://opencode.ai/zen): OpenAI-compatible
  // chat/completions for Kimi/GLM/MiniMax/DeepSeek, Anthropic-compatible for
  // Claude-family. We only use the chat/completions side. Model override via
  // OPENCODE_MODEL (e.g. glm-5.2, kimi-k2.5, minimax-m3).
  opencode: { label: "OpenCode Zen", protocol: "openai", baseURL: "https://opencode.ai/zen/v1", keyEnv: "OPENCODE_API_KEY", defaultModel: "kimi-k3", cheapModel: "kimi-k3" },
};

const DETECT_ORDER = ["anthropic", "openai", "moonshot", "dashscope", "opencode"];

export interface ProviderChoice {
  provider?: string;
  model?: string;
  apiKey?: string;
  /**
   * "cheap": high-volume, low-complexity calls (per-region classification).
   * Resolves VLM_DIFF_CLASSIFY_MODEL → preset.cheapModel → default model, so
   * nothing changes unless a cheaper tier is explicitly configured.
   */
  tier?: "cheap" | "reasoning";
}

function pickPresetName(choice: ProviderChoice): string | undefined {
  if (choice.provider) {
    if (!PRESETS[choice.provider]) throw new Error(`Unknown provider "${choice.provider}"`);
    return choice.provider;
  }
  return DETECT_ORDER.find((name) => process.env[PRESETS[name].keyEnv]);
}

function instantiate(presetName: string, choice: ProviderChoice): Provider {
  const preset = PRESETS[presetName];
  const apiKey = choice.apiKey || process.env[preset.keyEnv];
  if (!apiKey) throw new Error(`${preset.label} selected but ${preset.keyEnv} is not set.`);

  let model = choice.model || process.env[`${presetName.toUpperCase()}_MODEL`] || preset.defaultModel;
  if (choice.tier === "cheap" && process.env.VLM_DIFF_CLASSIFY_MODEL) {
    // strictly opt-in: preset cheapModel is documentation only. Auto-routing
    // to a preset cheap model silently changed eval results (and 403'd on
    // accounts without that model's entitlement — found on DashScope).
    model = process.env.VLM_DIFF_CLASSIFY_MODEL;
    console.log(`[router] classification routed to cheap tier: ${presetName}/${model}`);
  }

  const raw = preset.protocol === "anthropic"
    ? new AnthropicProvider(apiKey, model)
    : new OpenAICompatProvider(presetName, apiKey, preset.baseURL!, model);
  // every provider is instrumented: cost log + budget guard are always on
  return new InstrumentedProvider(raw);
}

export function createProvider(choice: ProviderChoice = {}): Provider {
  const presetName = pickPresetName(choice);
  if (!presetName) {
    throw new Error(
      `No API key found. Set one of: ${DETECT_ORDER.map((n) => PRESETS[n].keyEnv).join(", ")}`,
    );
  }
  return instantiate(presetName, choice);
}

/**
 * Provider for LLM-as-judge scoring, kept independent from the provider under
 * test to avoid self-preference bias (a model scoring its own output tends to
 * rate it higher than an independent judge would). Picks the first preset
 * with an API key set that differs from `primary`'s vendor; falls back to
 * `primary` itself (with a stderr warning) if no second key is available.
 */
export function createJudgeProvider(primary: Provider, choice: ProviderChoice = {}): Provider {
  if (choice.provider || choice.apiKey) return createProvider(choice);

  const altName = DETECT_ORDER.find(
    (name) => name !== primary.name && process.env[PRESETS[name].keyEnv],
  );
  if (altName) return instantiate(altName, choice);

  console.warn(
    `[judge] No independent judge provider available (only ${primary.name}'s key is set) — ` +
      `reusing ${primary.name} as judge. Scores may be inflated by self-preference bias.`,
  );
  return primary;
}
