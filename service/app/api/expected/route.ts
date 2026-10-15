// GET    /api/expected                               → { assets: [...] }  expected assets of projects you can see
// POST   /api/expected { projectId, type, names }   → { added }          add a pasted list
// DELETE /api/expected?projectId=…[&slug=…]         forget one, or the project's whole list
import { z } from "zod";
import { body, handler, json } from "@/lib/http";
import { AddRequest, addExpected, listExpected, removeExpected } from "@/lib/expected";

export const GET = handler(async (_request, caller) => json({ assets: await listExpected(caller) }));

export const POST = handler(async (request, caller) => {
  const added = await addExpected(caller, await body(request, (v) => AddRequest.parse(v)));
  return json({ added });
});

export const DELETE = handler(async (request, caller) => {
  const params = new URL(request.url).searchParams;
  const projectId = z.string().min(1).max(64).parse(params.get("projectId"));
  const slug = z.string().min(1).max(300).optional().parse(params.get("slug") ?? undefined);
  await removeExpected(caller, projectId, slug);
  return json({ ok: true });
});
