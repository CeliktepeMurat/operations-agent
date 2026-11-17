import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { healthRoutes } from "./routes/health.js";

export type AppDeps = {
  pool: pg.Pool;
  logger?: boolean;
};

/** Builds the app without listening, so tests can use app.inject(). */
export function buildApp({ pool, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });

  app.register(healthRoutes, { pool });

  return app;
}
