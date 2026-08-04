import { createHash } from "node:crypto";

/**
 * Serializes fetched ANCPI features into a deterministic byte payload, so
 * two runs against unchanged source data produce the same SHA-256 and are
 * recognized as the same snapshot by registerSnapshot's (source_id, sha256)
 * uniqueness — sorted by OBJECTID, since ArcGIS doesn't guarantee response
 * order across paginated queries.
 */
export function serializeFeatures(features) {
  const sorted = [...features].sort((a, b) => {
    const left = Number(a?.properties?.OBJECTID ?? 0);
    const right = Number(b?.properties?.OBJECTID ?? 0);
    return left - right;
  });
  return Buffer.from(`${JSON.stringify(sorted)}\n`, "utf8");
}

/**
 * Builds a "download" object shaped exactly like downloadSnapshot()'s
 * return value, so the existing snapshotMetadata/archiveLocally/
 * archiveInSupabase/registerSnapshot machinery (built for single-file CKAN
 * downloads) can register this paginated API fetch's result with the same
 * provenance guarantees, unmodified.
 */
export function buildDownloadResult(fetchResult) {
  const bytes = serializeFeatures(fetchResult.features);
  return {
    bytes,
    requestedUrl: fetchResult.requestedUrl,
    resolvedUrl: fetchResult.resolvedUrl,
    httpStatus: 200,
    headers: {},
    redirectChain: [],
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    detectedMediaType: "application/json",
    declaredMediaType: "application/json",
    declaredTypeMismatch: false,
    attempts: fetchResult.attempts,
    discovery: { objectCount: fetchResult.objectCount }
  };
}
