// GET /api/conventions                              → { conventions: [{ scope, targetId, values, updatedBy, at }] }
// PUT /api/conventions { scope, targetId, values }  admins: set a studio's or project's house style ({} clears it)
import { body, handler, json } from "@/lib/http";
import { listConventions, SetRequest, setConventions } from "@/lib/conventions";

export const GET = handler(async (_request, caller) => json({ conventions: await listConventions(caller) }));

export const PUT = handler(async (request, caller) => {
  await setConventions(caller, await body(request, (v) => SetRequest.parse(v)));
  return json({ ok: true });
});
