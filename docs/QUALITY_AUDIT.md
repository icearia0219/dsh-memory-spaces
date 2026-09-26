# Quality audit

Audit date: 2026-09-26. Results in this report come from observed local commands or identified historical workflow runs. Authored workflows, unexecuted releases, and provider-dependent scenarios are not marked PASS.

## 1. Executive summary

Score: 92/100, grade A-. The source is suitable for a public GitHub repository. Version 0.1.1 restores current DSH client compatibility, passed the hosted cross-platform and two-version stock-DSH tag gate, and completed token-free npm Trusted Publishing with provenance. Open severity count: P0 0, P1 0, P2 2, P3 2.

The plugin has a coherent independent architecture, direct-human governance, profile-local schema-versioned storage, provenance and version chains, bounded answer-time injection, optional history import, selected-message snapshots, deterministic migration/security tests, fresh current npm `latest`/`next` mounts, and an inspected package path. Historical rc.6/rc.7 evidence is retained but no longer presented as v0.1.1 support. The largest observed product limit is the 20.6-second p95 governance view at 100,000 memories; lexical recall at the same scale remains just inside the 500-millisecond reference target.

## 2. Actual environment

- Windows x64, PowerShell, Node.js 24.15.0, pnpm 11.22.0, TypeScript 6.0.3.
- Development peers: exact legacy DSH `0.1.0-rc.7`; new real mount artifacts: stock npm DSH `0.1.5-rc.3` and `0.1.7-rc.2`; historical exact mounts: `0.1.0-rc.6` and `0.1.0-rc.7`.
- SQLite: Node's experimental `node:sqlite` with FTS5 trigram support.
- Browser: Playwright Chromium 1.62.1 against real stock DSH Web profiles.

## 3. Architecture and data flow

The standalone package emits an ESM Host entry, a CJS browser entry required by the current DSH Web loader, and declarations. It imports public DSH exports and registers published client slots only. The Host owns a Profile-local SQLite database, exact schema upgrades, active-only FTS, direct-human command origin checks, independent source/consumer relationships, optional summarization, pre-step candidate selection, model-visible logged context, and post-answer usage attachment. Read-only bearer snapshots are a separate data path and never create memory relationships. See [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), and [Threat model](THREAT_MODEL.md).

## 4. Findings and repairs

