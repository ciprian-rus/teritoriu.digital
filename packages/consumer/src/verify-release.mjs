import {
  assertPublicContractCompatibility,
  PUBLIC_CONTRACT_NAME,
  verifyReleaseBundle
} from "../../pipeline/src/release/artifact-builder.mjs";

const SHA256 = /^[0-9a-f]{64}$/;

function rejectedCount(bundle) {
  try {
    const payload = JSON.parse(bundle.artifacts.get("territories.json").toString("utf8"));
    return Array.isArray(payload.territories) ? payload.territories.length : 1;
  } catch {
    return 1;
  }
}

function conflictCount(error) {
  return /conflict|cycle|duplicate|unresolved|unknown parent/i.test(error.message) ? 1 : 0;
}

export const SUPPORTED_PUBLIC_CONTRACT = Object.freeze({
  name: PUBLIC_CONTRACT_NAME,
  major: 1,
  territorySchemaMajor: 1
});

export function assertConsumerCompatibility(contract, manifest = null) {
  assertPublicContractCompatibility(contract, manifest);
  return SUPPORTED_PUBLIC_CONTRACT;
}

export function verifyConsumerRelease(bundle, options = {}) {
  try {
    const verification = verifyReleaseBundle(bundle);
    assertConsumerCompatibility(verification.contract, verification.manifest);
    if (
      options.expectedReleaseId !== undefined &&
      verification.manifest.releaseId !== options.expectedReleaseId
    ) {
      throw new Error("releaseId differs from the consumer pin");
    }
    if (options.expectedManifestSha256 !== undefined) {
      if (!SHA256.test(options.expectedManifestSha256)) {
        throw new Error("expectedManifestSha256 must be a lowercase SHA-256");
      }
      if (verification.manifestSha256 !== options.expectedManifestSha256) {
        throw new Error("manifest SHA-256 differs from the consumer pin");
      }
    }
    return {
      ...verification,
      report: {
        status: "accepted",
        accepted: verification.payload.territories.length,
        rejected: 0,
        conflicts: 0,
        releaseId: verification.manifest.releaseId,
        manifestSha256: verification.manifestSha256,
        contractVersion: verification.contract.contractVersion,
        schemaVersion: verification.manifest.schemaVersion,
        errors: []
      }
    };
  } catch (error) {
    error.code ??= "CONSUMER_CONTRACT_REJECTED";
    error.report = {
      status: "rejected",
      accepted: 0,
      rejected: rejectedCount(bundle),
      conflicts: conflictCount(error),
      releaseId: null,
      manifestSha256: null,
      contractVersion: null,
      schemaVersion: null,
      errors: [{ code: error.code, message: error.message }]
    };
    throw error;
  }
}
