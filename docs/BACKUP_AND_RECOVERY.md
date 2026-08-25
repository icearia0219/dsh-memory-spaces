# Backup and recovery

## Locate the database

The bundled default is `profile:memory-spaces-v4.sqlite`. Installed packages resolve it to the owning DSH profile directory. A linked source checkout cannot infer a profile and must set `DSH_MEMORY_SPACES_DATABASE_PATH` or an explicit config path. Never point two profiles at one file unless shared storage is intentional and separately tested.

## Back up

1. Stop every DSH process using the profile.
2. Record the DSH and plugin versions and database path.
3. Copy the SQLite file and any sibling `-wal` and `-shm` files as one set, or use a SQLite online-backup method while the database is open.
4. Protect the copy as sensitive unencrypted conversation data.
5. Restore a copy in an isolated profile and run `pnpm doctor:fts -- <database-path>` plus `PRAGMA integrity_check` before relying on it.

Schema 3 migration first creates a consistent sibling file named like `.schema-3-backup-<time>-<id>.sqlite` with `VACUUM INTO`, then migrates inside `BEGIN IMMEDIATE`. Unknown schemas fail without changing the schema version or journal mode. The automatic backup is not a retention policy and may itself contain sensitive data.

## Legacy global database

Version 4 does not silently adopt a previous global `$DSH_HOME/memory-spaces-v3.sqlite`. Stop DSH, make an external backup, identify the exact target profile, and copy the legacy database to that profile as `memory-spaces-v4.sqlite`. Start only that profile and inspect the generated schema-3 backup and migration result. Do not copy one legacy file into multiple writable profiles.

## Restore

Stop DSH, preserve the failed database for analysis, replace the complete database/WAL/SHM set with the selected backup, then start one process. Verify schema version, `PRAGMA integrity_check`, FTS counts, space/member counts, version chains, snapshot revocation/use counts, and one synthetic recall flow. Restoration can reintroduce revoked links or deleted/provenance-cleared values that existed at backup time.

Logical deletion and provenance clearing are application operations, not secure physical erasure. SQLite free pages, WAL, storage media, backups, provider logs, and DSH Session logs can retain related data.
