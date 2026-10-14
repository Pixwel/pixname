import { z } from "zod";
import { authenticate, HttpError, type Caller } from "./pixwel";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Authenticate, run the handler, and turn errors into JSON responses. */
export function handler(fn: (request: Request, caller: Caller) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await fn(request, await authenticate(request));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}

export async function body<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
  try {
    return parse(value);
  } catch (e) {
    const detail = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e);
    throw new HttpError(400, `Invalid request: ${detail}`);
  }
}
