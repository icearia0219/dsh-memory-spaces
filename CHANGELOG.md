# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog and the project uses Semantic Versioning.

## [0.1.1] - 2026-09-26

### Fixed

- Restored Web-client startup on current DSH releases by supporting both the legacy `conversationEvents` service and the current `uiConversation.events` registry.
- Adapted command execution and Session event reads to both legacy and current DSH APIs without replaying requests after dispatch.
- Removed dependencies on DSH UI primitives that were renamed or removed in current releases.
- Updated the real-mount verifier and CI readiness probe for authenticated DSH Web URLs while redacting bearer query tokens from retained evidence.

### Changed

- Replaced the stale rc.6/rc.7 stock-DSH gate with reproducible fresh-install coverage for `0.1.5-rc.3` and `0.1.7-rc.2`.
- Switched the release workflow from the retired bootstrap secret to npm Trusted Publishing through GitHub OIDC.

### Migration warning

This release does not change the SQLite schema or migrate stored memory. Stop DSH, back up the Profile database, install `dsh-memory-spaces@0.1.1`, and restart the Web Profile.

## [0.1.0] - 2026-08-25

### Added

- Independent stock-DSH Host and Web client plugin with owner-governed source and consumer relationships.
- Automatic, confirmation, and paused answer-time memory use.
- Provenance, version chains, lifecycle states, usage auditing, optional history summarization, and selected-message snapshots.
- Profile-local schema version 4 SQLite storage, active-only FTS5 recall, v3 backup and migration, and an FTS integrity command.
- Contract, migration, security, browser-component, packaging, stock DSH mount, benchmark, and cross-platform CI coverage.
- Reproducible 1,000, 10,000, and 100,000-memory benchmarks plus an FTS doctor command.
- GitHub Actions matrices for Node 22/24 on Ubuntu, Windows, and macOS, stock DSH rc.6/rc.7 mount tests, and OIDC npm publication with provenance.

### Changed

- Added a narrow client transport adapter for the published rc.6 and rc.7 `commands/execute` signatures.
- Applied the governance memory limit globally across visible spaces instead of once per space.
- Aligned browser and Host source/consumer batch operations at 1,000 Sessions.
- Added stable browser-test semantics, alert roles, and Session-keyed governance dialogs.
- Added a progressive-enhancement sidebar Session selector for DSH builds that publish Workspace-row leading and overlay slots.
- Applied governance mutation responses directly, added explicit creation feedback, bounded long dialog content with a scrollport, and hid successful private command rows while retaining working and error states.
- Made the CI workflow reusable as a release gate, added tag/package/changelog validation, required a trusted-publishing-capable npm CLI, and created GitHub Release notes from the matching changelog section after npm publication.

### Security

- Governance and durable writes require a current direct human event and are not exposed as model tools.
- Snapshot access and append tokens are independent, hashed at rest, expiring, revocable, and use-limited atomically.
- Snapshot creation accepts only explicitly selected conversation messages.
- Stored memory remains labeled as untrusted background; the project makes no prompt-injection-prevention or secure-erasure claim.

### Migration warning

Schema 3 databases are backed up and migrated transactionally. Version 4 defaults to a profile-local `memory-spaces-v4.sqlite`; it does not silently reuse a legacy global database. Follow [Backup and recovery](docs/BACKUP_AND_RECOVERY.md) before manually moving old data.
