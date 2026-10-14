// GET /api/rules/suggestions?days=90  (admins) → { suggestions: [{ kind, key, projectId, assetId, files, share, examples }] }
import { handler, json } from "@/lib/http";
import { suggestions } from "@/lib/rules";

export const GET = handler(async (request, caller) => {
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 90));
  return json({ suggestions: await suggestions(caller, days) });
});
