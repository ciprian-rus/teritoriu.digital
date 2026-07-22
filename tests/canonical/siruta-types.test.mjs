import test from "node:test";
import assert from "node:assert/strict";

import {
  knownSirutaTypeCodes,
  sirutaTypeDefinition
} from "../../packages/pipeline/src/canonical/siruta-types.mjs";

test("maps every reviewed SIRUTA type code to an explicit canonical role and level", () => {
  assert.deepEqual(knownSirutaTypeCodes(), [1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 18, 19, 22, 23, 40]);
  for (const code of knownSirutaTypeCodes()) {
    const definition = sirutaTypeDefinition(code, "TEST");
    assert.ok(definition.territoryType);
    assert.ok(definition.administrativeRole);
    assert.ok([1, 2, 3].includes(definition.expectedLevel));
  }
  assert.equal(sirutaTypeDefinition(6).administrativeRole, "administrative_subdivision");
  assert.equal(sirutaTypeDefinition(40, "MUNICIPIUL BUCUREȘTI").territoryType, "bucharest");
  assert.equal(sirutaTypeDefinition(99), null);
});
