// Content-Security-Policy lives in middleware.js instead — it needs a
// fresh per-request nonce, which a static header list here can't provide.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // includeSubDomains but deliberately no `preload`: submitting to the
  // browser HSTS preload list is a one-way commitment for the whole
  // domain (removal takes months), and that's the site owner's call to
  // make explicitly, not a default this config should reach for.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  }
};

export default nextConfig;
