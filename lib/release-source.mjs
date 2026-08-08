import { verifyConsumerRelease } from "../packages/consumer/src/index.mjs";

const REPO = "ciprian-rus/teritoriu.digital";

function pinnedRelease() {
  return {
    releaseTag: process.env.PUBLIC_RELEASE_TAG ?? "siruta-2026.08.07.1",
    releaseId: process.env.PUBLIC_RELEASE_ID ?? "2026.08.07.1",
    manifestSha256:
      process.env.PUBLIC_RELEASE_MANIFEST_SHA256 ??
      "5312911cf6f81eb4a392f4a02abb7d93f3bbf51b88af6a4fc9e16879f13d0e1f"
  };
}

async function fetchAsset(releaseTag, name) {
  const url = `https://github.com/${REPO}/releases/download/${releaseTag}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch release asset ${name}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

let cachedRelease = null;
let inFlight = null;

/**
 * Fetches the pinned public release bundle from GitHub Releases (never Supabase,
 * never data.gov.ro) and verifies it through the same fail-closed consumer contract
 * every other consumer uses, before serving a single record. Cached in module scope
 * for the lifetime of the serverless instance.
 *
 * The file set is read from manifest.json itself (not a hardcoded list) —
 * this release predates M6's optional territory-geometries.geojson, but a
 * future PUBLIC_RELEASE_TAG that includes it needs no code change here to
 * start serving it.
 */
export async function loadVerifiedRelease() {
  if (cachedRelease) return cachedRelease;
  if (inFlight) return inFlight;

  const pin = pinnedRelease();
  inFlight = (async () => {
    const artifacts = new Map();
    artifacts.set("manifest.json", await fetchAsset(pin.releaseTag, "manifest.json"));
    const manifest = JSON.parse(artifacts.get("manifest.json").toString("utf8"));
    const fileNames = new Set(["SHA256SUMS", "manifest.json", ...manifest.artifacts.map((item) => item.name)]);
    for (const name of fileNames) {
      if (!artifacts.has(name)) artifacts.set(name, await fetchAsset(pin.releaseTag, name));
    }
    const verification = verifyConsumerRelease(
      { artifacts },
      { expectedReleaseId: pin.releaseId, expectedManifestSha256: pin.manifestSha256 }
    );
    // Pre-sorted once here, by the same territoryId order searchTerritories
    // sorts by on every call: V8's TimSort is adaptive, so re-sorting an
    // already-sorted array costs ~O(n) instead of O(n log n), turning a
    // repeated per-request cost into a one-time load-time cost.
    const territories = verification.payload.territories.slice().sort((a, b) =>
      a.territoryId < b.territoryId ? -1 : a.territoryId > b.territoryId ? 1 : 0
    );
    // changelog.json is already fetched above and its checksum already
    // verified against SHA256SUMS by verifyConsumerRelease (it's one of the
    // bundle files) — parsing it here doesn't add a fetch or an unverified
    // trust boundary, it just surfaces data that was already checked.
    const changelog = JSON.parse(artifacts.get("changelog.json").toString("utf8"));
    const geometriesByTerritoryId = artifacts.has("territory-geometries.geojson")
      ? new Map(
          JSON.parse(artifacts.get("territory-geometries.geojson").toString("utf8")).features.map((feature) => [
            feature.properties.territoryId,
            feature.geometry
          ])
        )
      : null;
    cachedRelease = {
      releaseId: verification.manifest.releaseId,
      releaseTag: pin.releaseTag,
      manifestSha256: verification.manifestSha256,
      schemaVersion: verification.manifest.schemaVersion,
      publishedAt: verification.manifest.publishedAt,
      territories,
      changelog,
      geometriesByTerritoryId
    };
    return cachedRelease;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
