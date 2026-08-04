import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchAllFeatures, fetchObjectIds, queryFeatureServer } from "../../packages/pipeline/src/geometry/arcgis-client.mjs";

const baseSource = {
  featureServerUrl: "https://services-eu1.arcgis.com/tt6hwS9xmcvnRjQC/ArcGIS/rest/services/AU/FeatureServer/1",
  allowedHosts: ["services-eu1.arcgis.com"],
  allowedProtocols: ["https:"],
  allowedPorts: [443],
  maxBytes: 1048576,
  timeoutMs: 1000,
  maxAttempts: 2,
  queryBatchSize: 2,
  minExpectedObjectCount: 2
};

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function response(body, init = {}) {
  const text = JSON.stringify(body);
  return {
    status: init.status ?? 200,
    headers: new Map([["content-length", String(Buffer.byteLength(text))]]),
    arrayBuffer: async () => Buffer.from(text)
  };
}

test("rejects a featureServerUrl on a non-allowlisted host", async () => {
  const source = { ...baseSource, featureServerUrl: baseSource.featureServerUrl.replace("services-eu1.arcgis.com", "evil.example") };
  await assert.rejects(
    queryFeatureServer(source, "query", { f: "json" }, { resolver: publicResolver, fetchImpl: async () => response({}) }),
    { code: "HOST_BLOCKED" }
  );
});

test("fetchObjectIds fails closed when ArcGIS returns fewer objects than expected", async () => {
  await assert.rejects(
    fetchObjectIds(baseSource, {
      resolver: publicResolver,
      fetchImpl: async () => response({ objectIds: [1] })
    }),
    { code: "OBJECT_COUNT_TOO_LOW" }
  );
});

test("fetchObjectIds sorts and returns the object IDs", async () => {
  const result = await fetchObjectIds(baseSource, {
    resolver: publicResolver,
    fetchImpl: async () => response({ objectIds: [3, 1, 2] })
  });
  assert.deepEqual(result.ids, [1, 2, 3]);
});

test("surfaces an ArcGIS error payload as a typed error", async () => {
  await assert.rejects(
    queryFeatureServer(baseSource, "query", { f: "json" }, {
      resolver: publicResolver,
      fetchImpl: async () => response({ error: { code: 400, message: "Invalid query parameters" } })
    }),
    { code: "ARCGIS_ERROR", message: /Invalid query parameters/ }
  );
});

test("retries a transient HTTP failure and succeeds on the next attempt", async () => {
  let calls = 0;
  const result = await queryFeatureServer(baseSource, "query", { f: "json" }, {
    resolver: publicResolver,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({}, { status: 429 });
      return response({ ok: true });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.json.ok, true);
});

test("does not retry a non-retryable HTTP status", async () => {
  let calls = 0;
  await assert.rejects(
    queryFeatureServer(baseSource, "query", { f: "json" }, {
      resolver: publicResolver,
      sleep: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return response({}, { status: 404 });
      }
    }),
    { code: "HTTP_STATUS" }
  );
  assert.equal(calls, 1);
});

test("fetchAllFeatures paginates object IDs into queryBatchSize-sized feature requests", async () => {
  const calls = [];
  const result = await fetchAllFeatures(baseSource, {
    resolver: publicResolver,
    fetchImpl: async (_url, init) => {
      const body = new URLSearchParams(init.body);
      if (body.get("returnIdsOnly") === "true") {
        return response({ objectIds: [1, 2, 3] });
      }
      const ids = body.get("objectIds");
      calls.push(ids);
      return response({
        features: ids.split(",").map((id) => ({ type: "Feature", properties: { OBJECTID: Number(id) }, geometry: null }))
      });
    }
  });
  // queryBatchSize = 2, so 3 object IDs split into batches of [1,2] and [3].
  assert.deepEqual(calls, ["1,2", "3"]);
  assert.equal(result.features.length, 3);
  assert.equal(result.objectCount, 3);
  assert.equal(result.attempts, 2);
});
