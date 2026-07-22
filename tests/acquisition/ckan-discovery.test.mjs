import test from "node:test";
import assert from "node:assert/strict";

import { discoverCkanResource } from "../../packages/pipeline/src/acquisition/ckan-discovery.mjs";

const resourceUrl = "https://data.gov.ro/dataset/package/resource/id/download/siruta.csv";
const source = {
  ckanApiUrl: "https://data.gov.ro/api/3/action/package_show",
  ckanPackageId: "siruta_an-2025",
  resourceId: "resource-id",
  resourceUrl,
  allowedHosts: ["data.gov.ro"],
  allowedProtocols: ["https:"],
  allowedPorts: [443],
  maxBytes: 1024 * 1024,
  timeoutMs: 1000,
  maxAttempts: 2,
  maxRedirects: 2
};

function dependencies(url = resourceUrl) {
  const document = {
    success: true,
    result: {
      name: "siruta_an-2025",
      resources: [
        {
          id: "resource-id",
          name: "SIRUTA_AN_2025.csv",
          state: "active",
          format: "CSV",
          mimetype: "text/csv",
          size: 1158236,
          url
        }
      ]
    }
  };
  return {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    sleep: async () => {},
    transport: async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(document))
    })
  };
}

test("discovers the configured active resource by stable CKAN ID", async () => {
  const result = await discoverCkanResource(source, dependencies());
  assert.equal(result.resourceUrl, resourceUrl);
  assert.equal(result.resource.id, "resource-id");
  assert.match(result.discoverySha256, /^[0-9a-f]{64}$/);
});

test("blocks a silent CKAN resource URL change pending review", async () => {
  await assert.rejects(
    discoverCkanResource(
      source,
      dependencies("https://data.gov.ro/dataset/package/resource/new/download/siruta.csv")
    ),
    { code: "CKAN_RESOURCE_URL_CHANGED" }
  );
});
