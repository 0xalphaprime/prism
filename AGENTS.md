<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Private data — this repo is public

Never write real company data into a tracked file: rep, customer, hospital or account names, account numbers, deal status, pricing, or eval cards built from real conversations.

- Real eval sets live in `data/eval/private/` (git-ignored). Public examples use the fictional sample set `data/eval/sample-leftovers.v1.json` (Kestrel Surgical; every name invented).
- Tests that quote real cards go in `*.private.test.ts` (git-ignored).
- Company identity comes from `.env.local` (`PRISM_ORG_NAME`, `PRISM_STUDENT_SEED_ID`), never from code or docs.
- If a task brief, plan or pasted transcript contains real names, swap in fictional ones before writing anything to a tracked file.
- Details: `docs/GUIDE.md` → Private data. The local pre-commit hook (`.private-terms`) is a backstop, not a substitute — cloud agents don't have the terms file.
