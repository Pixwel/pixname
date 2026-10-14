// The platform's theme choices (Pixwel/platform new-shadcn: ui/3x/modules/components/global/theme-switcher).
// Same ids, labels, swatches and storage key, so the CSS in theme.css applies unchanged.

export interface Theme {
  id: string;
  label: string;
  swatch: string;
}

export const THEMES: Theme[] = [
  { id: "midnight", label: "Noir", swatch: "#265bad" },
  { id: "aurora", label: "Jade Reel", swatch: "#18a080" },
  { id: "ember", label: "Technicolor", swatch: "#e07012" },
  { id: "neon", label: "Ultraviolet", swatch: "#8b2cf5" },
  { id: "solstice", label: "Cyan Scope", swatch: "#0fc7e6" },
  { id: "verdigris", label: "Patina", swatch: "#26a18f" },
  { id: "sepia", label: "Sepia Print", swatch: "#b8893c" },
  { id: "ruby", label: "Red Carpet", swatch: "#c43a4f" },
  { id: "liquid-glass", label: "Glass Plate", swatch: "#7dd9ff" },
  {
    id: "rainbow",
    label: "Prism Reel",
    swatch: "linear-gradient(90deg, #ff5f6d 0%, #ffc371 20%, #ffe66d 40%, #4ade80 60%, #60a5fa 80%, #c084fc 100%)",
  },
  { id: "contrast", label: "Silver Screen", swatch: "#ffffff" },
];

const STORAGE_KEY = "px-theme";
const DEFAULT_THEME = "neon"; // Ultraviolet

export function getTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((t) => t.id === saved) ? saved! : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(id: string) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A missing preference only means the default theme next time.
  }
}
