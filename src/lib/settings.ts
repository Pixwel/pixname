import { load, type Store } from "@tauri-apps/plugin-store";
import type { Asset } from "./types";

export type Environment = "production" | "staging" | "custom";

export interface Settings {
  environment: Environment;
  customUrl: string;
  token: string;
  ffprobePath: string;
  mediainfoPath: string;
  /** The Pixname service (shared codes, team memory, AI matching); empty = work alone. */
  serviceUrl: string;
  /** Ask the service's AI about files the rules and team memory can't place. */
  aiMatching: boolean;
}

export const ENVIRONMENT_URLS: Record<Exclude<Environment, "custom">, string> = {
  production: "https://api.pixwel.com/api",
  staging: "https://api-staging.pixwel.com/api",
};

export const DEFAULT_SETTINGS: Settings = {
  environment: "production",
  customUrl: "",
  token: "",
  ffprobePath: "",
  mediainfoPath: "",
  serviceUrl: "",
  aiMatching: true,
};

/**
 * The Pixname service built into this copy of the app: VITE_PIXNAME_SERVICE_URL at build time
 * (.env.local for development, a GitHub Actions variable for releases).
 */
export const BUILT_IN_SERVICE_URL: string = (import.meta.env.VITE_PIXNAME_SERVICE_URL ?? "").trim();

/** The service in use: an address set in Settings wins; blank means the built-in one. */
export const serviceUrlOf = (settings: Settings) => settings.serviceUrl.trim() || BUILT_IN_SERVICE_URL;

export function baseUrl(settings: Settings): string {
  return settings.environment === "custom"
    ? settings.customUrl
    : ENVIRONMENT_URLS[settings.environment];
}

let store: Promise<Store> | null = null;
const getStore = () => (store ??= load("settings.json", { autoSave: false, defaults: {} }));

export async function loadSettings(): Promise<Settings> {
  const s = await getStore();
  const saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set("settings", settings);
  await s.save();
}

/** Vendor codes ("STF") confirmed by renames, mapped to project ids. Kept per API environment. */
export type Aliases = Record<string, string>;

const aliasKey = (settings: Settings) => `aliases:${baseUrl(settings)}`;

export async function loadAliases(settings: Settings): Promise<Aliases> {
  const s = await getStore();
  return (await s.get<Aliases>(aliasKey(settings))) ?? {};
}

export async function saveAliases(settings: Settings, aliases: Aliases): Promise<void> {
  const s = await getStore();
  await s.set(aliasKey(settings), aliases);
  await s.save();
}

/** Assets a team expects but Pixwel doesn't have yet, by project id (lib/expected). Kept per API environment. */
export type ExpectedAssets = Record<string, Asset[]>;

const expectedKey = (settings: Settings) => `expected:${baseUrl(settings)}`;

export async function loadExpected(settings: Settings): Promise<ExpectedAssets> {
  const s = await getStore();
  return (await s.get<ExpectedAssets>(expectedKey(settings))) ?? {};
}

export async function saveExpected(settings: Settings, expected: ExpectedAssets): Promise<void> {
  const s = await getStore();
  await s.set(expectedKey(settings), expected);
  await s.save();
}
