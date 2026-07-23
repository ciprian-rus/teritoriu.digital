import { createHash } from "node:crypto";

import pg from "pg";

import { uuidV7 } from "../acquisition/uuid-v7.mjs";
import { canonicalSha256 } from "../canonical/canonical-json.mjs";
import { verifyReleaseBundle } from "./artifact-builder.mjs";

const { Pool } = pg;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$/;
const RELEASE_LOCK = "teritoriu.digital:release-promotion";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireUuidV7(value, field) {
  if (!UUID_V7.test(value ?? "")) throw new TypeError(`${field} must be a lowercase UUIDv7`);
}

function requireHash(value, field) {
  if (!SHA256.test(value ?? "")) throw new TypeError(`${field} must be a lowercase SHA-256`);
}

function requireActor(value) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("actor is required");
  return value.trim();
}

function requireRationale(value) {
  if (typeof value !== "string" || value.trim().length < 10) {
    throw new TypeError("rationale must contain at least 10 characters");
  }
  return value.trim();
}

function asIso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) fail("RELEASE_CONTEXT_INVALID", `${field} is not a valid timestamp`);
  return date.toISOString();
}

function chunks(values, size = 500) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function withClient(options, operation) {
  const ownedPool = options.client ? null : new Pool({ connectionString: options.connectionString });
  let client = options.client;
  try {
    client ??= await ownedPool.connect();
    return await operation(client);
  } finally {
    if (ownedPool) {
      client?.release();
      await ownedPool.end();
    }
  }
}

