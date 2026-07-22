import pg from "pg";

import { uuidV7 } from "../acquisition/uuid-v7.mjs";

const { Pool } = pg;

function chunks(values, size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function requireUuid(value, field) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new TypeError(`${field} must be a UUIDv7`);
  }
}

export async function loadSirutaIdentityIndex(client) {
  const result = await client.query(`
    select
      identifier.value,
      identifier.territory_id::text as territory_id,
      identifier.status,
      identifier.valid_to,
      'identifier'::text as origin
    from registry.territory_identifiers identifier
    where identifier.scheme = 'ro.ins.siruta'
    union all
    select
      decision.source_record_key as value,
      decision.proposed_territory_id::text as territory_id,
      'proposed'::text as status,
      null::date as valid_to,
      'proposal'::text as origin
    from registry.identity_decisions decision
    join registry.import_runs run using (import_run_id)
    where decision.decision = 'create'
      and decision.proposed_territory_id is not null
      and run.status in ('review', 'approved', 'completed')
    order by value, territory_id, origin
  `);
  const index = {};
  for (const row of result.rows) {
    index[row.value] ??= [];
    index[row.value].push({
      territoryId: row.territory_id,
      status: row.status,
      validTo: row.valid_to,
      origin: row.origin
    });
  }
  return index;
}

