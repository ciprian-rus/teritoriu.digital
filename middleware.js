import { NextResponse } from "next/server";

/**
 * Content-Security-Policy needs a per-request nonce so Next.js's own
 * inline bootstrap scripts (hydration data, RSC payload) can run without
 * falling back to 'unsafe-inline' — which would defeat most of what CSP
 * is for. Next.js reads the nonce back off the request headers and
 * applies it to its own internal scripts automatically; this file
 * doesn't need to inject it into anything itself since the app has no
 * custom inline scripts of its own.
 *
 * This is why every page sets `export const dynamic = "force-dynamic"`:
 * a nonce is only meaningful per-request, so these routes can't be
 * statically cached.
 */
export function middleware(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static assets, where a nonce would
    // be meaningless and caching matters more than a fresh CSP header.
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
};
