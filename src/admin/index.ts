import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { AdminAuth } from "./auth.js";
import { AttemptLimiter } from "./brute-force.js";
import { AdminSessionStore } from "./sessions.js";

export interface AdminDeps {
  auth: AdminAuth;
  sessions: AdminSessionStore;
  limiter: AttemptLimiter;
}

/**
 * Registers the whole /admin area (page + API) only when the config allows it.
 * Called before the global 404 handler so that, in production without valid
 * credentials, /admin simply does not exist.
 */
export async function registerAdmin(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<AdminDeps | undefined> {
  const admin = ctx.config.admin;
  if (!admin) return undefined;

  let warned = false;
  const auth = await AdminAuth.create(admin, {
    warn: (message) => {
      if (warned) return;
      warned = true;
      app.log.warn({}, message);
    },
  });

  const deps: AdminDeps = {
    auth,
    sessions: new AdminSessionStore(ctx.clock),
    limiter: new AttemptLimiter(ctx.clock),
  };
  deps.sessions.startSweeper();
  app.addHook("onClose", async () => {
    deps.sessions.stop();
  });

  app.log.info({}, "Admin panel enabled at /admin");
  return deps;
}
