// POST /api/resolutions/lookup { names: [...] }
//   → { matches: [{ name, projectId, assetId, similarity, votes, people, example } | null] }
//   How the team resolved the most similar earlier files.
import { body, handler, json } from "@/lib/http";
import { lookup, LookupRequest } from "@/lib/resolutions";

export const POST = handler(async (request, caller) => {
  const { names } = await body(request, (v) => LookupRequest.parse(v));
  return json({ matches: await lookup(caller, names) });
});
