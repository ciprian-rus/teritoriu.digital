const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;
const SWEEP_INTERVAL_MS = 30_000;

const hits = new Map();
let lastSweepAt = 0;

function currentWindowMs() {
  return Number(process.env.RATE_LIMIT_WINDOW_MS) || DEFAULT_WINDOW_MS;
}

function currentMaxRequests() {
  return Number(process.env.RATE_LIMIT_MAX_REQUESTS) || DEFAULT_MAX_REQUESTS;
}

function currentTrustedProxyHops() {
  const value = Number(process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

/**
 * Gated by elapsed time, not map size: sweeping only when size crosses a
 * threshold means an attacker who keeps the map above that threshold with
 * fresh (non-expired) keys forces a full-map scan on every single request
 * — turning the limiter itself into the DoS vector. A fixed interval
 * bounds total sweep cost regardless of request rate.
 */
function sweep(now) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
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

/**
 * X-Forwarded-For is a chain that grows on the client's side of the
 * connection first: anything a caller sends before reaching your own
 * infrastructure is attacker-controlled and can be rotated on every
 * request to dodge the limit entirely. Only the entries appended by
 * proxies *you* run are trustworthy, and only counting from the right —
 * the hop closest to this server. `trustedProxyHops` must match the
 * actual number of reverse proxies in front of this deployment (1 for a
 * single edge such as Vercel's, which is the only deploy target this
 * project targets so far). With 0 trusted hops (reached directly, no
 * proxy in front), no client-supplied header can be trusted at all.
 */
export function clientKey(request, trustedProxyHops = currentTrustedProxyHops()) {
  if (trustedProxyHops <= 0) return "unknown";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const index = chain.length - trustedProxyHops;
    if (index >= 0) return chain[index];
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function resetRateLimitState() {
  hits.clear();
  lastSweepAt = 0;
}
