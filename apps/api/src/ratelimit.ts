// In-process token-bucket rate limiting (per key = bucketName:ip or :user).
// A shared store (Redis) replaces this when the API scales horizontally.
import type { FastifyReply, FastifyRequest } from "fastify";

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so idle buckets don't accumulate forever.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
}, 10 * 60 * 1000).unref();

export function rateLimit(name: string, capacity: number, refillPerSecond: number) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const who = (req as FastifyRequest & { userId?: string }).userId ?? req.ip;
    const key = `${name}:${who}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSecond);
    b.last = now;
    if (b.tokens < 1) {
      reply.header("Retry-After", Math.ceil(1 / refillPerSecond));
      return reply.code(429).send({ error: "Too many requests. Slow down and try again." });
    }
    b.tokens -= 1;
  };
}
