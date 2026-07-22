import test from "node:test";
import assert from "node:assert/strict";

import { safeErrorMessage } from "../../packages/pipeline/src/acquisition/errors.mjs";

test("redacts database URLs and JWT-like service keys from errors", () => {
  const message = safeErrorMessage(
    new Error(
      "failed postgresql://postgres:secret@db.example.test:5432/postgres eyJhbGciOiJIUzI1NiJ9.abc.signature"
    )
  );
  assert.equal(message.includes("secret"), false);
  assert.equal(message.includes("eyJ"), false);
  assert.match(message, /\[redacted\]/);
});
