// GET /api/resolutions/insights?days=30
//   How files were resolved (rules / team / AI / by hand), how often AI suggestions were kept,
//   and recent misses: the list to improve the rules from.
import { handler, json } from "@/lib/http";
import { insights } from "@/lib/resolutions";

export const GET = handler(async (request, caller) => {
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  return json(await insights(caller, days));
});
