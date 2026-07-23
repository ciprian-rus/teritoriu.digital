import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { downloadSnapshot } from "../../packages/pipeline/src/acquisition/downloader.mjs";
import { fetchTransport } from "../../packages/pipeline/src/acquisition/transport.mjs";

const XLSX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("fixture/[Content_Types].xml/fixture/xl/workbook.xml/content")
]);

function source(resourceUrl, overrides = {}) {
  return {
    resourceUrl,
    allowedHosts: ["data.gov.ro"],
    allowedProtocols: ["https:"],
    allowedPorts: [443],
    expectedDetectedMediaTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ],
    maxBytes: 1024,
    timeoutMs: 200,
    deadlineMs: 1000,
    maxAttempts: 3,
    maxRedirects: 2,
    ...overrides
  };
}

async function serverFixture() {
  let unstableRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect-ok") {
      response.writeHead(302, { location: "/file.csv" }).end();
    } else if (request.url === "/redirect-bad") {
      response.writeHead(302, { location: "https://evil.example/file.csv" }).end();
    } else if (request.url === "/unstable") {
      unstableRequests += 1;
      if (unstableRequests === 1) response.writeHead(503).end("temporary");
      else response.writeHead(200, { "content-type": "text/csv" }).end(XLSX);
    } else if (request.url === "/large") {
      response.writeHead(200, { "content-length": "5000", "content-type": "text/csv" }).end(XLSX);
    } else if (request.url === "/slow") {
      setTimeout(() => response.writeHead(200, { "content-type": "text/csv" }).end(XLSX), 150);
    } else {
      response.writeHead(200, { "content-type": "text/csv" }).end(XLSX);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  const transport = async (logicalUrl, options) => {
    const actualUrl = new URL(logicalUrl);
    actualUrl.protocol = "http:";
    actualUrl.hostname = "127.0.0.1";
    actualUrl.port = String(port);
    return fetchTransport(actualUrl, options);
  };
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    transport,
    unstableRequests: () => unstableRequests
  };
}

test("follows an allowlisted redirect and detects XLSX behind declared CSV", async (context) => {
  const fixture = await serverFixture();
  context.after(fixture.close);
  const result = await downloadSnapshot(source("https://data.gov.ro/redirect-ok"), {
    resolver: fixture.resolver,
    transport: fixture.transport,
    sleep: async () => {}
  });
  assert.equal(result.redirectChain.length, 1);
  assert.equal(result.declaredMediaType, "text/csv");
  assert.equal(
    result.detectedMediaType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(result.declaredTypeMismatch, true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test("blocks a redirect before contacting a non-allowlisted host", async (context) => {
  const fixture = await serverFixture();
  context.after(fixture.close);
  await assert.rejects(
    downloadSnapshot(source("https://data.gov.ro/redirect-bad"), {
      resolver: fixture.resolver,
      transport: fixture.transport,
      sleep: async () => {}
    }),
    { code: "HOST_BLOCKED" }
  );
});

test("retries transient HTTP errors with bounded attempts", async (context) => {
  const fixture = await serverFixture();
  context.after(fixture.close);
  const result = await downloadSnapshot(source("https://data.gov.ro/unstable"), {
    resolver: fixture.resolver,
    transport: fixture.transport,
    sleep: async () => {}
  });
  assert.equal(result.attempts, 2);
  assert.equal(fixture.unstableRequests(), 2);
});

test("fails closed before reading a declared oversized body", async (context) => {
  const fixture = await serverFixture();
  context.after(fixture.close);
  await assert.rejects(
    downloadSnapshot(source("https://data.gov.ro/large", { maxBytes: 100 }), {
      resolver: fixture.resolver,
      transport: fixture.transport,
      sleep: async () => {}
    }),
    { code: "SIZE_LIMIT_EXCEEDED" }
  );
});

test("allows an active transfer to exceed the socket inactivity timeout", async () => {
  const result = await downloadSnapshot(
    source("https://data.gov.ro/active", {
      timeoutMs: 20,
      deadlineMs: 200,
      maxAttempts: 1
    }),
    {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async (_url, options) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(options.timeoutMs, 20);
        assert.equal(options.signal.aborted, false);
        return {
          status: 200,
          headers: { "content-type": "text/csv" },
          body: XLSX
        };
      }
    }
  );
  assert.equal(result.sizeBytes, XLSX.length);
});

test("aborts and retries a request that exceeds its total deadline", async (context) => {
  const fixture = await serverFixture();
  context.after(fixture.close);
  await assert.rejects(
    downloadSnapshot(
      source("https://data.gov.ro/slow", {
        timeoutMs: 20,
        deadlineMs: 20,
        maxAttempts: 2
      }),
      {
        resolver: fixture.resolver,
        transport: fixture.transport,
        sleep: async () => {}
      }
    ),
    (error) => {
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.context.attempts, 2);
      assert.equal(error.context.maxAttempts, 2);
      assert.equal(error.context.timeoutSource, "request-deadline");
      return true;
    }
  );
});