export async function approveSirutaCandidate(input, options = {}) {
  requireUuidV7(input.importRunId, "importRunId");
  requireHash(input.candidateSha256, "candidateSha256");
  const actor = requireActor(input.actor);
  const rationale = requireRationale(input.rationale);
  const uuidFactory = options.uuidFactory ?? uuidV7;

  return withClient(options, async (client) => {
    await client.query("begin");
    try {
      const runResult = await client.query(
        `select import_run_id::text, status, summary
         from registry.import_runs
         where import_run_id = $1::registry.uuid_v7
         for update`,
        [input.importRunId]
      );
      const run = runResult.rows[0];
      if (!run) fail("IMPORT_RUN_NOT_FOUND", "The candidate import run does not exist");
      if (!new Set(["review", "approved"]).has(run.status)) {
        fail("IMPORT_RUN_NOT_REVIEWABLE", `Import run status ${run.status} cannot be approved`);
      }
      if (run.summary?.candidateSha256 !== input.candidateSha256) {
        fail("CANDIDATE_HASH_MISMATCH", "The reviewed candidate SHA-256 differs from the staged summary");
      }

      const findingResult = await client.query(
        `select count(*)::integer as blocking_count
         from registry.validation_findings
         where import_run_id = $1::registry.uuid_v7
           and severity in ('error', 'blocker')`,
        [input.importRunId]
      );
      if (Number(findingResult.rows[0]?.blocking_count ?? 0) !== 0) {
        fail("CANDIDATE_HAS_BLOCKERS", "A candidate with error or blocker findings cannot be approved");
      }

      const decisionResult = await client.query(
        `select
           count(*)::integer as decision_count,
           count(*) filter (where decision in ('matched', 'create'))::integer as resolved_count,
           (select count(*)::integer
              from registry.staging_records
             where import_run_id = $1::registry.uuid_v7 and parse_status = 'parsed') as staging_count
         from registry.identity_decisions
         where import_run_id = $1::registry.uuid_v7`,
        [input.importRunId]
      );
      const decisions = decisionResult.rows[0] ?? {};
      if (
        Number(decisions.decision_count) === 0 ||
        Number(decisions.decision_count) !== Number(decisions.resolved_count) ||
        Number(decisions.decision_count) !== Number(decisions.staging_count)
      ) {
        fail("IDENTITY_REVIEW_INCOMPLETE", "Every parsed row must have exactly one resolved identity decision");
      }

      const existingResult = await client.query(
        `select candidate_sha256::text, approved_by, approved_at, rationale
         from registry.release_candidate_approvals
         where import_run_id = $1::registry.uuid_v7`,
        [input.importRunId]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.candidate_sha256 !== input.candidateSha256) {
          fail("APPROVAL_COLLISION", "The import run is already approved for different candidate bytes");
        }
        await client.query("commit");
        return {
          created: false,
          importRunId: input.importRunId,
          candidateSha256: existing.candidate_sha256,
          approvedBy: existing.approved_by,
          approvedAt: asIso(existing.approved_at, "approvedAt")
        };
      }

      const approvalId = uuidFactory();
      requireUuidV7(approvalId, "approvalId");
      const approvedAt = asIso(options.now?.() ?? new Date(), "approvedAt");
      await client.query(
        `insert into registry.release_candidate_approvals (
           approval_id, import_run_id, candidate_sha256, approved_by, approved_at, rationale
         ) values ($1, $2, $3, $4, $5, $6)`,
        [approvalId, input.importRunId, input.candidateSha256, actor, approvedAt, rationale]
      );
      await client.query(
        `update registry.import_runs
         set status = 'approved'
         where import_run_id = $1::registry.uuid_v7`,
        [input.importRunId]
      );
      await client.query(
        `insert into registry.audit_events (
           audit_event_id, event_type, entity_kind, entity_key, actor, payload
         ) values ($1, 'siruta_candidate_approved', 'import_run', $2, $3, $4::jsonb)`,
        [
          uuidFactory(),
          input.importRunId,
          actor,
          JSON.stringify({ candidateSha256: input.candidateSha256, rationale })
        ]
      );
      await client.query("commit");
      return {
        created: true,
        approvalId,
        importRunId: input.importRunId,
        candidateSha256: input.candidateSha256,
        approvedBy: actor,
        approvedAt
      };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
}

export async function loadApprovedSirutaContext(client, importRunId) {
  requireUuidV7(importRunId, "importRunId");
  const result = await client.query(
    `select
       run.import_run_id::text,
       run.snapshot_id::text,
       run.pipeline_commit,
       run.parser_version,
       run.status as import_status,
       run.summary,
       approval.candidate_sha256::text,
       approval.approved_by,
       approval.approved_at,
       approval.rationale,
       snapshot.sha256::text as source_sha256,
       snapshot.size_bytes,
       snapshot.retrieved_at,
       snapshot.resolved_url,
       source.slug as source_slug,
       source.publisher
     from registry.import_runs run
     join registry.release_candidate_approvals approval using (import_run_id)
     join registry.source_snapshots snapshot using (snapshot_id)
     join registry.data_sources source using (source_id)
     where run.import_run_id = $1::registry.uuid_v7`,
    [importRunId]
  );
  const row = result.rows[0];
  if (!row) fail("APPROVED_IMPORT_NOT_FOUND", "No approved SIRUTA import matches the requested ID");
  if (!new Set(["approved", "completed"]).has(row.import_status)) {
    fail("APPROVED_IMPORT_STATUS_INVALID", "The import run is not approved for release");
  }
  if (row.summary?.candidateSha256 !== row.candidate_sha256) {
    fail("APPROVED_CANDIDATE_DRIFT", "The immutable approval differs from the staged candidate summary");
  }
  return {
    importRunId: row.import_run_id,
    snapshotId: row.snapshot_id,
    pipelineCommit: row.pipeline_commit,
    transformationVersion: row.parser_version,
    importStatus: row.import_status,
    candidateSha256: row.candidate_sha256,
    approval: {
      importRunId: row.import_run_id,
      candidateSha256: row.candidate_sha256,
      approvedBy: row.approved_by,
      approvedAt: asIso(row.approved_at, "approvedAt"),
      rationale: row.rationale
    },
    source: {
      snapshotId: row.snapshot_id,
      sha256: row.source_sha256,
      sizeBytes: Number(row.size_bytes),
      retrievedAt: asIso(row.retrieved_at, "retrievedAt"),
      uri: row.resolved_url,
      slug: row.source_slug,
      publisher: row.publisher
    }
  };
}

function decisionTarget(decision) {
  if (decision.decision === "matched") return decision.candidate_territory_id;
  if (decision.decision === "create") return decision.proposed_territory_id;
  return null;
}

function publicArtifactRows(manifest, bundleArtifacts, uuidFactory) {
  const mediaTypes = new Map(manifest.artifacts.map((item) => [item.name, item.mediaType]));
  mediaTypes.set("manifest.json", "application/json");
  mediaTypes.set("SHA256SUMS", "text/plain; charset=utf-8");
  const example = manifest.artifacts[0];
  const baseUri = example.uri.slice(0, -(example.name.length + 1));
  return [...bundleArtifacts.entries()].map(([name, bytes]) => ({
    artifact_id: uuidFactory(),
    name,
    media_type: mediaTypes.get(name),
    size_bytes: bytes.length,
    sha256: manifest.artifacts.find((item) => item.name === name)?.sha256 ?? createHashForBytes(bytes),
    storage_uri: `${baseUri}/${name}`
  }));
}

function createHashForBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identifierRows(candidate, releaseId, uuidFactory) {
  return candidate.territories.flatMap((territory) =>
    territory.identifiers.map((identifier) => ({
      identifier_id: uuidFactory(),
      territory_id: territory.territoryId,
      scheme: identifier.scheme,
      issuer: identifier.scheme === "ro.ins.siruta" ? "ro.ins" : "eu.eurostat",
      identifier_type: identifier.scheme === "ro.ins.siruta" ? "statistical_territory_code" : "nuts_code",
      value: identifier.value,
      status: identifier.status,
      valid_from: identifier.validFrom,
      valid_to: identifier.validTo,
      source_snapshot_id: territory.provenance.sourceSnapshotId,
      release_id: releaseId
    }))
  );
}

function revisionRows(candidate, releaseId, uuidFactory) {
  return candidate.territories.map((territory) => ({
    revision_id: uuidFactory(),
    territory_id: territory.territoryId,
    official_name: territory.officialName,
    normalized_name: territory.normalizedName,
    short_name: territory.shortName,
    territory_type: territory.territoryType,
    administrative_role: territory.administrativeRole,
    administrative_level: territory.administrativeLevel,
    parent_territory_id: territory.parentTerritoryId,
    county_territory_id: territory.countyTerritoryId,
    is_uat: territory.isUat,
    is_locality: territory.isLocality,
    is_county_seat: territory.isCountySeat,
    rank: territory.rank,
    status: territory.status,
    valid_from: territory.validFrom,
    valid_to: territory.validTo,
    source_snapshot_id: territory.provenance.sourceSnapshotId,
    source_record_hash: territory.provenance.sourceRecordHash,
    transformation_version: territory.provenance.transformationVersion,
    release_id: releaseId,
    metadata: {
      releaseId,
      ...(territory.provenance.sourceCorrections
        ? { sourceCorrections: territory.provenance.sourceCorrections }
        : {})
    }
  }));
}

function validatePromotionInput(input) {
  if (!RELEASE_ID.test(input.manifest?.releaseId ?? "")) throw new TypeError("manifest.releaseId is invalid");
  requireUuidV7(input.importRunId, "importRunId");
  requireHash(input.manifestSha256, "manifestSha256");
  const actor = requireActor(input.actor);
  const rationale = requireRationale(input.rationale);
  if (!input.candidate || canonicalSha256(input.candidate) !== input.manifest.candidateSha256) {
    fail("PROMOTION_CANDIDATE_MISMATCH", "The release manifest does not match the candidate payload");
  }
  if (!(input.bundleArtifacts instanceof Map) || input.bundleArtifacts.size < 6) {
    fail("PROMOTION_ARTIFACTS_MISSING", "The verified release bundle is required for promotion");
  }
  const verification = verifyReleaseBundle({ artifacts: input.bundleArtifacts });
  if (
    verification.manifestSha256 !== input.manifestSha256 ||
    verification.manifest.releaseId !== input.manifest.releaseId
  ) fail("PROMOTION_BUNDLE_MISMATCH", "The release bundle differs from the supplied manifest metadata");
  return { actor, rationale };
}

export async function promoteSirutaRelease(input, options = {}) {
  const { actor, rationale } = validatePromotionInput(input);
  const uuidFactory = options.uuidFactory ?? uuidV7;
  const manifest = input.manifest;
  const candidate = input.candidate;

  return withClient(options, async (client) => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [RELEASE_LOCK]);
      const existingResult = await client.query(
        `select release_id, status, manifest_sha256::text
         from registry.releases
         where release_id = $1
         for update`,
        [manifest.releaseId]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.status === "published" && existing.manifest_sha256 === input.manifestSha256) {
          await client.query("commit");
          return { created: false, releaseId: manifest.releaseId, status: "published" };
        }
        fail("RELEASE_ID_COLLISION", "The release ID already exists with different state or bytes");
      }
      if (options.requireExistingPromotion) {
        fail(
          "PUBLIC_RELEASE_WITHOUT_PROMOTION",
          "A public GitHub release cannot initiate a missing database promotion"
        );
      }

      const context = await loadApprovedSirutaContext(client, input.importRunId);
      if (context.importStatus !== "approved") {
        fail("IMPORT_ALREADY_RELEASED", "A completed import run cannot publish another release");
      }
      if (
        context.candidateSha256 !== manifest.candidateSha256 ||
        context.snapshotId !== candidate.sourceSnapshotId ||
        context.source.sha256 !== candidate.sourceSha256 ||
        context.pipelineCommit !== manifest.pipelineCommit
      ) {
        fail("RELEASE_CONTEXT_DRIFT", "The release differs from its approved import context");
      }
      if (
        manifest.approval.importRunId !== context.importRunId ||
        manifest.approval.candidateSha256 !== context.candidateSha256 ||
        manifest.approval.approvedBy !== context.approval.approvedBy ||
        manifest.approval.approvedAt !== context.approval.approvedAt ||
        manifest.approval.rationale !== context.approval.rationale
      ) {
        fail("RELEASE_APPROVAL_DRIFT", "The public manifest does not reproduce the immutable approval");
      }

      const channelResult = await client.query(
        `select channel, release_id
         from registry.release_channels
         where channel = 'stable'
         for update`
      );
      const previousReleaseId = channelResult.rows[0]?.release_id ?? null;
      if (previousReleaseId !== manifest.previousReleaseId) {
        fail("STABLE_CHANNEL_DRIFT", "The manifest previousReleaseId differs from the current stable channel");
      }
      if (previousReleaseId) {
        const previousResult = await client.query(
          `select published_at
           from registry.releases
           where release_id = $1 and status = 'published'`,
          [previousReleaseId]
        );
        if (!previousResult.rows[0] || new Date(previousResult.rows[0].published_at) >= new Date(manifest.publishedAt)) {
          fail("RELEASE_TIME_INVALID", "The new release must be later than the current stable release");
        }
      }

      const decisionResult = await client.query(
        `select source_record_key, decision,
                candidate_territory_id::text, proposed_territory_id::text
         from registry.identity_decisions
         where import_run_id = $1::registry.uuid_v7
         order by source_record_key::integer`,
        [input.importRunId]
      );
      const decisions = new Map(decisionResult.rows.map((item) => [item.source_record_key, item]));
      if (decisions.size !== candidate.territories.length) {
        fail("PROMOTION_DECISIONS_INCOMPLETE", "Candidate and approved identity-decision counts differ");
      }
      for (const territory of candidate.territories) {
        const siruta = territory.identifiers.find((item) => item.scheme === "ro.ins.siruta")?.value;
        const decision = decisions.get(siruta);
        if (!decision || decisionTarget(decision) !== territory.territoryId) {
          fail("PROMOTION_IDENTITY_MISMATCH", `Approved identity decision differs for SIRUTA ${siruta}`);
        }
      }

      const proposedTerritoryIds = decisionResult.rows
        .filter((item) => item.decision === "create")
        .map((item) => item.proposed_territory_id);
      for (const batch of chunks(proposedTerritoryIds)) {
        const conflicts = await client.query(
          `select territory_id::text
           from registry.territories
           where territory_id in (
             select value::registry.uuid_v7 from jsonb_array_elements_text($1::jsonb)
           )`,
          [JSON.stringify(batch)]
        );
        if (conflicts.rows.length > 0) {
          fail("PROMOTION_PROPOSED_ID_COLLISION", "A proposed UUIDv7 already belongs to a canonical territory");
        }
      }

      const matchedDecisions = decisionResult.rows.filter((item) => item.decision === "matched");
      for (const batch of chunks(matchedDecisions)) {
        const matches = await client.query(
          `select item.source_record_key, identifier.territory_id::text
           from jsonb_to_recordset($1::jsonb) as item(
             source_record_key text, candidate_territory_id text
           )
           join registry.territory_identifiers identifier
             on identifier.scheme = 'ro.ins.siruta'
            and identifier.value = item.source_record_key
            and identifier.status = 'active'
            and identifier.valid_to is null
            and identifier.territory_id = item.candidate_territory_id::registry.uuid_v7`,
          [JSON.stringify(batch)]
        );
        if (matches.rows.length !== batch.length) {
          fail("PROMOTION_MATCHED_IDENTITY_MISSING", "A matched identity is not active in the canonical registry");
        }
      }

      await client.query(
        `insert into registry.releases (
           release_id, schema_version, import_run_id, previous_release_id,
           status, approved_by, approved_at
         ) values ($1, $2, $3, $4, 'approved', $5, $6)`,
        [
          manifest.releaseId,
          manifest.schemaVersion,
          input.importRunId,
          manifest.previousReleaseId,
          context.approval.approvedBy,
          context.approval.approvedAt
        ]
      );

      for (const batch of chunks(candidate.territories.map((item) => ({
        territory_id: item.territoryId,
        lifecycle_status: item.status
      })))) {
        await client.query(
          `insert into registry.territories (territory_id, lifecycle_status)
           select item.territory_id::registry.uuid_v7, item.lifecycle_status
           from jsonb_to_recordset($1::jsonb) as item(territory_id text, lifecycle_status text)
           on conflict (territory_id) do update
             set lifecycle_status = excluded.lifecycle_status`,
          [JSON.stringify(batch)]
        );
      }

      for (const batch of chunks(candidate.territories.map((item) => item.territoryId))) {
        await client.query(
          `update registry.territory_revisions
           set recorded_to = $2::timestamptz
           where recorded_to is null
             and territory_id in (
               select value::registry.uuid_v7 from jsonb_array_elements_text($1::jsonb)
             )`,
          [JSON.stringify(batch), manifest.publishedAt]
        );
      }

      for (const batch of chunks(revisionRows(candidate, manifest.releaseId, uuidFactory))) {
        await client.query(
          `insert into registry.territory_revisions (
             revision_id, territory_id, official_name, normalized_name, short_name,
             territory_type, administrative_role, administrative_level,
             parent_territory_id, county_territory_id, is_uat, is_locality,
             is_county_seat, rank, status, valid_from, valid_to, recorded_at,
             source_snapshot_id, source_record_hash, transformation_version,
             release_id, metadata
           )
           select
             item.revision_id::registry.uuid_v7, item.territory_id::registry.uuid_v7,
             item.official_name, item.normalized_name, item.short_name,
             item.territory_type, item.administrative_role, item.administrative_level,
             nullif(item.parent_territory_id, '')::registry.uuid_v7,
             nullif(item.county_territory_id, '')::registry.uuid_v7,
             item.is_uat, item.is_locality, item.is_county_seat, item.rank,
             item.status, item.valid_from, item.valid_to, $2::timestamptz,
             item.source_snapshot_id::registry.uuid_v7,
             item.source_record_hash::registry.sha256_hex,
             item.transformation_version, item.release_id, item.metadata
           from jsonb_to_recordset($1::jsonb) as item(
             revision_id text, territory_id text, official_name text, normalized_name text,
             short_name text, territory_type text, administrative_role text,
             administrative_level smallint, parent_territory_id text,
             county_territory_id text, is_uat boolean, is_locality boolean,
             is_county_seat boolean, rank smallint, status text, valid_from date,
             valid_to date, source_snapshot_id text, source_record_hash text,
             transformation_version text, release_id text, metadata jsonb
           )`,
          [JSON.stringify(batch.map((item) => ({
            ...item,
            parent_territory_id: item.parent_territory_id ?? "",
            county_territory_id: item.county_territory_id ?? ""
          }))), manifest.publishedAt]
        );
      }

      for (const batch of chunks(identifierRows(candidate, manifest.releaseId, uuidFactory))) {
        const conflicts = await client.query(
          `select existing.scheme, existing.value, existing.territory_id::text
           from registry.territory_identifiers existing
           join jsonb_to_recordset($1::jsonb) as item(scheme text, value text, territory_id text)
             on existing.scheme = item.scheme
            and existing.value = item.value
            and existing.valid_from is null
           where existing.territory_id <> item.territory_id::registry.uuid_v7`,
          [JSON.stringify(batch)]
        );
        if (conflicts.rows.length > 0) {
          fail("PROMOTION_IDENTIFIER_CONFLICT", "An identifier is already assigned to a different territory");
        }
        await client.query(
          `insert into registry.territory_identifiers (
             identifier_id, territory_id, scheme, issuer, identifier_type, value,
             status, valid_from, valid_to, source_snapshot_id, release_id
           )
           select
             item.identifier_id::registry.uuid_v7, item.territory_id::registry.uuid_v7,
             item.scheme, item.issuer, item.identifier_type, item.value, item.status,
             item.valid_from, item.valid_to,
             item.source_snapshot_id::registry.uuid_v7, item.release_id
           from jsonb_to_recordset($1::jsonb) as item(
             identifier_id text, territory_id text, scheme text, issuer text,
             identifier_type text, value text, status text, valid_from date,
             valid_to date, source_snapshot_id text, release_id text
           )
           where not exists (
             select 1 from registry.territory_identifiers existing
             where existing.scheme = item.scheme
               and existing.value = item.value
               and existing.valid_from is not distinct from item.valid_from
           )`,
          [JSON.stringify(batch)]
        );
      }

      const artifactRows = publicArtifactRows(manifest, input.bundleArtifacts, uuidFactory);
      for (const artifact of artifactRows) {
        requireUuidV7(artifact.artifact_id, "artifactId");
        requireHash(artifact.sha256, `artifact ${artifact.name}`);
      }
      for (const batch of chunks(artifactRows)) {
        await client.query(
          `insert into registry.release_artifacts (
             artifact_id, release_id, name, media_type, size_bytes, sha256, storage_uri
           )
           select
             item.artifact_id::registry.uuid_v7, $1, item.name, item.media_type,
             item.size_bytes, item.sha256::registry.sha256_hex, item.storage_uri
           from jsonb_to_recordset($2::jsonb) as item(
             artifact_id text, name text, media_type text, size_bytes bigint,
             sha256 text, storage_uri text
           )`,
          [manifest.releaseId, JSON.stringify(batch)]
        );
      }

      await client.query(
        `update registry.releases
         set status = 'published', manifest_sha256 = $2, published_at = $3
         where release_id = $1`,
        [manifest.releaseId, input.manifestSha256, manifest.publishedAt]
      );
      await client.query(
        `insert into registry.release_channels (channel, release_id, changed_by, changed_at)
         values ('stable', $1, $2, $3)
         on conflict (channel) do update set
           release_id = excluded.release_id,
           changed_by = excluded.changed_by,
           changed_at = excluded.changed_at`,
        [manifest.releaseId, actor, manifest.publishedAt]
      );
      await client.query(
        `insert into registry.release_channel_events (
           channel_event_id, channel, previous_release_id, release_id,
           event_type, changed_by, rationale, changed_at
         ) values ($1, 'stable', $2, $3, 'publish', $4, $5, $6)`,
        [uuidFactory(), previousReleaseId, manifest.releaseId, actor, rationale, manifest.publishedAt]
      );
      await client.query(
        `update registry.import_runs
         set status = 'completed'
         where import_run_id = $1::registry.uuid_v7`,
        [input.importRunId]
      );
      await client.query(
        `insert into registry.audit_events (
           audit_event_id, event_type, entity_kind, entity_key, actor, payload
         ) values ($1, 'siruta_release_published', 'release', $2, $3, $4::jsonb)`,
        [
          uuidFactory(),
          manifest.releaseId,
          actor,
          JSON.stringify({
            manifestSha256: input.manifestSha256,
            previousReleaseId,
            candidateSha256: manifest.candidateSha256,
            rationale
          })
        ]
      );
      await client.query("commit");
      return { created: true, releaseId: manifest.releaseId, status: "published", previousReleaseId };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
}

export async function moveStableReleaseChannel(input, options = {}) {
  if (!RELEASE_ID.test(input.releaseId ?? "")) throw new TypeError("releaseId is invalid");
  const actor = requireActor(input.actor);
  const rationale = requireRationale(input.rationale);
  const uuidFactory = options.uuidFactory ?? uuidV7;
  return withClient(options, async (client) => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [RELEASE_LOCK]);
      const targetResult = await client.query(
        `select release_id, status, published_at
         from registry.releases
         where release_id = $1`,
        [input.releaseId]
      );
      const target = targetResult.rows[0];
      if (!target || target.status !== "published") {
        fail("ROLLBACK_TARGET_INVALID", "Stable can move only to an existing published release");
      }
      const currentResult = await client.query(
        `select channel.release_id, release.published_at
         from registry.release_channels channel
         join registry.releases release using (release_id)
         where channel.channel = 'stable'
         for update of channel`,
      );
      const current = currentResult.rows[0];
      if (!current) fail("STABLE_CHANNEL_MISSING", "The stable channel has not been initialized");
      if (current.release_id === input.releaseId) {
        await client.query("commit");
        return { changed: false, releaseId: input.releaseId };
      }
      const eventType = new Date(target.published_at) < new Date(current.published_at) ? "rollback" : "promote";
      const changedAt = asIso(options.now?.() ?? new Date(), "changedAt");
      await client.query(
        `update registry.release_channels
         set release_id = $1, changed_by = $2, changed_at = $3
         where channel = 'stable'`,
        [input.releaseId, actor, changedAt]
      );
      await client.query(
        `insert into registry.release_channel_events (
           channel_event_id, channel, previous_release_id, release_id,
           event_type, changed_by, rationale, changed_at
         ) values ($1, 'stable', $2, $3, $4, $5, $6, $7)`,
        [uuidFactory(), current.release_id, input.releaseId, eventType, actor, rationale, changedAt]
      );
      await client.query(
        `insert into registry.audit_events (
           audit_event_id, event_type, entity_kind, entity_key, actor, payload
         ) values ($1, $2, 'release_channel', 'stable', $3, $4::jsonb)`,
        [
          uuidFactory(),
          `release_channel_${eventType}`,
          actor,
          JSON.stringify({ from: current.release_id, to: input.releaseId, rationale })
        ]
      );
      await client.query("commit");
      return { changed: true, eventType, from: current.release_id, releaseId: input.releaseId };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
}
