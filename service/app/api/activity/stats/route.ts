// GET /api/activity/stats?days=30  Totals per day, person, project and source; the team's for admins.
import { handler, json } from "@/lib/http";
import { stats } from "@/lib/resolutions";

export const GET = handler(async (request, caller) => {
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  return json(await stats(caller, days));
});
