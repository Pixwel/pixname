// Which model AI matching uses, and how it's reached:
// - ANTHROPIC_API_KEY set: straight to Anthropic with that key.
// - otherwise: Vercel AI Gateway (authenticates itself on Vercel; AI_GATEWAY_API_KEY for local dev).
// PIXNAME_MODEL may be written either way ("anthropic/claude-sonnet-5.5" or "claude-sonnet-5-5").
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

const DEFAULT_MODEL = "claude-sonnet-5-5"; // fast and inexpensive; claude-opus-5-5 for hardest cases

/** "anthropic/claude-opus-5.5" → "claude-opus-5-5" (Anthropic API ids use dashes). */
export const anthropicId = (id: string) => id.replace(/^anthropic\//, "").replace(/(\d)\.(\d)/g, "$1-$2");

/** "claude-opus-5-5" → "anthropic/claude-opus-5.5" (Gateway ids are creator/name with dotted versions). */
export const gatewayId = (id: string) =>
  id.includes("/") ? id : `anthropic/${id.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;

export function modelConfig(env: Record<string, string | undefined> = process.env): { via: "anthropic" | "gateway"; id: string } {
  const configured = env.PIXNAME_MODEL?.trim() || DEFAULT_MODEL;
  return env.ANTHROPIC_API_KEY?.trim()
    ? { via: "anthropic", id: anthropicId(configured) }
    : { via: "gateway", id: gatewayId(configured) };
}

export function languageModel(): LanguageModel {
  const { via, id } = modelConfig();
  return via === "anthropic" ? anthropic(id) : id;
}

export const modelLabel = () => {
  const { via, id } = modelConfig();
  return `${id} via ${via === "anthropic" ? "Anthropic API" : "AI Gateway"}`;
};

/**
 * AI matching is on unless PIXNAME_AI=off, and only when a model is reachable: an Anthropic key,
 * a Gateway key, or a Vercel deployment (whose AI Gateway access needs no key).
 */
export function aiAvailable(env: Record<string, string | undefined> = process.env): boolean {
  if (env.PIXNAME_AI?.trim() === "off") return false;
  return [env.ANTHROPIC_API_KEY, env.AI_GATEWAY_API_KEY, env.VERCEL_OIDC_TOKEN, env.VERCEL].some((v) => !!v?.trim());
}
