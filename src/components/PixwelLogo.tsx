/** The Pixwel mark, from the platform UI (ui/3x/constants IMAGES.pixwelSm). */
export function PixwelLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 167" role="img" aria-label="Pixwel">
      <defs>
        <linearGradient id="pixwelSm_0" gradientUnits="userSpaceOnUse" x1="2456.626" y1="-287.691" x2="2456.626" y2="-443.05" gradientTransform="matrix(-1 0 0 1 2610.478 450)">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pixwelSm_1" gradientUnits="userSpaceOnUse" x1="86.148" y1="-339.191" x2="86.148" y2="-451.9" gradientTransform="translate(0 450)">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M79.9 167H67.7L182.2.8H240L79.9 167z" fill="url(#pixwelSm_0)" />
      <path d="M159.4 167h12.9L57.8.8H0L159.4 167z" fill="url(#pixwelSm_1)" />
    </svg>
  );
}
