import { createHash } from "node:crypto";

import { AcquisitionError } from "./errors.mjs";
import { assertExpectedMediaType } from "./media-type.mjs";
import { assertSafeTarget } from "./network-policy.mjs";
import { nodeTransport } from "./transport.mjs";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

const defaultSleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(attempt, headers) {
  const retryAfter = headers?.["retry-after"];
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1000, 30000);
  }
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

async function requestFollowingRedirects(urlInput, source, dependencies) {
  let currentUrl = urlInput;
  const redirectChain = [];

  for (let redirectCount = 0; redirectCount <= source.maxRedirects; redirectCount += 1) {
    const safeTarget = await assertSafeTarget(currentUrl, source, dependencies.resolver);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs);
    let response;
    try {
      response = await dependencies.transport(safeTarget.url, {
        signal: controller.signal,
        timeoutMs: source.timeoutMs,
        maxBytes: source.maxBytes,
        resolvedAddresses: safeTarget.records,
        headers: {
          Accept: "application/octet-stream, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9",
          "User-Agent": "teritoriu.digital-source-acquisition/1.0"
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ...response, resolvedUrl: safeTarget.url.href, redirectChain };
    }
    const location = response.headers.location;
    if (!location) {
      throw new AcquisitionError("REDIRECT_WITHOUT_LOCATION", "Redirect response has no Location header");
    }
    if (redirectCount === source.maxRedirects) {
      throw new AcquisitionError("TOO_MANY_REDIRECTS", "Maximum redirect count exceeded");
    }
    const nextUrl = new URL(location, safeTarget.url).href;
    await assertSafeTarget(nextUrl, source, dependencies.resolver);
    redirectChain.push({ status: response.status, from: safeTarget.url.href, to: nextUrl });
    currentUrl = nextUrl;
  }

  throw new AcquisitionError("TOO_MANY_REDIRECTS", "Maximum redirect count exceeded");
}

function validateSourceConfiguration(source) {
  const requiredArrays = [
    "allowedHosts",
    "allowedProtocols",
    "allowedPorts",
    "expectedDetectedMediaTypes"
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(source[key]) || source[key].length === 0) {
      throw new AcquisitionError("SOURCE_CONFIG_INVALID", `${key} must be a non-empty array`);
    }
  }
  for (const key of ["maxBytes", "timeoutMs", "maxAttempts", "maxRedirects"]) {
    if (!Number.isInteger(source[key]) || source[key] < 1) {
      throw new AcquisitionError("SOURCE_CONFIG_INVALID", `${key} must be a positive integer`);
    }
  }
}

export async function downloadSnapshot(source, options = {}) {
  validateSourceConfiguration(source);
  const dependencies = {
    resolver: options.resolver,
    sleep: options.sleep ?? defaultSleep,
    transport: options.transport ?? nodeTransport
  };

  let lastError;
  for (let attempt = 1; attempt <= source.maxAttempts; attempt += 1) {
    try {
      const response = await requestFollowingRedirects(source.resourceUrl, source, dependencies);
      if (response.status < 200 || response.status >= 300) {
        const retryable = RETRYABLE_STATUSES.has(response.status) || response.status >= 500;
        throw new AcquisitionError("HTTP_STATUS", `Source returned HTTP ${response.status}`, {
          retryable,
          context: { status: response.status, headers: response.headers }
        });
      }
      if (response.body.length === 0) {
        throw new AcquisitionError("EMPTY_BODY", "Source returned an empty file");
      }

      let media;
      try {
        media = assertExpectedMediaType(
          response.body,
          response.headers["content-type"],
          source.expectedDetectedMediaTypes
        );
      } catch (cause) {
        throw new AcquisitionError(
          cause.code ?? "MEDIA_TYPE_UNEXPECTED",
          cause.message,
          { cause }
        );
      }

      return {
        bytes: response.body,
        requestedUrl: source.resourceUrl,
        resolvedUrl: response.resolvedUrl,
        httpStatus: response.status,
        headers: response.headers,
        redirectChain: response.redirectChain,
        sizeBytes: response.body.length,
        sha256: createHash("sha256").update(response.body).digest("hex"),
        ...media,
        attempts: attempt
      };
    } catch (error) {
      const normalized =
        error instanceof AcquisitionError
          ? error
          : error?.name === "AbortError"
            ? new AcquisitionError("TIMEOUT", `Request exceeded ${source.timeoutMs} ms`, {
                cause: error,
                retryable: true
              })
          : new AcquisitionError("NETWORK_FAILED", "Network request failed", {
              cause: error,
              retryable: true
            });
      normalized.context = {
        ...normalized.context,
        attempts: attempt,
        maxAttempts: source.maxAttempts
      };
      lastError = normalized;
      if (!normalized.retryable || attempt === source.maxAttempts) {
        throw normalized;
      }
      await dependencies.sleep(retryDelay(attempt, normalized.context.headers));
    }
  }
  throw lastError;
}
