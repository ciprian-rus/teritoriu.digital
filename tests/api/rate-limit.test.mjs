import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRateLimit, clientKey, resetRateLimitState } from "../../lib/rate-limit.mjs";

test.beforeEach(() => {
  resetRateLimitState();
});

test("allows requests under the limit and counts down remaining", () => {
  const key = "1.2.3.4";
  const first = checkRateLimit(key, { windowMs: 60_000, maxRequests: 3 });
  const second = checkRateLimit(key, { windowMs: 60_000, maxRequests: 3 });
  const third = checkRateLimit(key, { windowMs: 60_000, maxRequests: 3 });
  assert.deepEqual(
    [first.limited, second.limited, third.limited],
    [false, false, false]
  );
  assert.deepEqual([first.remaining, second.remaining, third.remaining], [2, 1, 0]);
});

test("rejects requests once the limit is exceeded within the same window", () => {
  const key = "5.6.7.8";
  for (let i = 0; i < 3; i += 1) checkRateLimit(key, { windowMs: 60_000, maxRequests: 3 });
  const fourth = checkRateLimit(key, { windowMs: 60_000, maxRequests: 3 });
  assert.equal(fourth.limited, true);
  assert.equal(fourth.remaining, 0);
});

test("different keys are tracked independently", () => {
  const a = checkRateLimit("a", { windowMs: 60_000, maxRequests: 1 });
  const b = checkRateLimit("b", { windowMs: 60_000, maxRequests: 1 });
  assert.equal(a.limited, false);
  assert.equal(b.limited, false);
});

test("a new window resets the count", async () => {
  const key = "reset-me";
  checkRateLimit(key, { windowMs: 10, maxRequests: 1 });
  const limited = checkRateLimit(key, { windowMs: 10, maxRequests: 1 });
  assert.equal(limited.limited, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const afterReset = checkRateLimit(key, { windowMs: 10, maxRequests: 1 });
  assert.equal(afterReset.limited, false);
});

test("clientKey trusts only the hop closest to the server, not attacker-supplied entries", () => {
  // With 1 trusted hop (a single edge, e.g. Vercel), the LAST entry is the
  // one that hop appended — everything before it could be spoofed by the
  // caller and must not be trusted.
  const spoofedPlusReal = new Request("http://localhost/api/v1/territories", {
    headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9, 10.10.10.10" }
  });
  assert.equal(clientKey(spoofedPlusReal, 1), "10.10.10.10");

  // With 2 trusted hops, the second-to-last entry is the one to trust.
  assert.equal(clientKey(spoofedPlusReal, 2), "9.9.9.9");

  const withRealIp = new Request("http://localhost/api/v1/territories", {
    headers: { "x-real-ip": "8.8.8.8" }
  });
  assert.equal(clientKey(withRealIp, 1), "8.8.8.8");

  const withNeither = new Request("http://localhost/api/v1/territories");
  assert.equal(clientKey(withNeither, 1), "unknown");
});

test("clientKey trusts nothing when there are zero trusted proxy hops", () => {
  const request = new Request("http://localhost/api/v1/territories", {
    headers: { "x-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8" }
  });
  assert.equal(clientKey(request, 0), "unknown");
});

test("many distinct keys stay fast — no full-map sweep triggered per request", () => {
  const start = Date.now();
  for (let i = 0; i < 500; i += 1) {
    checkRateLimit(`stress-${i}`, { windowMs: 60_000, maxRequests: 1 });
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `500 unique keys should be fast, took ${elapsed}ms`);
});
