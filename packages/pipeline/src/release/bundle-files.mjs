import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { verifyReleaseBundle } from "./artifact-builder.mjs";

// The baseline files every release has, regardless of which optional
// artifacts (e.g. territory-geometries.geojson) it also declares.
// writeReleaseBundle/readReleaseBundle derive the actual file set from the
// bundle itself (contract.json's own declared artifacts, self-consistently
// checked by verifyReleaseBundle) rather than this fixed list, so an
// optional artifact doesn't need a matching change here.
export const RELEASE_BUNDLE_FILES = Object.freeze([
  "SHA256SUMS",
  "changelog.json",
  "contract.json",
  "contract.schema.json",
  "manifest.json",
  "release-manifest.schema.json",
  "territories.csv",
  "territories.json",
  "territories.ndjson",
  "territories.schema.json",
  "territory-identifiers.csv",
  "territory.schema.json",
  "validation-report.json"
]);

async function writeOnce(filePath, bytes) {
  try {
    const existing = await readFile(filePath);
    if (!existing.equals(bytes)) throw new Error(`Existing release artifact differs: ${path.basename(filePath)}`);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handle = await open(filePath, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

export async function writeReleaseBundle(directory, bundle) {
  verifyReleaseBundle(bundle);
  const names = [...bundle.artifacts.keys()].sort();
  await mkdir(directory, { recursive: true });
  const created = [];
  for (const name of names) {
    if (await writeOnce(path.join(directory, name), bundle.artifacts.get(name))) created.push(name);
  }
  return { created, reused: names.filter((name) => !created.includes(name)) };
}

export async function readReleaseBundle(directory) {
  const manifestBytes = await readFile(path.join(directory, "manifest.json"));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!Array.isArray(manifest.artifacts)) throw new Error("manifest.json lacks an artifacts list");
  const names = new Set(["manifest.json", "SHA256SUMS", ...manifest.artifacts.map((item) => item.name)]);
  const artifacts = new Map();
  for (const name of names) {
    artifacts.set(name, await readFile(path.join(directory, name)));
  }
  const verification = verifyReleaseBundle({ artifacts });
  return { artifacts, ...verification, releaseTag: verification.manifest.releaseTag };
}
