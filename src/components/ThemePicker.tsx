import { useEffect, useRef, useState } from "react";
import { applyTheme, getTheme, THEMES } from "../theme";

/** Theme menu, like the platform's ThemeSwitcher: a swatch per theme, saved per machine. */
export function ThemePicker() {
  const [active, setActive] = useState(getTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const current = THEMES.find((t) => t.id === active) ?? THEMES[0];
  return (
    <div className="theme-picker" ref={ref}>
      <button className="btn" onClick={() => setOpen((v) => !v)} aria-label="Switch theme" aria-expanded={open}>
        <span className="swatch" style={{ background: current.swatch }} />
        Theme
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          <p className="theme-menu-label">Theme</p>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              role="menuitemradio"
              aria-checked={theme.id === active}
              className={`theme-option ${theme.id === active ? "active" : ""}`}
              onClick={() => {
                applyTheme(theme.id);
                setActive(theme.id);
                setOpen(false);
              }}
            >
              <span className="swatch" style={{ background: theme.swatch }} />
              {theme.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
