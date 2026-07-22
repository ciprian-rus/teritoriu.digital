import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAllowedUrl,
  assertSafeTarget,
  isPublicNetworkAddress
} from "../../packages/pipeline/src/acquisition/network-policy.mjs";

const policy = {
  allowedHosts: ["data.gov.ro"],
  allowedProtocols: ["https:"],
  allowedPorts: [443]
};

test("accepts only the exact HTTPS host and port", () => {
  assert.equal(assertAllowedUrl("https://data.gov.ro/dataset/file", policy).hostname, "data.gov.ro");
  assert.throws(() => assertAllowedUrl("http://data.gov.ro/file", policy), { code: "PROTOCOL_BLOCKED" });
  assert.throws(() => assertAllowedUrl("https://evil.example/file", policy), { code: "HOST_BLOCKED" });
  assert.throws(() => assertAllowedUrl("https://data.gov.ro:8443/file", policy), { code: "PORT_BLOCKED" });
  assert.throws(() => assertAllowedUrl("https://user:pass@data.gov.ro/file", policy), {
    code: "URL_CREDENTIALS"
  });
});

test("rejects private, loopback, link-local and documentation networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1"
  ]) {
    assert.equal(isPublicNetworkAddress(address), false, address);
  }
  assert.equal(isPublicNetworkAddress("93.184.216.34"), true);
  assert.equal(isPublicNetworkAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("fails closed if any DNS answer is non-public", async () => {
  await assert.rejects(
    assertSafeTarget("https://data.gov.ro/file", policy, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ]),
    { code: "PRIVATE_ADDRESS_BLOCKED" }
  );
});