| ID | Severity | Problem | Evidence and consequence | Repair | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | P0 | Public/model-replayable governance could alter durable relationships | Pasted or model-generated commands could change sharing state | Moved relationship governance to browser-private, Session-addressed direct-human operations; public verbs fail | `test/plugin.test.mjs` | Resolved |
| F02 | P0 | Snapshot creation could imply all-history sharing | Users could disclose unreviewed dialogue | Snapshot creation accepts explicit eligible message selections only | `test/sharing.test.mjs`, client tests | Resolved |
| F03 | P0 | Snapshot token purpose and query handling were insufficiently separated | A leaked bearer could cross privilege purposes or remain in navigation state | Separate access/append hashes, purpose binding, expiry, atomic limits, revocation, and query cleanup | `test/sharing.test.mjs`, `test/plugin.test.mjs`, `test/client.test.mjs` | Resolved |
| F04 | P0 | Schema 3 migration lacked complete backup/race proof | Concurrent open or failure could produce ambiguous recovery | Consistent backup, transaction, rollback/reopen, and two-process competition coverage | `test/database.test.mjs` | Resolved |
| F05 | P1 | Unknown schema could be mutated by journal configuration | A rejected database could still change on disk | Validate schema before journal mutation and fail closed | migration unknown-schema test | Resolved |
| F06 | P1 | A global default path could mix Profiles | Sessions from independent Profiles could share local data unintentionally | Resolve installed storage under the owning Profile; source links require an explicit path | `test/profile-storage.test.mjs`, real source-link mounts | Resolved |
| F07 | P1 | Preview decisions and pending usage could be reused or misreported | A later turn could receive stale choices; a non-answer could appear used | Query-bound ten-minute choices are consumed once; usage attaches only to a durable answer event | plugin and database usage tests | Resolved |
| F08 | P1 | Expiry, version lifecycle, and FTS could drift | Inactive data might enter recall | Lifecycle changes are transactional and FTS indexes active effective versions only | lifecycle, recall, and FTS integrity tests | Resolved |
| F09 | P1 | Browser bundle used a `.js` CommonJS entry under `type: module` | Strict package consumers rejected the tarball | Publish `lib/client.cjs` with matching declarations | publint, attw, real Web mount | Resolved |
| F10 | P1 | DSH command transports use different business-argument counts | Attachment-aware releases and rc.7 could not share one direct call | Try the attachment-aware form first and fall back only for the exact rc.7 pre-dispatch argument-count error | client adapter tests and real browser core flows | Resolved |
| F11 | P2 | Governance limit was applied once per space | Many spaces could return far beyond the requested memory cap | Enforce one global remaining-memory cap across visible spaces | database regression test | Resolved |
| F12 | P2 | Browser selection allowed 1,000 Sessions while the Host capped 500 | A valid UI batch failed at execution | Align source/consumer batch limit at 1,000 | 1,000-source batch-removal test and benchmark | Resolved |
| F13 | P2 | Browser automation lacked stable semantics and dynamic failures lacked alerts | Regressions and assistive technology could miss state | Added semantic test hooks, alert roles, and Session-keyed governance state | client tests and real browser core flow | Resolved |
| F14 | P2 | Governance aggregation is too slow at 100,000 memories | Measured p95 is 20,586.53 ms | No release-blocking correctness fix; add pagination or aggregate-specific queries in a later release | `scripts/benchmark.mjs` | Open |
| F15 | P2 | Accessibility has no complete keyboard, screen-reader, contrast, or automated audit | Primary browser interaction does not prove full accessibility | Keep claim `PARTIAL`; require a dedicated audit before claiming conformance | claim C16 | Open |
| F16 | P0 | Current DSH renamed the conversation-event service, Session event access, command arguments, and UI primitives | The published v0.1.0 package could remain pending at boot or crash after the Web client loaded | Added explicit old/current service and Session adapters, a pre-dispatch-only command fallback, and plugin-owned icons and command text | client adapter tests plus `0.1.5-rc.3` and `0.1.7-rc.2` browser core flows | Resolved |

There is no open P1 finding. Version 0.1.1 verified the repository, workflow, environment, and OIDC trust relationship without a plaintext npm token. The remaining P3 items are the lack of a paid-provider end-to-end history-summary/model-answer run and the accepted use of lexical retrieval without semantic conflict detection. Both are documented product limits rather than hidden correctness claims.

## 5. README claim audit

[Claim verification](CLAIM_VERIFICATION.md) records 20 material claims: 18 PASS, 2 PARTIAL, 0 UNVERIFIED, and 0 FAIL. The README does not claim encrypted storage, authenticated remote identity, secure physical erasure, semantic conflict detection, embedding recall, or guaranteed prompt-injection prevention. Current npm `latest`/`next` evidence and the reason for dropping rc.6/rc.7 support are recorded separately.

## 6. Tests and coverage

The v0.1.1 local suite contains 74 passing tests, including three release-metadata tests and executable legacy/current adapters. Focused migration and security suites pass. Coverage is 96.82% statements and lines (3,659/3,779), 98.91% functions (183/185), and 83.19% branches (713/857). The configured gates are 95% statements/lines/functions and 80% branches.

## 7. Migration and integrity

The schema 3 fixture contains two spaces, six legacy memberships, four memory/version records including a disputed state, retained source excerpts, one answer usage with response sequence, one snapshot with token hashes, and FTS rows. Migration produces independent source/consumer relationships, preserves the complex state, creates an integrity-valid schema 3 backup, and opens as schema 4 with matching FTS. Tests also cover rollback/recovery, restart persistence, rejection of unknown schema without journal mutation, and simultaneous opens in two Node processes. The historical v0.1.0 rc.6/rc.7 profiles reported `integrity_check = ok` and zero missing or unexpected FTS rows.

