import test from "node:test";
import assert from "node:assert/strict";

import { uuidV7 } from "../../packages/pipeline/src/acquisition/uuid-v7.mjs";

test("generates an RFC-compatible UUIDv7 with stable timestamp bytes", () => {
  const value = uuidV7(
    () => 0x0123456789ab,
    () => Buffer.alloc(16, 0xff)
  );
  assert.equal(value, "01234567-89ab-7fff-bfff-ffffffffffff");
});
