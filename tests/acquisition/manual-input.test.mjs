import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadManualSnapshot } from "../../packages/pipeline/src/acquisition/manual-input.mjs";

const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("fixture/[Content_Types].xml/fixture/xl/workbook.xml/content")
]);
const source = {
  maxBytes: 1024,
  expectedDetectedMediaTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "siruta-manual-"));
  const file = path.join(root, "siruta.xlsx");
  await writeFile(file, bytes);
  return file;
}

test("accepts an exact manually supplied official snapshot", async () => {
  const result = await loadManualSnapshot(await fixture(), source, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    provenanceUrl: "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111"
  });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.discovery.channel, "manual-bootstrap");
});

test("rejects a size mismatch before accepting the input", async () => {
  await assert.rejects(loadManualSnapshot(await fixture(), source, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length + 1,
    provenanceUrl: "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111"
  }), { code: "SIZE_MISMATCH" });
});

test("rejects a checksum mismatch", async () => {
  await assert.rejects(loadManualSnapshot(await fixture(), source, {
    sha256: "0".repeat(64),
    sizeBytes: bytes.length,
    provenanceUrl: "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111"
  }), { code: "SHA256_MISMATCH" });
});
