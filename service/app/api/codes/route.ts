// GET    /api/codes                       → { codes: { STF: [{ projectId, votes, people, updatedAt }] } }
// POST   /api/codes { votes: [{ code, projectId }] }   record confirmations from a rename
// PUT    /api/codes { code, projectId }   correct a code for everyone
// DELETE /api/codes { code, projectId? }  forget a code (or one project's votes for it)
import { addVotes, EditRequest, editCode, ForgetRequest, forgetCode, listCodes, VoteRequest } from "@/lib/codes";
import { body, handler, json } from "@/lib/http";

export const GET = handler(async (_request, caller) => json({ codes: await listCodes(caller) }));

export const POST = handler(async (request, caller) => {
  const { votes } = await body(request, (v) => VoteRequest.parse(v));
  await addVotes(caller, votes);
  return json({ ok: true });
});

export const PUT = handler(async (request, caller) => {
  await editCode(caller, await body(request, (v) => EditRequest.parse(v)));
  return json({ ok: true });
});

export const DELETE = handler(async (request, caller) => {
  await forgetCode(caller, await body(request, (v) => ForgetRequest.parse(v)));
  return json({ ok: true });
});
