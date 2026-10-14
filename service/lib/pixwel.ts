// Talking to the Pixwel API with the caller's own token, so the service only ever sees what they can.
import { createHash } from "node:crypto";

/** Only these hosts get a caller's token: never a URL the caller supplies. */
export const ENVIRONMENTS = {
  production: "https://api.pixwel.com/api",
  staging: "https://api-staging.pixwel.com/api",
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

export interface Caller {
  env: Environment;
  token: string;
  userId: string;
  /** Display name for activity views ("Jeff Loiselle"); falls back to username or email. */
  userName: string;
  /** Pixwel admins (a group of type "a") see everyone's activity and manage team rules. */
  isAdmin: boolean;
}

/** Same test as the platform's Users::is($user, Groups::ADMIN). */
export const isAdminSession = (session: { roles?: unknown; groups?: unknown }) =>
  (Array.isArray(session.roles) && session.roles.includes("a")) ||
  (Array.isArray(session.groups) && session.groups.some((g) => (g as { type?: string })?.type === "a"));

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function environmentOf(value: string | null | undefined): Environment {
  if (value === "production" || value === "staging") return value;
  throw new HttpError(400, "Unknown environment: use production or staging");
}

export async function pixwelGet<T>(caller: Pick<Caller, "env" | "token">, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${ENVIRONMENTS[caller.env]}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${caller.token}`, Accept: "application/json", "User-Agent": "pixname-service" },
  });
  if (response.status === 401 || response.status === 403) throw new HttpError(401, "Pixwel rejected the token");
  if (!response.ok) throw new HttpError(502, `Pixwel ${path} returned ${response.status}`);
  const body = (await response.json()) as unknown;
  // Some endpoints wrap lists; normalise to the bare payload (as the app does).
  return (body && typeof body === "object" && !Array.isArray(body) && "data" in body ? (body as { data: T }).data : body) as T;
}

/** Recent token checks, keyed by a hash of the token (the token itself is never kept). */
const verified = new Map<string, { userId: string; userName: string; isAdmin: boolean; expires: number }>();
const VERIFY_TTL_MS = 5 * 60 * 1000;

/** Who is calling: a Pixwel token is valid if Pixwel's /session accepts it. */
export async function authenticate(request: Request): Promise<Caller> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+((?:pat|svc)_\S+)$/i.exec(header)?.[1];
  if (!token) throw new HttpError(401, "Send a Pixwel token: Authorization: Bearer pat_… or svc_…");
  const env = environmentOf(request.headers.get("x-pixwel-env") ?? "production");

  const key = createHash("sha256").update(`${env}:${token}`).digest("hex");
  const cached = verified.get(key);
  if (cached && cached.expires > Date.now()) {
    return { env, token, userId: cached.userId, userName: cached.userName, isAdmin: cached.isAdmin };
  }

  const session = await pixwelGet<{
    _id?: string;
    id?: string;
    name?: string;
    username?: string;
    emailNormal?: string;
    roles?: unknown;
    groups?: unknown;
  }>(
    { env, token },
    "session",
  );
  const userId = session._id ?? session.id;
  if (!userId) throw new HttpError(401, "Pixwel didn't recognise the token");
  const userName = session.name?.trim() || session.username?.trim() || session.emailNormal?.trim() || "Unknown";
  const isAdmin = isAdminSession(session);
  verified.set(key, { userId, userName, isAdmin, expires: Date.now() + VERIFY_TTL_MS });
  return { env, token, userId, userName, isAdmin };
}

/** For admin-only actions. */
export function requireAdmin(caller: Caller) {
  if (!caller.isAdmin) throw new HttpError(403, "Only Pixwel admins can do this");
}
