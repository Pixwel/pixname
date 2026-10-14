// Vendor codes ("STF", "PP3") the team has confirmed for projects by renaming files.
// Each confirmation is a vote; the app weighs a code by how consistently it points at one project.
import { z } from "zod";
import { database } from "./db";
import { requireAdmin, type Caller } from "./pixwel";

/** Same shape the app extracts: 2–6 capitals/digits. All-digit codes are sequence numbers, not vendors. */
export const isVendorCode = (code: string) => /^[A-Z0-9]{2,6}$/.test(code) && !/^\d+$/.test(code);

/** Sequence numbers and other non-codes in a batch are skipped, not fatal: the rest still count. */
export const VoteRequest = z.object({
  votes: z
    .array(z.object({ code: z.string().max(16), projectId: z.string().min(1).max(64) }))
    .min(1)
    .max(200)
    .transform((votes) => votes.filter((v) => isVendorCode(v.code))),
});

export const EditRequest = z.object({
  code: z.string().refine(isVendorCode, "not a vendor code"),
  /** Point the code at this project instead (team-wide). */
  projectId: z.string().min(1).max(64),
});

export const ForgetRequest = z.object({
  code: z.string().min(1).max(6),
  /** Forget only this project's votes for the code; all of them when omitted. */
  projectId: z.string().min(1).max(64).optional(),
});

export interface CodeProject {
  projectId: string;
  /** Confirmations across everyone. */
  votes: number;
  /** How many different people confirmed it. */
  people: number;
  updatedAt: number;
}

export async function listCodes(caller: Caller): Promise<Record<string, CodeProject[]>> {
  const db = await database();
  const { rows } = await db.execute({
    sql: `SELECT code, project_id, SUM(count) AS votes, COUNT(DISTINCT user_id) AS people, MAX(updated_at) AS updated_at
          FROM code_votes WHERE env = ? AND count > 0
          GROUP BY code, project_id ORDER BY code, votes DESC`,
    args: [caller.env],
  });
  const codes: Record<string, CodeProject[]> = {};
  for (const row of rows) {
    (codes[String(row.code)] ??= []).push({
      projectId: String(row.project_id),
      votes: Number(row.votes),
      people: Number(row.people),
      updatedAt: Number(row.updated_at),
    });
  }
  return codes;
}

export async function addVotes(caller: Caller, votes: z.infer<typeof VoteRequest>["votes"]) {
  if (!votes.length) return;
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  await db.batch(
    votes.map(({ code, projectId }) => ({
      sql: `INSERT INTO code_votes (env, code, project_id, user_id, count, updated_at) VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT (env, code, project_id, user_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
      args: [caller.env, code, projectId, caller.userId, now],
    })),
    "write",
  );
}

/** Correct a code by hand: it now means `projectId` for everyone, and earlier votes elsewhere are dropped. */
export async function editCode(caller: Caller, { code, projectId }: z.infer<typeof EditRequest>) {
  requireAdmin(caller);
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  await db.batch(
    [
      { sql: `DELETE FROM code_votes WHERE env = ? AND code = ? AND project_id != ?`, args: [caller.env, code, projectId] },
      {
        sql: `INSERT INTO code_votes (env, code, project_id, user_id, count, updated_at) VALUES (?, ?, ?, ?, 1, ?)
              ON CONFLICT (env, code, project_id, user_id) DO UPDATE SET count = MAX(count, 1), updated_at = excluded.updated_at`,
        args: [caller.env, code, projectId, caller.userId, now],
      },
    ],
    "write",
  );
}

export async function forgetCode(caller: Caller, { code, projectId }: z.infer<typeof ForgetRequest>) {
  requireAdmin(caller);
  const db = await database();
  await db.execute(
    projectId
      ? { sql: `DELETE FROM code_votes WHERE env = ? AND code = ? AND project_id = ?`, args: [caller.env, code, projectId] }
      : { sql: `DELETE FROM code_votes WHERE env = ? AND code = ?`, args: [caller.env, code] },
  );
}
