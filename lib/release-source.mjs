import { verifyConsumerRelease } from "../packages/consumer/src/index.mjs";

const REPO = "ciprian-rus/teritoriu.digital";

const BUNDLE_FILES = [
  "SHA256SUMS",
  "contract.json",
  "contract.schema.json",
  "manifest.json",
  "release-manifest.schema.json",
  "territories.json",
  "territories.schema.json",
  "territory.schema.json",
  "territories.ndjson",
  "territories.csv",
  "territory-identifiers.csv",
  "validation-report.json",
  "changelog.json"
];

function pinnedRelease() {
  return {
    releaseTag: process.env.PUBLIC_RELEASE_TAG ?? "siruta-2026.07.23.3",
    releaseId: process.env.PUBLIC_RELEASE_ID ?? "2026.07.23.3",
    manifestSha256:
      process.env.PUBLIC_RELEASE_MANIFEST_SHA256 ??
      "9b236c6992a65420a4f6ab3cb95020a9a76ba0d9de12c756776c6e129bdbbeca"
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
 */
export async function loadVerifiedRelease() {
  if (cachedRelease) return cachedRelease;
  if (inFlight) return inFlight;

  const pin = pinnedRelease();
  inFlight = (async () => {
    const artifacts = new Map();
    for (const name of BUNDLE_FILES) {
      artifacts.set(name, await fetchAsset(pin.releaseTag, name));
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
    // BUNDLE_FILES) — parsing it here doesn't add a fetch or an unverified
    // trust boundary, it just surfaces data that was already checked.
    const changelog = JSON.parse(artifacts.get("changelog.json").toString("utf8"));
    cachedRelease = {
      releaseId: verification.manifest.releaseId,
      releaseTag: pin.releaseTag,
      manifestSha256: verification.manifestSha256,
      schemaVersion: verification.manifest.schemaVersion,
      publishedAt: verification.manifest.publishedAt,
      territories,
      changelog
    };
    return cachedRelease;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
