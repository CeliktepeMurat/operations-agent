# Later

Ideas that are out of scope for the current 6-week plan. Revisit after week 6.

## Microservices (after week 6, January)

The project is a modular monolith on purpose: one deployable, with clean module boundaries (`api/`, `agent/`, `permissions/`, `rag/`). Splitting it into services doesn't change the eval results, so it waits until the core is done.

Plan:

1. **Extract a payments service** — a separate Fastify app with its own table, behind the existing payment interface. Pairs with the optional x402 phase.
2. **Extract an orders service** — HTTP in front of the existing `src/api/orders.ts` functions.
3. **Re-run the full eval suite** to show the split didn't weaken the permission layer.

What to practice along the way: service-to-service auth, timeouts and retries, idempotency, tracing across services, data consistency across databases.

## Small items

- **Migration lock** — use a Postgres advisory lock in the migration runner so two deploys can't migrate at the same time (week 5, deployment).
- **Bind dev server to localhost** — add a `HOST` setting; `0.0.0.0` exposes the dev server to the local network (week 5).
