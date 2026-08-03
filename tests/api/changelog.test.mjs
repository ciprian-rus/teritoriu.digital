import assert from "node:assert/strict";
import { test } from "node:test";
import { loadVerifiedRelease } from "../../lib/release-source.mjs";

// Uses real network data (like territorial-integrity.test.mjs), since
// changelog.json is part of the actual verified release bundle, not
// something worth faking a fixture for. Skips cleanly if unavailable.
let release;
try {
  release = await loadVerifiedRelease();
} catch {
  release = null;
}

test("the verified release exposes its already-checksummed changelog", { skip: !release }, () => {
  const { changelog } = release;
  assert.ok(changelog, "release.changelog must be present");
  assert.ok(Array.isArray(changelog.added));
  assert.ok(Array.isArray(changelog.changed));
  assert.ok(Array.isArray(changelog.removed));
  assert.ok(Array.isArray(changelog.sourceRecordChanged));
  assert.equal(typeof changelog.unchanged, "number");
  assert.equal(typeof changelog.baseline, "boolean");
  assert.ok(changelog.previousReleaseId === null || typeof changelog.previousReleaseId === "string");
});

test("changelog counts add up to the release's total territory count when not a baseline", { skip: !release }, () => {
  const { changelog, territories } = release;
  if (changelog.baseline) return; // baseline releases don't carry a meaningful prior-count comparison
  const total = changelog.added.length + changelog.changed.length + changelog.unchanged;
  assert.equal(total, territories.length);
});

test("changelog entries are unique within each category (no double-counting a SIRUTA code)", { skip: !release }, () => {
  const { changelog } = release;
  for (const category of ["added", "changed", "removed", "sourceRecordChanged"]) {
    const values = changelog[category];
    assert.equal(new Set(values).size, values.length, `${category} must not contain duplicates`);
  }
});

test("no SIRUTA code is counted in more than one of added/changed/removed", { skip: !release }, () => {
  const { changelog } = release;
  const seen = new Set();
  for (const category of ["added", "changed", "removed"]) {
    for (const code of changelog[category]) {
      assert.ok(!seen.has(code), `${code} appears in more than one changelog category`);
      seen.add(code);
    }
  }
});
