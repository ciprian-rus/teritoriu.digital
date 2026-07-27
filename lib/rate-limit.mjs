const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;
const SWEEP_THRESHOLD = 10_000;

const hits = new Map();

function currentWindowMs() {
  return Number(process.env.RATE_LIMIT_WINDOW_MS) || DEFAULT_WINDOW_MS;
}

function currentMaxRequests() {
  return Number(process.env.RATE_LIMIT_MAX_REQUESTS) || DEFAULT_MAX_REQUESTS;
}

function sweep(now) {
  if (hits.size < SWEEP_THRESHOLD) return;
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(key);
  }
}

/**
 * In-memory fixed-window limiter, scoped to a single warm serverless
 * instance — not a distributed guarantee. Deliberately not backed by
 * Upstash/Vercel KV yet: that's a real infra decision (a paid external
 * service) that deserves its own call once there's actual production
 * traffic to size it against, not a default reached for because "rate
 * limiting" sounds like it needs one. This still stops a single hot
 * instance from being hammered, which is the concrete risk today.
 */
export function checkRateLimit(key, options = {}) {
  const windowMs = options.windowMs ?? currentWindowMs();
  const maxRequests = options.maxRequests ?? currentMaxRequests();
  const now = Date.now();
  sweep(now);

  const entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs;
    hits.set(key, { count: 1, resetAt });
    return { limited: false, remaining: maxRequests - 1, resetAt };
  }

  entry.count += 1;
  const limited = entry.count > maxRequests;
  return { limited, remaining: Math.max(0, maxRequests - entry.count), resetAt: entry.resetAt };
}

export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function resetRateLimitState() {
  hits.clear();
}
