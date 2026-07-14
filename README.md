# TraceFix

**Standalone AI debugging agent** with login, dashboard analytics, and a live 9-step pipeline.

> Not a chat app. TraceFix runs the project, reads live browser evidence, finds a root cause, applies a fix on a branch, runs tests, and confirms whether the issue is resolved.

Path: `d:\AI Agents Projects\tracefix`

---

## Product surface

- **Sign up / Sign in** — cookie sessions
- **Dashboard** — KPIs, weekly volume chart, verify outcome donut, recent activity, what got fixed
- **New debug** — launch the agent against a local project path
- **Sessions** — history + live timeline for each run

---

## Agent pipeline (9 steps)

1. Run the app  
2. Read browser console  
3. Read network logs  
4. Read Git history  
5. Find the root cause  
6. Suggest a fix  
7. Apply the fix in a branch  
8. Run tests  
9. Confirm the issue is resolved  

---

## Quick start

```bash
cd "d:\AI Agents Projects\tracefix"
copy .env.example .env
pnpm install
pnpm install:browsers
pnpm dev
```

- Web: http://localhost:3100  
- API: http://localhost:4100  

1. Create an account  
2. Open **Dashboard**  
3. **New debug** → local project path + error  
4. Watch the session timeline  

Optional: set `LLM_PROVIDER=huggingface` (or `openai`) with the matching API key for real file patches.

### GitHub mode (clone → fix → PR)

1. Copy `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` from DevMate (already wired for local).
2. In the GitHub OAuth App settings, add callback:
   `http://localhost:4100/auth/github/callback`
3. Sign in to TraceFix → **New debug** → **Connect GitHub** → pick a repo → run.
4. TraceFix clones into a sandbox, diagnoses, pushes `tracefix/fix-…`, and can open a PR.

Local path mode still works for offline demos.

---

## Stack

| Piece | Tech |
|-------|------|
| API | Express + cookie-session + bcrypt |
| DB | **MongoDB** (Mongoose) — users, session history, analytics |
| UI | Next.js agent dashboard |
| Agent | Playwright + git + diagnose/verify |

### MongoDB

```bash
cd "d:\AI Agents Projects\tracefix"
docker compose up -d
```

Default URI: `mongodb://127.0.0.1:27017/tracefix` (set in `.env` as `MONGODB_URI`).

Collections:
- `users` — signup / login
- `debugsessions` — every agent run, steps, diagnosis, verify, branch

---

## One-liner

**TraceFix is a debugging agent workspace: authenticate, launch runs, and see what broke, what fixed, and what still failed — with charts and a live evidence timeline.**
