// POST /api/activity/seen { files: [{ name, fingerprint, size, durationSec }] }
//   → { matches: [HistoryRow | null] }: files renamed before (anyone's for admins, your own otherwise).
import { body, handler, json } from "@/lib/http";
import { seen, SeenRequest } from "@/lib/resolutions";

export const POST = handler(async (request, caller) => {
  const { files } = await body(request, (v) => SeenRequest.parse(v));
  return json({ matches: await seen(caller, files) });
});
