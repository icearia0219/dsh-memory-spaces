# Quality audit

Audit date: 2026-08-25. Results in this report come from observed local commands. Authored workflows, unexecuted releases, and provider-dependent scenarios are not marked PASS.

## 1. Executive summary

Score: 92/100, grade A-. The source is suitable for a public GitHub repository. An npm release remains conditional on hosted CI passing, an npm trusted publisher being configured, and the tagged provenance workflow completing. Open severity count: P0 0, P1 0, P2 2, P3 2.

The plugin has a coherent independent architecture, direct-human governance, profile-local schema-versioned storage, provenance and version chains, bounded answer-time injection, optional history import, selected-message snapshots, deterministic migration/security tests, stock DSH rc.6/rc.7 local mount evidence, and an inspected package path. The largest observed product limit is the 20.6-second p95 governance view at 100,000 memories; lexical recall at the same scale remains just inside the 500-millisecond reference target.

## 2. Actual environment

- Windows x64, PowerShell, Node.js 22.19.0, pnpm 11.22.0, TypeScript 6.0.3.
- Development peers: exact DSH `0.1.0-rc.7`; real mount artifacts: stock npm DSH `0.1.0-rc.6` and `0.1.0-rc.7`.
- SQLite: Node's experimental `node:sqlite` with FTS5 trigram support.
- Browser: Playwright Chromium 1.62.1 against real stock DSH Web profiles.

## 3. Architecture and data flow

The standalone package emits an ESM Host entry, a CJS browser entry required by the current DSH Web loader, and declarations. It imports public DSH exports and registers published client slots only. The Host owns a Profile-local SQLite database, exact schema upgrades, active-only FTS, direct-human command origin checks, independent source/consumer relationships, optional summarization, pre-step candidate selection, model-visible logged context, and post-answer usage attachment. Read-only bearer snapshots are a separate data path and never create memory relationships. See [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), and [Threat model](THREAT_MODEL.md).

## 4. Findings and repairs

| ID | Severity | Problem | Evidence and consequence | Repair | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | P0 | Public/model-replayable governance could alter durable relationships | Pasted or model-generated commands could change sharing state | Moved relationship governance to browser-private, Session-addressed direct-human operations; public verbs fail | `test/plugin.test.mjs`, `test/ui-command.test.mjs` | Resolved |
| F02 | P0 | Snapshot creation could imply all-history sharing | Users could disclose unreviewed dialogue | Snapshot creation accepts explicit eligible message selections only | `test/sharing.test.mjs`, client tests | Resolved |
| F03 | P0 | Snapshot token purpose and query handling were insufficiently separated | A leaked bearer could cross privilege purposes or remain in navigation state | Separate access/append hashes, purpose binding, expiry, atomic limits, revocation, and query cleanup | `test/security.test.mjs`, `test/sharing.test.mjs` | Resolved |
| F04 | P0 | Schema 3 migration lacked complete backup/race proof | Concurrent open or failure could produce ambiguous recovery | Consistent backup, transaction, rollback/reopen, and two-process competition coverage | `test/migration.test.mjs` | Resolved |
| F05 | P1 | Unknown schema could be mutated by journal configuration | A rejected database could still change on disk | Validate schema before journal mutation and fail closed | migration unknown-schema test | Resolved |
| F06 | P1 | A global default path could mix Profiles | Sessions from independent Profiles could share local data unintentionally | Resolve installed storage under the owning Profile; source links require an explicit path | `test/profile-storage.test.mjs`, real source-link mounts | Resolved |
| F07 | P1 | Preview decisions and pending usage could be reused or misreported | A later turn could receive stale choices; a non-answer could appear used | Query-bound ten-minute choices are consumed once; usage attaches only to a durable answer event | plugin and database usage tests | Resolved |
| F08 | P1 | Expiry, version lifecycle, and FTS could drift | Inactive data might enter recall | Lifecycle changes are transactional and FTS indexes active effective versions only | lifecycle, recall, and FTS integrity tests | Resolved |
| F09 | P1 | Browser bundle used a `.js` CommonJS entry under `type: module` | Strict package consumers rejected the tarball | Publish `lib/client.cjs` with matching declarations | publint, attw, real Web mount | Resolved |
| F10 | P1 | DSH rc.6 and rc.7 command transports use different arity | rc.6 rejected browser governance before dispatch | Retry only the exact rc.6 pre-dispatch arity error with the legacy empty-images argument | client adapter tests and rc.6 browser core flow | Resolved |
| F11 | P2 | Governance limit was applied once per space | Many spaces could return far beyond the requested memory cap | Enforce one global remaining-memory cap across visible spaces | database regression test | Resolved |
| F12 | P2 | Browser selection allowed 1,000 Sessions while the Host capped 500 | A valid UI batch failed at execution | Align source/consumer batch limit at 1,000 | 1,000-source batch-removal test and benchmark | Resolved |
| F13 | P2 | Browser automation lacked stable semantics and dynamic failures lacked alerts | Regressions and assistive technology could miss state | Added semantic test hooks, alert roles, and Session-keyed governance state | client tests and real browser core flow | Resolved |
| F14 | P2 | Governance aggregation is too slow at 100,000 memories | Measured p95 is 20,586.53 ms | No release-blocking correctness fix; add pagination or aggregate-specific queries in a later release | `scripts/benchmark.mjs` | Open |
| F15 | P2 | Accessibility has no complete keyboard, screen-reader, contrast, or automated audit | Primary browser interaction does not prove full accessibility | Keep claim `PARTIAL`; require a dedicated audit before claiming conformance | claim C16 | Open |

