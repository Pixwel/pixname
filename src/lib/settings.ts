import { load, type Store } from "@tauri-apps/plugin-store";

export type Environment = "production" | "staging" | "custom";

export interface Settings {
  environment: Environment;
  customUrl: string;
  token: string;
  ffprobePath: string;
  mediainfoPath: string;
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
};

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
