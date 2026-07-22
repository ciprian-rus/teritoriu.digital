import pg from "pg";

import { AcquisitionError } from "./errors.mjs";
import { uuidV7 } from "./uuid-v7.mjs";

function assertSameSnapshot(row, metadata) {
  const same =
    Number(row.size_bytes) === metadata.sizeBytes &&
    row.detected_media_type === metadata.detectedMediaType &&
    row.storage_uri === metadata.storageUri;
  if (!same) {
    throw new AcquisitionError(
      "SNAPSHOT_METADATA_COLLISION",
      "Existing snapshot metadata conflicts with the archived object"
    );
  }
}

export async function registerSnapshot(source, metadata, options = {}) {
  const client =
    options.client ??
    new pg.Client({
      connectionString: options.connectionString,
      application_name: "teritoriu.digital-source-acquisition",
      connectionTimeoutMillis: 15000,
      query_timeout: 20000
    });
  const ownsClient = options.client === undefined;
  let transactionStarted = false;

  try {
    if (ownsClient) await client.connect();
    await client.query("begin");
    transactionStarted = true;

    const sourceResult = await client.query(
      `insert into registry.data_sources (
         source_id, slug, publisher, title, official_url, authority_role,
         license_spdx, expected_frequency, notes
       ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (slug) do update set
         publisher = excluded.publisher,
         title = excluded.title,
         official_url = excluded.official_url,
         authority_role = excluded.authority_role,
         license_spdx = excluded.license_spdx,
         expected_frequency = excluded.expected_frequency
       returning source_id::text`,
      [
        source.sourceId,
        source.slug,
        source.publisher,
        source.title,
        source.datasetUrl,
        source.authorityRole,
        source.licenseSpdx,
        source.expectedFrequency,
        `CKAN resource ${source.resourceId}`
      ]
    );
    if (sourceResult.rows[0].source_id !== source.sourceId) {
      throw new AcquisitionError(
        "SOURCE_ID_CONFLICT",
        "The source slug is already associated with a different persistent ID"
      );
    }

    const insertResult = await client.query(
      `insert into registry.source_snapshots (
         snapshot_id, source_id, retrieved_at, requested_url, resolved_url,
         http_status, declared_media_type, detected_media_type, size_bytes,
         sha256, storage_uri, source_version, status, metadata
       ) values (
         $1::uuid, $2::uuid, $3::timestamptz, $4, $5,
         $6, $7, $8, $9, $10, $11, $12, 'archived', $13::jsonb
       )
       on conflict (source_id, sha256) do nothing
       returning snapshot_id::text, size_bytes, detected_media_type, storage_uri, status`,
      [
        metadata.snapshotId,
        source.sourceId,
        metadata.retrievedAt,
        metadata.requestedUrl,
        metadata.resolvedUrl,
        metadata.httpStatus,
        metadata.declaredMediaType,
        metadata.detectedMediaType,
        metadata.sizeBytes,
        metadata.sha256,
        metadata.storageUri,
        metadata.sourceVersion,
        JSON.stringify(metadata.metadata)
      ]
    );

    let row = insertResult.rows[0];
    let created = true;
    if (!row) {
      created = false;
      const existingResult = await client.query(
        `select snapshot_id::text, size_bytes, detected_media_type, storage_uri, status
           from registry.source_snapshots
          where source_id = $1::uuid and sha256 = $2`,
        [source.sourceId, metadata.sha256]
      );
      row = existingResult.rows[0];
      if (!row) {
        throw new AcquisitionError("SNAPSHOT_RACE", "Snapshot disappeared during registration", {
          retryable: true
        });
      }
    }
    assertSameSnapshot(row, metadata);
    if (row.status === "downloaded") {
      await client.query(
        `update registry.source_snapshots
         set status = 'archived'
         where snapshot_id = $1::uuid and status = 'downloaded'`,
        [row.snapshot_id]
      );
    } else if (row.status !== "archived" && row.status !== "validated") {
      throw new AcquisitionError(
        "SNAPSHOT_STATUS_CONFLICT",
        "Existing snapshot has a state that cannot be promoted to archived"
      );
    }
    await client.query(
      `insert into registry.audit_events (
         audit_event_id, event_type, entity_kind, entity_key, actor, payload
       ) values ($1::uuid, 'source_snapshot_observed', 'source_snapshot', $2, $3, $4::jsonb)`,
      [
        uuidV7(),
        row.snapshot_id,
        "pipeline:source-acquisition",
        JSON.stringify({
          source: source.slug,
          sha256: metadata.sha256,
          sizeBytes: metadata.sizeBytes,
          retrievedAt: metadata.retrievedAt,
          snapshotCreated: created,
          status: "archived"
        })
      ]
    );
    await client.query("commit");
    transactionStarted = false;
    return { created, snapshotId: row.snapshot_id };
  } catch (cause) {
    if (transactionStarted) await client.query("rollback").catch(() => {});
    if (cause instanceof AcquisitionError) throw cause;
    throw new AcquisitionError("SNAPSHOT_REGISTER_FAILED", "Snapshot registration failed", {
      cause,
      retryable: true
    });
  } finally {
    if (ownsClient) await client.end().catch(() => {});
  }
}
