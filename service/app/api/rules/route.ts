// GET    /api/rules                                  → { rules: [...] }  (everyone: used for matching)
// POST   /api/rules { phrase, projectId, assetId }   admins: "files named like this are this asset"
// DELETE /api/rules?id=…                            admins
import { z } from "zod";
import { body, handler, json } from "@/lib/http";
import { addRule, deleteRule, listRules, RuleRequest } from "@/lib/rules";

export const GET = handler(async (_request, caller) => json({ rules: await listRules(caller) }));

export const POST = handler(async (request, caller) => {
  await addRule(caller, await body(request, (v) => RuleRequest.parse(v)));
  return json({ ok: true });
});

export const DELETE = handler(async (request, caller) => {
  const id = z.coerce.number().int().positive().parse(new URL(request.url).searchParams.get("id"));
  await deleteRule(caller, id);
  return json({ ok: true });
});
