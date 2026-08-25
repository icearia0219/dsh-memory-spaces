# Threat model

## Protected assets

Assets include memory text, selected conversation snapshots, provenance, Session titles and ids, usage records, bearer tokens, provider routing, the SQLite file, WAL/SHM files, and backups.

## Trust boundaries

The DSH Host process, its plugins, and its model tools run with the permissions granted by the operating system and DSH policy. The browser connects to that Host over the deployment's network boundary. Session ids address DSH Sessions; they are not authenticated people. Browser-private commands and direct-human event checks prevent ordinary model output from invoking governance, but they do not isolate a model that also has unrestricted Bash or filesystem access.

SQLite storage is local and unencrypted. A malicious local user or process with the same or stronger OS permissions can inspect or modify it. Separate DSH profiles use separate default database paths, but an explicit shared absolute path intentionally removes that isolation. Backups, WAL files, filesystem snapshots, and deleted pages can retain earlier values.

History import sends selected bounded conversation content to the configured external provider. That provider's transport, retention, training, billing, and regional policies are outside this plugin. The plugin rejects empty, tool-call, failed, cancelled, truncated, oversized, or structurally invalid summary results before writing.

Memories are untrusted prompt context. JSON serialization, explicit provenance, and warning text do not eliminate prompt injection; a model can still follow malicious remembered instructions. Users must inspect the pre-send preview and may suppress candidates.

Snapshot URLs are bearer credentials. They can leak through clipboard history, browser history, logs, screenshots, referrers, proxies, or malware before the client removes the query parameter. Tokens are random, independent by purpose, hashed at rest, expiring, revocable, and atomically use-limited. Snapshot content is rendered as text, not HTML.

## Out of scope

The plugin does not protect against a compromised DSH Host, malicious plugin, administrator, root/administrator user, same-account process, compromised model provider, browser extension, endpoint malware, traffic interception in a deployment without TLS, or deliberate database-path sharing. Host authentication, authorization between people, TLS, CSP and other HTTP headers, disk encryption, secure deletion, network exposure, and disaster-recovery retention belong to the deployment.
