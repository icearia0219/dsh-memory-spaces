# Security policy

## Supported versions

This repository is preparing its first release. The compatibility range and actual verification evidence are maintained in [DSH compatibility](docs/DSH_COMPATIBILITY.md). Until `0.1.0` is published, source snapshots are not security-supported releases.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability or include real credentials, tokens, conversation text, or a user database in a report. Use a private GitHub security advisory for `icearia0219/dsh-memory-spaces`. Include the plugin version, DSH version, operating system, reproduction steps using synthetic data, and the expected impact. Maintainers will acknowledge a complete report when it is reviewed; no fixed response-time SLA is promised for this personal project.

## Security boundaries

- Governance operations are checked against the addressed Session and current direct human command event. Session ids are routing identifiers, not user identities.
- The browser UI is not an operating-system permission boundary. A DSH model with unrestricted Bash/filesystem access, a malicious local user, or another process running as the same OS account can read or change the local database.
- The SQLite database is not encrypted. Protect the DSH profile, backups, WAL/SHM files, and process environment with host controls.
- Snapshot URLs are bearer credentials. Query parameters can enter browser history, logs, clipboard history, screenshots, referrers, and proxy telemetry before the client removes them from the visible address.
- Injected memory is untrusted context. Structural serialization and warning text reduce accidental instruction confusion but cannot guarantee resistance to prompt injection.
- History summarization sends the selected bounded transcript to the configured model provider. Provider retention, billing, and jurisdiction are outside this plugin.

See the complete [threat model](docs/THREAT_MODEL.md) and [backup guidance](docs/BACKUP_AND_RECOVERY.md).
