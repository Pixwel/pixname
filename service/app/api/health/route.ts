// GET /api/health → what this deployment offers; the app uses it to test the service URL.
import { handler, json } from "@/lib/http";
import { aiAvailable, modelLabel } from "@/lib/model";

export const GET = handler(async (_request, caller) =>
  json({
    ok: true,
    env: caller.env,
    ai: aiAvailable(),
    model: modelLabel(),
    user: { id: caller.userId, name: caller.userName, isAdmin: caller.isAdmin },
  }),
);
