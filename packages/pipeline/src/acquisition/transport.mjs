import http from "node:http";
import https from "node:https";

import { AcquisitionError } from "./errors.mjs";
import { isPublicNetworkAddress } from "./network-policy.mjs";

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : value ?? null
    ])
  );
}

function safeLookup(records) {
  return (_hostname, options, callback) => {
    const candidates = records.filter((record) => {
      if (options?.family === 4 || options?.family === 6) {
        return record.family === options.family;
      }
      return true;
    });
    if (candidates.length === 0 || candidates.some((item) => !isPublicNetworkAddress(item.address))) {
      callback(new AcquisitionError("DNS_REBIND_BLOCKED", "No safe resolved address is available"));
      return;
    }

    if (options?.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

async function readBody(response, maxBytes) {
  const declaredLength = Number(response.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    response.resume();
    throw new AcquisitionError(
      "SIZE_LIMIT_EXCEEDED",
      `Response Content-Length exceeds the ${maxBytes} byte limit`
    );
  }

  const chunks = [];
  let sizeBytes = 0;
  for await (const chunk of response) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes) {
      response.destroy();
      throw new AcquisitionError(
        "SIZE_LIMIT_EXCEEDED",
        `Response body exceeds the ${maxBytes} byte limit`
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, sizeBytes);
}

export function nodeTransport(url, options) {
  const client = url.protocol === "https:" ? https : http;
  // Node's shared agent may impose a shorter socket timeout than the reviewed
  // source policy. A one-request agent keeps the timeout boundary explicit and
  // prevents a pooled socket from carrying state between validated targets.
  const agent = new client.Agent({
    keepAlive: false,
    timeout: options.timeoutMs
  });
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        agent,
        headers: options.headers,
        lookup: safeLookup(options.resolvedAddresses),
        signal: options.signal
      },
      async (response) => {
        try {
          const status = response.statusCode ?? 0;
          const headers = normalizeHeaders(response.headers);
          if (status >= 300 && status < 400) {
            response.resume();
            resolve({ status, headers, body: Buffer.alloc(0) });
            return;
          }
          resolve({ status, headers, body: await readBody(response, options.maxBytes) });
        } catch (error) {
          reject(error);
        }
      }
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(
        new AcquisitionError("TIMEOUT", `Request exceeded ${options.timeoutMs} ms`, {
          retryable: true,
          context: {
            elapsedMs: elapsedMs(),
            timeoutSource: "socket-inactivity"
          }
        })
      );
    });
    request.on("error", (cause) => {
      if (cause instanceof AcquisitionError) {
        cause.context = { elapsedMs: elapsedMs(), ...cause.context };
        reject(cause);
        return;
      }
      const aborted = options.signal.aborted;
      reject(
        new AcquisitionError(
          aborted ? "TIMEOUT" : "NETWORK_FAILED",
          aborted ? `Request exceeded ${options.timeoutMs} ms` : "Network request failed",
          {
            cause,
            retryable: true,
            context: {
              causeCode: typeof cause?.code === "string" ? cause.code : undefined,
              elapsedMs: elapsedMs(),
              timeoutSource: aborted ? "request-deadline" : undefined
            }
          }
        )
      );
    });
    request.on("close", () => agent.destroy());
    request.end();
  });
}

export async function fetchTransport(url, options) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: options.headers,
    signal: options.signal
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    await response.body?.cancel();
    throw new AcquisitionError(
      "SIZE_LIMIT_EXCEEDED",
      `Response Content-Length exceeds the ${options.maxBytes} byte limit`
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > options.maxBytes) {
    throw new AcquisitionError(
      "SIZE_LIMIT_EXCEEDED",
      `Response body exceeds the ${options.maxBytes} byte limit`
    );
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body
  };
}
