// GET /api/activity/history?q=&userId=&projectId=&source=&missedOnly=&before=&limit=
//   Renames, newest first. Admins see everyone's; everyone else their own.
import { handler, json } from "@/lib/http";
import { history, HistoryQuery } from "@/lib/resolutions";
import { HttpError } from "@/lib/pixwel";

export const GET = handler(async (request, caller) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = HistoryQuery.safeParse(params);
  if (!parsed.success) throw new HttpError(400, "Invalid history query");
  return json(await history(caller, parsed.data));
});
