import assert from "node:assert/strict";
import { test } from "node:test";

import { matchFeaturesToTerritories } from "../../packages/pipeline/src/geometry/match-territories.mjs";

function territory(overrides) {
  return {
    territoryId: "t-1",
    officialName: "TERITORIU DE TEST",
    shortName: null,
    territoryType: "county",
    countyTerritoryId: "t-1",
    sirutaCode: null,
    ...overrides
  };
}

function feature(overrides) {
  return {
    type: "Feature",
    properties: {
      OBJECTID: 1,
      featureId: "1",
      name_1: null,
      name_2: null,
      name_3: null,
      nationalCode: null,
      nationalLevel: null,
      upperLevelUnit: null
    },
    geometry: { type: "Polygon", coordinates: [[[23, 46], [24, 46], [24, 47], [23, 46]]] },
    ...overrides
  };
}

const alba = territory({
  territoryId: "alba",
  officialName: "JUDEȚUL ALBA",
  shortName: "ALBA",
  territoryType: "county",
  countyTerritoryId: "alba",
  sirutaCode: "10"
});
const albaIulia = territory({
  territoryId: "alba-iulia",
  officialName: "MUNICIPIUL ALBA IULIA",
  shortName: "ALBA IULIA",
  territoryType: "municipality",
  countyTerritoryId: "alba",
  sirutaCode: "1017"
});

test("matches a county-level feature by SIRUTA code", () => {
  const features = [feature({ properties: { ...feature().properties, nationalCode: "10", nationalLevel: "2ndOrder" } })];
  const result = matchFeaturesToTerritories(features, [alba]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].territoryId, "alba");
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.conflicts, []);
});

test("falls back to name matching for a county-level feature with no SIRUTA hit", () => {
  const features = [
    feature({
      properties: { ...feature().properties, nationalCode: "999999", nationalLevel: "2ndOrder", name_1: "Județul Alba" }
    })
  ];
  const result = matchFeaturesToTerritories(features, [alba]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].territoryId, "alba");
});

test("matches a UAT-level feature by SIRUTA code directly, no parent lookup needed", () => {
  const features = [
    feature({ properties: { ...feature().properties, featureId: "2", nationalCode: "1017", nationalLevel: "3rdOrder" } })
  ];
  const result = matchFeaturesToTerritories(features, [alba, albaIulia]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].territoryId, "alba-iulia");
});

test("resolves a UAT-level feature by name, scoped to its parent county via upperLevelUnit", () => {
  const countyFeature = feature({
    properties: { ...feature().properties, featureId: "10", nationalCode: "10", nationalLevel: "2ndOrder", name_1: "Alba" }
  });
  const uatFeature = feature({
    properties: {
      ...feature().properties,
      featureId: "20",
      nationalCode: "999999",
      nationalLevel: "3rdOrder",
      upperLevelUnit: "10",
      name_1: "Alba Iulia"
    }
  });
  const result = matchFeaturesToTerritories([countyFeature, uatFeature], [alba, albaIulia]);
  assert.equal(result.matched.length, 2);
  const uatMatch = result.matched.find((row) => row.territoryId === "alba-iulia");
  assert.ok(uatMatch);
});

test("does not guess when a scoped name matches more than one UAT in the same county", () => {
  const duplicate = territory({
    territoryId: "alba-iulia-2",
    officialName: "ALBA IULIA (DUPLICAT DE TEST)",
    shortName: "ALBA IULIA",
    territoryType: "commune",
    countyTerritoryId: "alba",
    sirutaCode: null
  });
  const countyFeature = feature({
    properties: { ...feature().properties, featureId: "10", nationalCode: "10", nationalLevel: "2ndOrder", name_1: "Alba" }
  });
  const uatFeature = feature({
    properties: {
      ...feature().properties,
      featureId: "20",
      nationalCode: "999999",
      nationalLevel: "3rdOrder",
      upperLevelUnit: "10",
      name_1: "Alba Iulia"
    }
  });
  const result = matchFeaturesToTerritories([countyFeature, uatFeature], [alba, albaIulia, duplicate]);
  assert.equal(result.matched.length, 1, "only the county itself should match");
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].reason, "no_match");
});

test("reports a conflict instead of overwriting when two distinct features claim the same territory", () => {
  const first = feature({ properties: { ...feature().properties, featureId: "1", OBJECTID: 1, nationalCode: "1017" } });
  const second = feature({ properties: { ...feature().properties, featureId: "2", OBJECTID: 2, nationalCode: "1017" } });
  const result = matchFeaturesToTerritories([first, second], [albaIulia]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].territoryId, "alba-iulia");
});

test("rejects unsupported geometry types", () => {
  const features = [feature({ geometry: { type: "Point", coordinates: [23, 46] } })];
  const result = matchFeaturesToTerritories(features, [alba]);
  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched[0].reason, "unsupported_geometry");
});

test("rejects a geometry with no coordinate points", () => {
  const features = [
    feature({
      properties: { ...feature().properties, nationalCode: "10" },
      geometry: { type: "Polygon", coordinates: [] }
    })
  ];
  const result = matchFeaturesToTerritories(features, [alba]);
  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched[0].reason, "empty_geometry");
});

test("leaves a feature with no code and no name match unmatched", () => {
  const features = [feature()];
  const result = matchFeaturesToTerritories(features, [alba]);
  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched[0].reason, "no_match");
});
