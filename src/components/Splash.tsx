import { useEffect, useState } from "react";

/** How long the splash holds before fading, and how long the fade takes (matches .splash.leaving). */
const HOLD_MS = 1800;
const FADE_MS = 600;

/** The full PIXWEL wordmark, from the platform (docs/logo/dark.svg). The X is two searchlight beams. */
function PixwelWordmark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 500 150" role="img" aria-label="Pixwel">
      <defs>
        <linearGradient id="wordmark_beam_r" gradientUnits="userSpaceOnUse" x1="2391.554" y1="-305.371" x2="2391.554" y2="-443.511" gradientTransform="matrix(-1 0 0 1 2587.054 450)">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wordmark_beam_l" gradientUnits="userSpaceOnUse" x1="135.3" y1="-351.163" x2="135.3" y2="-451.38" gradientTransform="translate(0 450)">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M129.7,148.8h-10.8L220.7,1h51.4L129.7,148.8z" fill="url(#wordmark_beam_r)" />
      <path d="M200.4,148.8h11.5L110.1,1H58.7L200.4,148.8z" fill="url(#wordmark_beam_l)" />
      <g fill="#fff">
        <path d="M23.1,119.6c-3.4,0-7.9-0.2-11.3-0.5v29.7H1V65.7c7.4-0.8,14.6-1.4,22.8-1.4c25.7,0,38.4,12.4,38.4,26.7 C62.1,107.8,47.6,119.6,23.1,119.6z M25.4,72.5c-4.6,0-10.1,0.2-13.5,0.9v37.5c3.4,0.4,8.2,0.7,12,0.7c18.6,0,26.7-9.1,26.7-19.9 C50.4,81.8,41.8,72.5,25.4,72.5z" />
        <path d="M85.5,148.8v-84h10.9v84H85.5z" />
        <path d="M305.1,148.6l-2.2,0.2l-31.6-66.4l-31,66.4l-2.2-0.2l-27.5-85.4h11l19.7,61.9l29.5-62.6h1.4l29.6,62.3 l19.5-61.6h11L305.1,148.6L305.1,148.6z" />
        <path d="M353.8,148.8v-84H412v8.3h-47.4v29h42.6v8.3h-42.6v30.3H412v8.3L353.8,148.8L353.8,148.8z" />
        <path d="M440.7,148.8v-84h10.9v75.8H499v8.3L440.7,148.8z" />
      </g>
    </svg>
  );
}

/** Startup splash: the PIXWEL wordmark under two sweeping searchlights. Click to skip. */
export function Splash() {
  const [phase, setPhase] = useState<"showing" | "leaving" | "gone">("showing");

  useEffect(() => {
    const leave = setTimeout(() => setPhase("leaving"), HOLD_MS);
    return () => clearTimeout(leave);
  }, []);

  useEffect(() => {
    if (phase !== "leaving") return;
    const gone = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(gone);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div className={`splash ${phase === "leaving" ? "leaving" : ""}`} onClick={() => setPhase("leaving")}>
      <div className="searchlight a" />
      <div className="searchlight b" />
      <div className="splash-content">
        <PixwelWordmark className="splash-wordmark" />
        <div className="splash-caption">Pixname</div>
      </div>
    </div>
  );
}
