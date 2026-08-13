import type { Provider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai.js";

// Prototype needs only the two providers whose image-block shape we validate.
// Modeled on greenbump's src/agent/factory.ts PRESETS/DETECT_ORDER pattern.
type Protocol = "openai" | "anthropic";

interface Preset {
  label: string;
  protocol: Protocol;
  baseURL?: string;
  keyEnv: string;
  defaultModel: string;
}

export const PRESETS: Record<string, Preset> = {
  anthropic: { label: "Anthropic (Claude)", protocol: "anthropic", keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5" },
  openai: { label: "OpenAI", protocol: "openai", baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-5" },
};

const DETECT_ORDER = ["anthropic", "openai"];

export interface ProviderChoice {
  provider?: string;
  model?: string;
  apiKey?: string;
}

function pickPresetName(choice: ProviderChoice): string | undefined {
  if (choice.provider) {
    if (!PRESETS[choice.provider]) throw new Error(`Unknown provider "${choice.provider}"`);
    return choice.provider;
  }
  return DETECT_ORDER.find((name) => process.env[PRESETS[name].keyEnv]);
}

export function createProvider(choice: ProviderChoice = {}): Provider {
  const presetName = pickPresetName(choice);
  if (!presetName) {
    throw new Error(
      `No API key found. Set one of: ${DETECT_ORDER.map((n) => PRESETS[n].keyEnv).join(", ")}`,
    );
  }
  const preset = PRESETS[presetName];
  const apiKey = choice.apiKey || process.env[preset.keyEnv];
  if (!apiKey) throw new Error(`${preset.label} selected but ${preset.keyEnv} is not set.`);
  const model = choice.model || preset.defaultModel;

  if (preset.protocol === "anthropic") return new AnthropicProvider(apiKey, model);
  return new OpenAICompatProvider(presetName, apiKey, preset.baseURL!, model);
}
