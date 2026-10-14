// The service is used by the Pixname desktop app; this page only says what it is.
import { aiAvailable, modelLabel } from "@/lib/model";

// Reflect PIXNAME_AI / PIXNAME_MODEL as currently set, not as they were at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  const ai = aiAvailable();
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 16px", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 24 }}>Pixname service</h1>
      <p style={{ color: "#9c9d9e" }}>
        Shared vendor codes and AI matching for the Pixname desktop app. Requests authenticate with a Pixwel token.
      </p>
      <ul style={{ color: "#9c9d9e" }}>
        <li>AI matching: {ai ? `on (${modelLabel()})` : "off"}</li>
        <li>
          <code>GET /api/health</code>, <code>/api/codes</code>, <code>POST /api/match</code>
        </li>
      </ul>
    </main>
  );
}
