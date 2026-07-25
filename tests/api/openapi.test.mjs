import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const spec = JSON.parse(readFileSync(new URL("../../openapi/v1.json", import.meta.url), "utf8"));

function collectRefs(node, refs = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

function resolveRef(spec, ref) {
  assert.ok(ref.startsWith("#/"), `only local refs are supported: ${ref}`);
  const path = ref.slice(2).split("/");
  let node = spec;
  for (const segment of path) {
    node = node?.[segment];
  }
  return node;
}

test("openapi document declares the documented API version", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "1.0.0");
});

test("GET /api/v1/territories is documented with success, cache and error responses", () => {
  const operation = spec.paths["/api/v1/territories"].get;
  assert.ok(operation, "operation must exist");
  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "304", "503"]);
  const paramNames = operation.parameters.map((param) => param.name).sort();
  assert.deepEqual(paramNames, [
    "cursor", "limit", "q", "siruta", "status", "territoryId", "type", "countyTerritoryId"
  ].sort());
});

test("every $ref in the document resolves to an existing schema", () => {
  const refs = collectRefs(spec);
  assert.ok(refs.length > 0, "expected at least one $ref in the document");
  for (const ref of refs) {
    assert.ok(resolveRef(spec, ref) !== undefined, `unresolved $ref: ${ref}`);
  }
});

test("TerritoryListResponse matches the fields the route actually returns", () => {
  const responseSchema = spec.components.schemas.TerritoryListResponse;
  assert.deepEqual(responseSchema.required.sort(), ["items", "nextCursor", "release", "total"].sort());
  const territorySchema = spec.components.schemas.Territory;
  const requiredFields = territorySchema.required;
  for (const field of [
    "territoryId", "officialName", "normalizedName", "territoryType",
    "administrativeRole", "administrativeLevel", "status", "identifiers"
  ]) {
    assert.ok(requiredFields.includes(field), `Territory.required must include ${field}`);
  }
});
