# CLAUDE.md

## Project

A customer-support agent for a **fake e-commerce company** that performs real actions (order lookup, address change, cancel, refund, coupon) — but every write goes through a **permission layer** the model cannot bypass.

Thesis: *the model can be tricked, so the boundary must live in code the model can't touch — and we prove it by measurement.*

This is a portfolio project. The owner (Murat) is a TypeScript backend developer moving into AI/agent engineering. **His understanding of the code matters more than speed.**

## Stack

- Node (current LTS) + TypeScript, strict mode, ESM
- Fastify for the HTTP API
- PostgreSQL + pgvector (via `docker compose`)
- Plain SQL with the `pg` driver; migrations as numbered `.sql` files in `db/migrations/`
- zod for validation and tool input schemas
- Vitest for tests
- Model provider: **TBD** — use the provider's official SDK directly. **No agent frameworks** (LangChain, LangGraph, etc.) unless Murat asks.

## Architecture (target)

```
src/
  config/       # env loading + validation (zod)
  db/           # pg pool, migration runner
  server/       # Fastify app (buildApp), entry point, routes/
  testing/      # shared test helpers (throwaway DB schema)
  api/          # company backend: customers, orders, payments, refunds
  agent/        # agent loop, tool definitions, prompts
  permissions/  # permission layer: rules, approval queue, audit log
  rag/          # policy docs chunking, embeddings, search_policy
db/
  migrations/   # numbered .sql files
  seed/         # deterministic fake data: 50 customers, 200 orders
evals/          # scenarios + runner (results judged by DB state, not text)
docs/           # policy documents, notes, write-up
```

Design decisions:
- `src/api/` functions are plain data access with **no access control** (e.g. `getOrder` returns any order). Ownership and all other rules live only in `src/permissions/`, so the eval can compare "no protection" vs "permission layer".
- Tools call `src/api/` as in-process functions, not over HTTP. HTTP routes, if needed, wrap the same functions.

Conventions: tests sit next to the code (`x.test.ts`); CLI entry points are `*.cli.ts`; comments are short and only for non-obvious decisions — explanations go in the chat, not the code.

Invariants — never violate these:
1. The agent **never** calls the DB or payment code directly. Every action goes: agent → tool → permission layer → API.
2. **Customer identity comes from the session**, never from model output or user text.
3. Every action request, decision, and reason is written to the audit log.
4. Payment operations sit behind a single interface (so a future x402 module can replace it).

## How to work with Murat

You write the code; Murat reviews it and must be able to understand every line. Optimize for reviewability:
- Keep changes small and focused; one concern per change, so each diff is easy to review.
- After writing, briefly explain *what* you did and *why* (key decisions, trade-offs, alternatives rejected).
- **Core parts — agent loop (`src/agent/loop.ts`) and permission rules (`src/permissions/`):** explain in more depth. Walk through the control flow step by step, point out edge cases (when the loop stops, failure paths, what is trusted vs. untrusted), and keep these files especially readable with comments on non-obvious decisions.
- Prefer simple, readable code over clever code. No unnecessary abstractions.
- Don't add dependencies without saying why.

**Always:**
- Ask before changing the stack, the folder structure, or the invariants above.
- If a task is ambiguous, ask one question instead of guessing.
- Write or update tests for anything with logic.
- Don't polish the UI; the backend is what gets evaluated.

## Commands

Node 24 (`.nvmrc`). Copy `.env.example` to `.env` first.
- `docker compose up -d` — start Postgres + pgvector (host port **5433**; Docker Desktop must be running)
- `docker compose down -v` — stop and delete all DB data (clean slate)
- `npm run db:migrate` — apply pending `db/migrations/*.sql`
- `npm run db:seed` — wipe + reseed deterministic fake data (refuses non-local DBs without `--force`)
- `npm run dev` — run API with auto-restart on file changes (port 3000, `GET /health`)
- `npm start` — run API without watch
- `npm test` — run tests (DB tests need Docker running; each uses a throwaway schema)
- `npm run typecheck` — TypeScript check, no output
- `npm run eval` — run eval suite (not yet)

## Scope rule

New ideas go in `docs/LATER.md`, not into the current task.
