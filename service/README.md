# Pixname service

A small Next.js app on Vercel that the Pixname desktop app can use for:

- **Shared vendor codes**: when someone renames `STF_…` files into Street Fighter, that's a vote for
  `STF → Street Fighter`. Everyone's app sees the counts, so a code confirmed by many people for one
  project becomes a strong clue, and a vendor's own code used across projects (`FH`) stays weak.
- **Team memory**: every rename records what each file was, where it went, how it was matched, and what
  Pixname had guessed. Similar files later get the team's answer before any AI is asked, and the misses
  (`GET /api/resolutions/insights`) show where the rules need work, so AI is needed less over time.
- **AI matching** (optional): files the app can't place confidently are sent with the project list and
  the likely projects' assets to a model, which suggests a project and asset for each.

Callers authenticate with their own Pixwel token (`Authorization: Bearer pat_…|svc_…`, plus
`X-Pixwel-Env: production|staging`). The service checks it against Pixwel's `GET /session` and
fetches projects/assets with that same token, so it never sees more than the caller can.
Tokens are only ever sent to the two Pixwel API hosts and are never stored.

Route handlers live in `app/api/*/route.ts`; the logic is in `lib/` (Pixwel auth, Turso, matching).

## Endpoints

| | |
|---|---|
| `GET /api/health` | Checks the token; reports whether AI matching is on and which model |
| `GET /api/codes` | `{ codes: { STF: [{ projectId, votes, people, updatedAt }] } }` |
| `POST /api/codes` | `{ votes: [{ code, projectId }] }`, sent after a rename |
| `PUT /api/codes` | `{ code, projectId }`: correct a code for everyone |
| `DELETE /api/codes` | `{ code, projectId? }`: forget a code |
| `POST /api/resolutions` | `{ resolutions: [{ name, dirs, projectId, assetId, source, guess }] }`, sent after a rename |
| `POST /api/resolutions/lookup` | `{ names }` → the team's answer for the most similar earlier file, per name |
| `GET /api/resolutions/insights?days=30` | How files were resolved, how often AI suggestions were kept, recent misses |
| `POST /api/match` | `{ files: [{ name, dirs, durationSec, aspect, mediaType }], candidateProjectIds }` → `{ matches: [{ file, projectId, assetId, confidence, reason }] }` |

## Deploying (once)

1. In the Pixwel Vercel team, import this repo as a new project with **Root Directory** `service`
   (Vercel detects Next.js).
2. Add **Turso** from the Vercel Marketplace (Storage → Create → Turso) and connect it to the project.
   It provides `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; tables are created on first request.
3. AI matching: either
   - set `ANTHROPIC_API_KEY` to call Anthropic directly, or
   - leave it unset to use the Vercel AI Gateway, which authenticates deployments on its own
     (enable AI Gateway for the team if it isn't already).

All variables are listed in [`.env.example`](.env.example); `PIXNAME_MODEL` picks the model
(default `claude-sonnet-5-5`; `claude-opus-5-5` is more accurate, `claude-haiku-5-5` cheaper) and `PIXNAME_AI=off` turns AI matching off.

After that, every push to `main` deploys.

## Developing

```bash
npm install
npm test        # in-memory database, no network
cp .env.example .env.local   # then fill in what you need (e.g. ANTHROPIC_API_KEY)
npm run dev     # http://localhost:3000; uses ./pixname-local.db unless TURSO_* are set
npm run build   # what Vercel runs
```
