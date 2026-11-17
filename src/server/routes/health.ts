import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";

export const healthRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", db: "ok" };
    } catch (err) {
      app.log.error({ err }, "health check: database unreachable");
      return reply.code(503).send({ status: "error", db: "unreachable" });
    }
  });
};
