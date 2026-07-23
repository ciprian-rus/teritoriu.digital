# Source Mirror & Change Detection

## Purpose

The source mirror makes the registry independent from the day-to-day availability of the
official CKAN catalogue without replacing the official source. The configured INS/data.gov.ro
resource remains authoritative. The mirror stores exact, content-addressed copies in the private
`source-snapshots` bucket and records every observation in PostgreSQL.

## Scheduled flow

`Mirror official SIRUTA source` runs weekly and can also be started manually. It:

1. downloads the configured official resource URL directly, bypassing CKAN discovery only;
2. applies the same HTTPS, host, port, redirect, DNS, size and timeout restrictions as normal acquisition;
3. validates the real media type and the complete canonical SIRUTA profile before any write;
4. computes SHA-256 over the exact source bytes;
5. uploads to an immutable content-addressed object path without upsert;
6. registers the snapshot under the unique key `(source_id, sha256)`;
7. appends a `source_snapshot_observed` audit event.

The same hash is an idempotent observation: no object or snapshot row is duplicated. A different
hash is archived as a new snapshot candidate. It is never promoted automatically to a canonical
release or to the `stable` channel.

## Change signal

The command output exposes:

- `acquisitionChannel=official-direct-mirror`;
- `archiveCreated`;
- `snapshotCreated`;
- `changeDetected`;
- `snapshotId`, SHA-256, byte size and validation evidence.

For a publish run, `changeDetected` is true only when a new database snapshot was created.
This database-backed hash comparison is authoritative even when the upstream server omits or
changes weak HTTP validators such as ETag or Last-Modified.

## Failure behaviour

Any network, integrity, format or canonical validation failure stops before promotion. Existing
objects are re-downloaded and hash-verified before a duplicate is accepted. The public `stable`
release remains unchanged.

After a detected change, an operator must run canonicalization, inspect the diff and findings,
approve the candidate explicitly, and only then prepare/promote a new immutable public release.
