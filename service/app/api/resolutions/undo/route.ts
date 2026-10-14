// POST /api/resolutions/undo { renames: [{ name, newName }] }
//   Sent after an undo: those renames stop counting (stats, team memory, code votes) but stay in history.
import { body, handler, json } from "@/lib/http";
import { UndoRequest, undoRenames } from "@/lib/resolutions";

export const POST = handler(async (request, caller) => {
  const { renames } = await body(request, (v) => UndoRequest.parse(v));
  return json({ ok: true, undone: await undoRenames(caller, renames) });
});
