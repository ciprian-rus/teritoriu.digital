import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  loadStorageBootstrap,
  resolveConfiguredStorageBootstrap
} from "../../packages/pipeline/src/acquisition/storage-input.mjs";

const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("fixture/[Content_Types].xml/fixture/xl/workbook.xml/content")
]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = {
  maxBytes: 1024,
  allowedProtocols: ["https:"],
  allowedHosts: ["data.gov.ro"],
  expectedDetectedMediaTypes: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]
};

function supabaseMock(content = bytes) {
  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, "source-snapshots");
        return {
          download: async (objectPath) => {
            assert.equal(objectPath, "bootstrap/siruta-2025.xlsx");
            return { data: new Blob([content]), error: null };
          }
        };
      }
    }
  };
}

const expected = {
  sha256,
  sizeBytes: bytes.length,
  provenanceUrl: "https://data.gov.ro/dataset/siruta_an-2025"
};

test("resolves the operator-free bootstrap from versioned source configuration", () => {
  const configured = resolveConfiguredStorageBootstrap({
    ...source,
    resourceUrl: expected.provenanceUrl,
    bootstrapStorageObject: "bootstrap/siruta-2025.xlsx",
    observedSnapshot: {
      sha256: expected.sha256,
      sizeBytes: expected.sizeBytes
    }
  });
  assert.deepEqual(configured, {
    objectPath: "bootstrap/siruta-2025.xlsx",
    expected
  });
});

test("loads an exact verified bootstrap object from the private bucket", async () => {
  const result = await loadStorageBootstrap(
    "bootstrap/siruta-2025.xlsx",
    source,
    expected,
    { client: supabaseMock() }
  );
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.discovery.channel, "private-storage-bootstrap");
  assert.equal(result.discovery.bucket, "source-snapshots");
});

test("rejects paths outside the dedicated bootstrap prefix", async () => {
  await assert.rejects(
    loadStorageBootstrap("../siruta.xlsx", source, expected, {
      client: supabaseMock()
    }),
    { code: "STORAGE_OBJECT_INVALID" }
  );
});

test("rejects a checksum mismatch before pipeline publication", async () => {
  await assert.rejects(
    loadStorageBootstrap(
      "bootstrap/siruta-2025.xlsx",
      source,
      { ...expected, sha256: "0".repeat(64) },
      { client: supabaseMock() }
    ),
    { code: "SHA256_MISMATCH" }
  );
});

test("rejects provenance outside the official allowlist", async () => {
  await assert.rejects(
    loadStorageBootstrap(
      "bootstrap/siruta-2025.xlsx",
      source,
      { ...expected, provenanceUrl: "https://example.com/siruta.xlsx" },
      { client: supabaseMock() }
    ),
    { code: "PROVENANCE_INVALID" }
  );
});
