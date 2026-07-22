import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { verifyReleaseBundle } from "./artifact-builder.mjs";

export const RELEASE_BUNDLE_FILES = Object.freeze([
  "SHA256SUMS",
  "changelog.json",
  "manifest.json",
  "territories.csv",
  "territories.json",
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
  if (JSON.stringify(names) !== JSON.stringify([...RELEASE_BUNDLE_FILES].sort())) {
    throw new Error("Release bundle contains an unexpected file set");
  }
  await mkdir(directory, { recursive: true });
  const created = [];
  for (const name of RELEASE_BUNDLE_FILES) {
    if (await writeOnce(path.join(directory, name), bundle.artifacts.get(name))) created.push(name);
  }
  return { created, reused: RELEASE_BUNDLE_FILES.filter((name) => !created.includes(name)) };
}

export async function readReleaseBundle(directory) {
  const artifacts = new Map();
  for (const name of RELEASE_BUNDLE_FILES) {
    artifacts.set(name, await readFile(path.join(directory, name)));
  }
  const verification = verifyReleaseBundle({ artifacts });
  return { artifacts, ...verification, releaseTag: verification.manifest.releaseTag };
}
