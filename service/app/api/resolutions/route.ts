// POST /api/resolutions { resolutions: [{ name, dirs, projectId, assetId, source, guess }] }
//   Sent after a rename: what each file was, where it went, and what Pixname had guessed.
import { body, handler, json } from "@/lib/http";
import { recordResolutions, RecordRequest } from "@/lib/resolutions";

export const POST = handler(async (request, caller) => {
  const { resolutions } = await body(request, (v) => RecordRequest.parse(v));
  await recordResolutions(caller, resolutions);
  return json({ ok: true, recorded: resolutions.length });
});
