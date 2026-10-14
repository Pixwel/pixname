// POST /api/match { files: [{ name, dirs, durationSec, aspect, mediaType }], candidateProjectIds }
//   → { model, matches: [{ file, projectId, assetId, confidence, reason }] }
import { body, handler, json } from "@/lib/http";
import { match, MatchRequest } from "@/lib/match";
import { modelLabel } from "@/lib/model";

// The model call can take a while for a batch of files.
export const maxDuration = 120;

export const POST = handler(async (request, caller) => {
  const matches = await match(caller, await body(request, (v) => MatchRequest.parse(v)));
  return json({ model: modelLabel(), matches });
});
