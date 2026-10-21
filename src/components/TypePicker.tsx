import { useEffect, useMemo, useRef, useState } from "react";
import { typeToken } from "../lib/parse";
import { groupTypes } from "../lib/typeSearch";
import type { AssetType } from "../lib/types";

const tokenLabel = (t: AssetType) => (/trailer/.test(t.name) ? "no type token" : typeToken(t));

/** Search box over the asset types, the most used on top. Arrow keys move the choice; typing narrows it. */
export function TypePicker({
  types,
  value,
  onChange,
  uses,
}: {
  types: AssetType[];
  value: string;
  onChange: (name: string) => void;
  uses: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const { frequent, rest } = useMemo(() => groupTypes(types, query, uses), [types, query, uses]);
  const shown = useMemo(() => [...frequent, ...rest], [frequent, rest]);
  const active = useRef<HTMLDivElement>(null);

  // Typing keeps the choice among what's shown.
  useEffect(() => {
    if (shown.length && !shown.some((t) => t.name === value)) onChange(shown[0].name);
  }, [shown, value, onChange]);

  useEffect(() => active.current?.scrollIntoView({ block: "nearest" }), [value]);

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      const i = shown.findIndex((t) => t.name === value);
      const next = shown[Math.min(shown.length - 1, Math.max(0, i + step))];
      if (next) onChange(next.name);
    } else if (e.key === "Enter") {
      // Picks, doesn't submit the dialog half-typed.
      e.preventDefault();
    }
  }

  const option = (t: AssetType) => (
    <div
      key={t.name}
      ref={t.name === value ? active : undefined}
      role="option"
      aria-selected={t.name === value}
      className={`type-option ${t.name === value ? "active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(t.name)}
    >
      <span className="name">{t.name}</span>
      <span className="token mono">{tokenLabel(t)}</span>
    </div>
  );

  return (
    <div className="type-picker">
      <input
        className="field"
        type="search"
        placeholder="Search asset types…"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded
        aria-controls="type-options"
      />
      <div className="type-options" id="type-options" role="listbox">
        {frequent.length > 0 && <div className="type-label">Frequent</div>}
        {frequent.map(option)}
        {frequent.length > 0 && rest.length > 0 && <div className="type-label">All types</div>}
        {rest.map(option)}
        {!shown.length && <div className="type-empty muted">No asset type matches “{query}”.</div>}
      </div>
    </div>
  );
}
