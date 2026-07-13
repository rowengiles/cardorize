import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { config } from "./config.js";
import { attachUser, registerAuthRoutes } from "./auth.js";
import { registerDeckRoutes } from "./routes/decks.js";
import { registerStudyRoutes } from "./routes/study.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSocialRoutes } from "./routes/social.js";
import { rateLimit } from "./ratelimit.js";

const app = Fastify({
  logger: { level: config.isProd ? "info" : "warn" },
  bodyLimit: 256 * 1024, // JSON bodies; uploads go through multipart with its own limit
  trustProxy: true, // NGINX in front
});

await app.register(cookie);
await app.register(multipart, {
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  attachFieldsToBody: false,
});

// Session resolution on every request.
app.addHook("onRequest", attachUser);

// CSRF hardening: mutating requests must come from our own origin (SameSite
// cookies are the first line; this closes the gap for older browsers).
app.addHook("preHandler", async (req, reply) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.origin;
  if (!origin) return; // non-browser clients (mobile/bearer) send no Origin
  try {
    const o = new URL(origin);
    const sameHost = o.host === req.headers.host;
    const devHost = !config.isProd && ["localhost", "127.0.0.1"].includes(o.hostname);
    if (!sameHost && !devHost) {
      return reply.code(403).send({ error: "Cross-origin request rejected" });
    }
  } catch {
    return reply.code(403).send({ error: "Invalid Origin" });
  }
});

// Baseline security headers on every response.
app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  reply.header("Cache-Control", "no-store");
});

// General per-IP/user request budget (tighter buckets guard auth + AI routes).
app.addHook("preHandler", rateLimit("global", 120, 4));

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return reply
      .code(400)
      .send({ error: `Invalid ${first?.path?.join(".") || "input"}: ${first?.message ?? "bad request"}` });
  }
  const known = err as { statusCode?: number; message?: string };
  const status = typeof known.statusCode === "number" ? known.statusCode : 500;
  if (status >= 500) req.log.error(err);
  return reply
    .code(status)
    .send({ error: status >= 500 ? "Internal server error" : (known.message ?? "Request failed") });
});

app.get("/api/health", async () => ({ ok: true, name: "cardorize-api" }));

registerAuthRoutes(app);
registerDeckRoutes(app);
registerStudyRoutes(app);
registerSourceRoutes(app);
registerSettingsRoutes(app);
registerSocialRoutes(app);

app
  .listen({ port: config.port, host: config.host })
  .then(() => console.log(`Cardorize API listening on http://${config.host}:${config.port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