export async function stageSirutaImport(metadata, buildResult, options = {}) {
  requireUuid(metadata.importRunId, "importRunId");
  requireUuid(metadata.snapshotId, "snapshotId");
  if (!/^[0-9a-f]{64}$/.test(metadata.idempotencyKey)) {
    throw new TypeError("idempotencyKey must be a lowercase SHA-256");
  }
  if (!/^[0-9a-f]{40}$/.test(metadata.pipelineCommit)) {
    throw new TypeError("pipelineCommit must be a 40-character Git commit SHA");
  }
  if (!new Set(["passed", "blocked"]).has(buildResult.status)) {
    throw new TypeError("buildResult.status must be passed or blocked");
  }

  const ownedPool = options.client ? null : new Pool({ connectionString: options.connectionString });
  let client = options.client;
  const uuidFactory = options.uuidFactory ?? uuidV7;
  try {
    client ??= await ownedPool.connect();
    await client.query("begin");
    const existing = await client.query(
      "select import_run_id::text, status from registry.import_runs where idempotency_key = $1",
      [metadata.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      await client.query("commit");
      return { created: false, importRunId: existing.rows[0].import_run_id, status: existing.rows[0].status };
    }

    await client.query(
      `insert into registry.import_runs (
        import_run_id, snapshot_id, idempotency_key, pipeline_commit, parser_version,
        dry_run, status, started_at, summary
      ) values ($1, $2, $3, $4, $5, $6, 'running', now(), '{}'::jsonb)`,
      [
        metadata.importRunId,
        metadata.snapshotId,
        metadata.idempotencyKey,
        metadata.pipelineCommit,
        metadata.parserVersion,
        metadata.dryRun ?? true
      ]
    );

    const stagingRows = buildResult.stagingRecords.map((record) => ({
      stagingRecordId: uuidFactory(),
      sourceRecordKey: record.sourceRecordKey,
      sourceRecordHash: record.sourceRecordHash,
      rawRecord: record.rawRecord,
      parsedRecord: record.parsedRecord,
      parseStatus: record.parseStatus
    }));
    for (const batch of chunks(stagingRows)) {
      await client.query(
        `insert into registry.staging_records (
          staging_record_id, import_run_id, source_record_key, source_record_hash,
          raw_record, parsed_record, parse_status
        )
        select
          item.staging_record_id::registry.uuid_v7, $1::registry.uuid_v7,
          item.source_record_key, item.source_record_hash::registry.sha256_hex,
          item.raw_record, item.parsed_record, item.parse_status
        from jsonb_to_recordset($2::jsonb) as item(
          staging_record_id text, source_record_key text, source_record_hash text,
          raw_record jsonb, parsed_record jsonb, parse_status text
        )`,
        [metadata.importRunId, JSON.stringify(batch.map((item) => ({
          staging_record_id: item.stagingRecordId,
          source_record_key: item.sourceRecordKey,
          source_record_hash: item.sourceRecordHash,
          raw_record: item.rawRecord,
          parsed_record: item.parsedRecord,
          parse_status: item.parseStatus
        })))]
      );
    }

    const findingRows = buildResult.findings.map((item) => ({
      finding_id: uuidFactory(),
      rule_code: item.ruleCode,
      rule_version: item.ruleVersion,
      severity: item.severity,
      entity_kind: item.entityKind,
      entity_key: item.entityKey,
      message: item.message,
      evidence: item.evidence ?? {}
    }));
    for (const batch of chunks(findingRows)) {
      await client.query(
        `insert into registry.validation_findings (
          finding_id, import_run_id, rule_code, rule_version, severity,
          entity_kind, entity_key, message, evidence
        )
        select
          item.finding_id::registry.uuid_v7, $1::registry.uuid_v7, item.rule_code,
          item.rule_version, item.severity, item.entity_kind, item.entity_key,
          item.message, item.evidence
        from jsonb_to_recordset($2::jsonb) as item(
          finding_id text, rule_code text, rule_version text, severity text,
          entity_kind text, entity_key text, message text, evidence jsonb
        )`,
        [metadata.importRunId, JSON.stringify(batch)]
      );
    }

    const decisionRows = buildResult.decisions.map((item) => ({
      decision_id: uuidFactory(),
      source_record_key: item.sourceRecordKey,
      candidate_territory_id: item.candidateTerritoryId,
      proposed_territory_id: item.proposedTerritoryId,
      decision: item.decision,
      confidence: item.confidence,
      rationale: item.rationale
    }));
    for (const batch of chunks(decisionRows)) {
      await client.query(
        `insert into registry.identity_decisions (
          decision_id, import_run_id, source_record_key, candidate_territory_id,
          proposed_territory_id, decision, confidence, rationale, decided_by
        )
        select
          item.decision_id::registry.uuid_v7, $1::registry.uuid_v7,
          item.source_record_key, nullif(item.candidate_territory_id, '')::registry.uuid_v7,
          nullif(item.proposed_territory_id, '')::registry.uuid_v7,
          item.decision, item.confidence, item.rationale, $3
        from jsonb_to_recordset($2::jsonb) as item(
          decision_id text, source_record_key text, candidate_territory_id text,
          proposed_territory_id text, decision text, confidence numeric, rationale text
        )`,
        [
          metadata.importRunId,
          JSON.stringify(batch.map((item) => ({
            ...item,
            candidate_territory_id: item.candidate_territory_id ?? "",
            proposed_territory_id: item.proposed_territory_id ?? ""
          }))),
          `pipeline:${metadata.parserVersion}`
        ]
      );
    }

    const status = buildResult.status === "blocked" ? "blocked" : "review";
    await client.query(
      `update registry.import_runs
       set status = $2, finished_at = now(), summary = $3::jsonb
       where import_run_id = $1`,
      [metadata.importRunId, status, JSON.stringify(buildResult.summary)]
    );
    await client.query(
      `insert into registry.audit_events (
        audit_event_id, event_type, entity_kind, entity_key, actor, payload
      ) values ($1, 'siruta_import_staged', 'import_run', $2, $3, $4::jsonb)`,
      [
        uuidFactory(),
        metadata.importRunId,
        `pipeline:${metadata.parserVersion}`,
        JSON.stringify({ status, candidateSha256: buildResult.summary.candidateSha256 })
      ]
    );
    await client.query("commit");
    return { created: true, importRunId: metadata.importRunId, status };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    if (ownedPool) {
      client?.release();
      await ownedPool.end();
    }
  }
}