The remaining P3 items are the lack of a paid-provider end-to-end history-summary/model-answer run and the accepted use of lexical retrieval without semantic conflict detection. Both are documented product limits rather than hidden correctness claims.

## 5. README claim audit

[Claim verification](CLAIM_VERIFICATION.md) records 20 material claims: 16 PASS, 2 PARTIAL, 2 UNVERIFIED, and 0 FAIL. The README does not claim encrypted storage, authenticated remote identity, secure physical erasure, semantic conflict detection, embedding recall, or guaranteed prompt-injection prevention. Stock rc.6/rc.7 compatibility is described as locally verified; hosted CI and npm publication remain explicitly unverified.

## 6. Tests and coverage

The final local suite contains 63 passing tests. Focused migration and security suites pass. Coverage from `coverage/coverage-summary.json`: statements 96.81% (3,623/3,742), lines 96.81% (3,623/3,742), functions 98.90% (181/183), and branches 83.31% (709/851). The database module has 98.15% lines and 90.19% branches. Configured global gates are 95% statements/lines/functions and 80% branches.

## 7. Migration and integrity

The schema 3 fixture contains two spaces, six legacy memberships, four memory/version records including a disputed state, retained source excerpts, one answer usage with response sequence, one snapshot with token hashes, and FTS rows. Migration produces independent source/consumer relationships, preserves the complex state, creates an integrity-valid schema 3 backup, and opens as schema 4 with matching FTS. Tests also cover rollback/recovery, restart persistence, rejection of unknown schema without journal mutation, and simultaneous opens in two Node processes. Fresh rc.6 and rc.7 real profiles report `integrity_check = ok` and zero missing or unexpected FTS rows.

## 8. Security and privacy

Automated security evidence covers direct-human origin and replay control, owner authorization, independent relationships, byte and count limits, tag-safe serialization, token entropy/hash/purpose separation/expiry/revocation/atomic use limits, selected-message-only snapshots, text-only rendering, sensitive-category reporting without secret echo, and no-write history-summary failure paths. Stored memory remains untrusted input. The database is local and unencrypted; TLS, authentication, headers, OS access controls, external backups, provider retention, and unrestricted filesystem actors remain deployment responsibilities.

## 9. Actual DSH verification

Stock DSH rc.6 and rc.7 each passed a fresh-Profile tarball install, `--dump-config`, real Web boot, browser core memory flow, positive preview token estimate, per-memory suppression, second mount, FTS integrity, uninstall, and post-uninstall dump. Both versions also passed source-link installation, mount with an explicit Profile database path, and uninstall. The rc.6 compatibility test first exposed the command-arity difference and passed after the narrow adapter repair. No paid model/API key was used, so the full external answer-generation and history-summary route remains P3 and is not claimed as verified.

## 10. Packaging and release

Strict package validation uses build, publint, attw, `npm pack --dry-run --json`, a real `pnpm pack`, and an allowlist-style tarball inspection. The release artifact must contain Host/client/types/config/docs and must not contain SQLite/WAL/SHM files, tokens, logs, `.env`, transcripts, tests, coverage, screenshots, caches, source, `node_modules`, or bundled DSH/React runtimes. The exact final tarball path, byte size, file count, and SHA-256 are recorded after the last package gate rather than embedded here because this report is itself inside the tarball. No upload or npm publish has occurred.

The release workflow uses GitHub OIDC with npm provenance and no configured long-lived token, but it remains `UNVERIFIED` until the repository exists remotely, npm trusts the GitHub environment, and a tag runs successfully.

## 11. Performance

[Performance](PERFORMANCE.md) records reproducible 1,000, 10,000, and 100,000-memory runs. Recall p95 is 48.21 ms at 10,000 memories and 483.95 ms at 100,000; bounded context rendering p95 is 0.37 ms. The 100,000-memory governance p95 is 20,586.53 ms and is an open P2. All completed benchmark databases pass integrity, schema, and FTS consistency checks.

## 12. Failed commands and remaining limits

Observed failed attempts were retained as audit evidence: local `rg.exe` was denied and read-only discovery used PowerShell; npm's machine-level cache was not writable and package checks used a fresh temporary cache; Playwright initially lacked Chromium and passed after official browser installation; rc.6 initially rejected the rc.7 command arity and passed after the compatibility adapter; a source link without an explicit database path failed intentionally and then passed with the documented path; rc.7 browser automation initially stopped at onboarding and passed after handling the stock dialog; the benchmark first hit a 500/1,000 batch mismatch and passed after aligning the limit; the 100,000-memory run with 20 governance samples was interrupted after excessive runtime and was rerun with five samples, which confirmed the P2 latency failure; the installed desktop `dsh` was stale, so exact official npm rc.6/rc.7 artifacts were used.

Known limits: no teams, account identity, remote memory invitation, cross-instance synchronization, embedding retrieval, semantic contradiction detector, storage encryption, secure physical deletion, or prompt-injection guarantee. Snapshot URLs depend on the Web deployment address and bearer secrecy. Hosted cross-platform CI, npm trusted publication, paid-provider output, complete accessibility, and 100,000-memory manager responsiveness remain outside the PASS set.