## 8. Security and privacy

Automated security evidence covers direct-human origin and replay control, owner authorization, independent relationships, byte and count limits, tag-safe serialization, token entropy/hash/purpose separation/expiry/revocation/atomic use limits, selected-message-only snapshots, text-only rendering, sensitive-category reporting without secret echo, and no-write history-summary failure paths. Stored memory remains untrusted input. The database is local and unencrypted; TLS, authentication, headers, OS access controls, external backups, provider retention, and unrestricted filesystem actors remain deployment responsibilities.

## 9. Actual DSH verification

For v0.1.1, stock npm `0.1.5-rc.3` and `0.1.7-rc.2` each passed a fresh Windows tarball install, `--dump-config`, authenticated real Web boot, and the browser core memory flow with a positive token estimate, per-memory suppression, and deletion cleanup. Both also passed the hosted install, second mount, source link, uninstall, and post-uninstall composition workflow. Fresh rc.6/rc.7 aggregates now fail in the stock DSH HMR startup path before plugin activation and are no longer supported. The supported stock versions do not expose the optional Workspace-row slots, so sidebar selection retains client-test evidence rather than a stock-mount PASS. No paid model/API key was used, so full external answer generation and history summarization remain P3 and are not claimed as verified.

## 10. Packaging and release

Strict package validation uses build, publint, attw, `npm pack --dry-run --json`, a real `pnpm pack`, and an allowlist-style tarball inspection. The published v0.1.1 artifact contains 88 files, is 754,715 bytes packed, has registry SHA-512 integrity `z0zKEZljSMf+iWcdYpip0kM3sonRALPBZV1bnrAJQL/7uFaitYorlaKz5rqZZqvRaLddO/uge/G0Ah4Uwth8DQ==`, and has downloaded tarball SHA-256 `9031F0267659E1E6BBE4E1CB6432AAF83F5EA4FEFE638FCF1320BFB653AF6265`. It contains Host/client/types/config/docs and no bundled DSH or React runtime.

The `v0.1.1` tag workflow validated tag/package/changelog agreement, passed the complete reusable CI and stock-mount matrix, published through npm Trusted Publishing, and created the matching GitHub Release. npm recorded SLSA provenance and a transparency-log entry at index `2968395821`; the registry exposes the provenance attestation for `dsh-memory-spaces@0.1.1`.

## 11. Performance

[Performance](PERFORMANCE.md) records reproducible 1,000, 10,000, and 100,000-memory runs. Recall p95 is 48.21 ms at 10,000 memories and 483.95 ms at 100,000; bounded context rendering p95 is 0.37 ms. The 100,000-memory governance p95 is 20,586.53 ms and is an open P2. All completed benchmark databases pass integrity, schema, and FTS consistency checks.

## 12. Failed commands and remaining limits

Observed failed attempts were retained as audit evidence: the published plugin first remained pending on current DSH's renamed event service; current command dispatch then exposed an added attachments argument; current Session event access and renamed UI primitives caused further browser failures; each failure received a focused regression before both current versions passed. Fresh rc.6/rc.7 aggregates then reproduced the same stock DSH HMR startup failure on Windows and Ubuntu before plugin activation, so v0.1.1 removed them from its support claim and release gate. Earlier audit attempts also include the intentional source-link path failure, onboarding automation adjustment, batch-limit repair, and the 100,000-memory governance latency failure.

Known limits: no teams, account identity, remote memory invitation, cross-instance synchronization, embedding retrieval, semantic contradiction detector, storage encryption, secure physical deletion, or prompt-injection guarantee. Snapshot URLs depend on the Web deployment address and bearer secrecy. Paid-provider output, optional sidebar real-mount coverage, complete accessibility, and 100,000-memory manager responsiveness remain outside the PASS set.
