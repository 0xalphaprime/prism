<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Prism is a single Next.js 16 app (npm). Standard install/run/lint commands and env placeholders are in [`README.md`](README.md) and [`.env.example`](.env.example).

### Non-obvious caveats

- **Port is 3001**, not 3000 (`npm run dev` / `npm start` bind `0.0.0.0:3001`).
- **No test script** in `package.json` — there is no automated unit/e2e suite yet. Use `npm run lint`, `npm run build`, and manual UI checks.
- **`npm run lint` / `npm run build` currently fail on pre-existing code issues** (as of the merged PR #1 baseline): ESLint `react-hooks/set-state-in-effect` in `src/components/inspector/node-workspace.tsx`, and a TypeScript `onClick` typing error in `src/components/run/run-bar.tsx`. Dev mode (`npm run dev`) still serves the app.
- **Provider API keys are optional for UI/graph work** (canvas, Add tile, Expand workspace, architectures, checkpoints). Keys in `.env.local` are required only for Connections verify / `/api/providers?probe=1` / `/api/chat`. No secrets are baked into the Cloud VM by default.
- **Graph state lives in browser `localStorage`** (`prism.library.v3`) — no database or Docker services to start.
- After `next dev`, Next may rewrite the agent-rules block at the top of this file; keep the Cursor Cloud section below it when reconciling diffs.
