# RouteWise — ShellHacks 2026

One repository for both teammates: https://github.com/thatpeople3111/shellhacks-2026

The Next.js frontend lives at the repository root; the Fastify API lives in `backend/`. The frontend now has `/api/suggest-stops` and `/api/plan-trip` server routes and a working `/backend-check` page for the complete optional-stop flow. The home page remains available for the frontend teammate's design.

**Start here: [step-by-step guide and frontend contract](FLOW_GUIDE.md).** On this Windows computer, run `./Start-RouteWise.cmd` from the repository root, then open http://localhost:3000/backend-check. It starts both servers and reuses existing RouteWise instances.

## First-time setup (both people)

Use Node.js 24. Clone once, then open the folder in VS Code:

```sh
git clone https://github.com/thatpeople3111/shellhacks-2026.git
cd shellhacks-2026
npm ci
npx --yes pnpm@11.25.0 --dir backend install --frozen-lockfile
npm run dev:all
```

Frontend flow check: http://localhost:3000/backend-check

For a separate backend-only terminal instead of the combined launcher:

```powershell
cd backend
npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile
npx.cmd --yes pnpm@11.25.0 dev
```

Follow `backend/README.md` for backend prerequisites and alternate start commands. Backend: http://localhost:3001; interactive docs: http://localhost:3001/docs/.
Demo mode does not require Google or Gemini keys.

## Shared files

- `src/app/`: Next.js pages and layouts.
- `src/components/`: reusable UI.
- `src/lib/types.ts`: frontend import location for `TripRequest`, `TripPlan`, and stop types.
- `backend/shared/flow-contracts.ts`: flat request and card response schemas for the new flow.
- `backend/shared/contracts.ts`: provider and legacy `/api/v1` schemas.
- `src/data/demo.ts`: sample input matching that contract.
- `src/lib/routewise.ts`: typed frontend helpers for the new flow.
- `backend/client/routewise.ts`: legacy `/api/v1` client.
- `backend/docs/FRONTEND.md`: integration and rendering requirements.

Use `import type { TripRequest, TripPlan } from "@/lib/types"` in frontend code.
Agree together before changing shared contracts. Do not create incompatible duplicate request types.

## Branches and collaboration

`main` is the combined baseline. Use `frontend` for frontend work and `backend` for backend work. The original `codex/routewise-backend` branch remains intact.

After cloning, the frontend developer runs `git switch frontend`; coleberger runs `git switch backend`.
Before each work session, with a clean working tree:

```sh
git fetch origin
git merge origin/main
```

Review `git status` and `git diff`, stage only intended files, commit, and push your own branch. Open a pull request into `main` and ask the other person to review. After merging, both people fetch and merge `origin/main` again. Coordinate overlapping edits and never force-push over each other's work.

## Keys

Root `.env*` files and nested environment files are ignored; only empty `.env.example` templates are tracked. If needed, copy the root template to `.env.local` and the backend template to `backend/.env`, then fill values locally. Never commit real keys or share them in chat. Keep API_ACCESS_TOKEN and provider secrets on the server, never in NEXT_PUBLIC_ variables. No credentials are required for the starter/demo.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

Backend checks are separate; see `backend/README.md`. The frontend build downloads Google fonts and may need internet access.

GitHub access: coleberger already has collaborator access. If sign-in expires, run `gh auth login --hostname github.com --web` yourself; do not paste tokens into chat.

Next.js reference: https://nextjs.org/docs/app/getting-started/installation
