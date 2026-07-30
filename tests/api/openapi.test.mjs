import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const spec = JSON.parse(readFileSync(new URL("../../openapi/v1.json", import.meta.url), "utf8"));

const SCHEMA_BASE = "https://teritoriu.digital/openapi-under-test";
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(spec, SCHEMA_BASE);

function validateAgainstSchema(fragmentPath, value) {
  const validate = ajv.compile({ $ref: `${SCHEMA_BASE}#${fragmentPath}` });
  const valid = validate(value);
  return { valid, errors: validate.errors };
}

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
  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "304", "429", "503"]);
  const paramNames = operation.parameters.map((param) => param.name).sort();
  assert.deepEqual(paramNames, [
    "cursor", "limit", "q", "siruta", "status", "territoryId", "type", "countyTerritoryId"
  ].sort());
});

test("GET /api/v1/territories/{territoryId} is documented with the 404 case", () => {
  const operation = spec.paths["/api/v1/territories/{territoryId}"].get;
  assert.ok(operation, "operation must exist");
  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "304", "404", "429", "503"]);
  assert.equal(operation.parameters[0].name, "territoryId");
  assert.equal(operation.parameters[0].required, true);
});

test("GET /api/v1/territories/{territoryId}/descendants is documented and paginated like the list endpoint", () => {
  const operation = spec.paths["/api/v1/territories/{territoryId}/descendants"].get;
  assert.ok(operation, "operation must exist");
  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "304", "404", "429", "503"]);
  assert.equal(
    operation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/TerritoryListResponse",
    "reuses the same list schema as /api/v1/territories rather than inventing a parallel one"
  );
  const paramNames = operation.parameters.map((param) => param.name).sort();
  assert.deepEqual(paramNames, ["cursor", "limit", "status", "territoryId", "type"].sort());
});

test("TerritoryDetailResponse exposes ancestors and children as Territory arrays", () => {
  const detailSchema = spec.components.schemas.TerritoryDetailResponse;
  assert.deepEqual(detailSchema.required.sort(), ["ancestors", "children", "release", "territory"].sort());
  assert.equal(detailSchema.properties.ancestors.items.$ref, "#/components/schemas/Territory");
  assert.equal(detailSchema.properties.children.items.$ref, "#/components/schemas/Territory");
});

test("every $ref in the document resolves to an existing schema", () => {
  const refs = collectRefs(spec);
  assert.ok(refs.length > 0, "expected at least one $ref in the document");
  for (const ref of refs) {
    assert.ok(resolveRef(spec, ref) !== undefined, `unresolved $ref: ${ref}`);
  }
});

test("every response example actually validates against its own declared schema", () => {
  let checked = 0;
  for (const [pathName, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const content = response.content?.["application/json"];
        if (!content?.examples) continue;
        for (const [exampleName, example] of Object.entries(content.examples)) {
          const { valid, errors } = validateAgainstSchema(
            content.schema.$ref.slice(1),
            example.value
          );
          assert.ok(
            valid,
            `${method.toUpperCase()} ${pathName} ${status} example "${exampleName}" doesn't match its schema: ${JSON.stringify(errors)}`
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 0, "expected at least one response example to check");
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
