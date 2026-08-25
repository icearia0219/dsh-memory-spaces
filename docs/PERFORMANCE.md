# Performance

Recall uses SQLite FTS5 trigram ranking over active memory content. Query bytes, candidate count, injected bytes, source excerpts, history transcript bytes, and summary output tokens are configured bounds. These bounds prevent unbounded prompt growth but do not guarantee provider token counts because tokenization is provider-specific.

## Method

Measurements were collected on Windows x64 with Node.js 22.19.0 on 2026-08-25 by `node scripts/benchmark.mjs`. The benchmark creates synthetic memories through one SQLite transaction while normal FTS triggers remain active, creates source relations through the public store operation, runs warm recall and context-render samples, exercises the governance view, measures one ordinary `remember`, one version creation, lifecycle change, 1,000-source batch removal, restart, integrity, FTS consistency, database bytes, and process RSS. Bulk fixture time and an ordinary single save are reported separately.

Reproduce the quick CI-sized run with:

```powershell
pnpm benchmark -- --memories 1000 --spaces 10 --relations 1000 --samples 30 --governance-samples 5
```

## Results

| Dataset | Startup | Fixture + FTS | Relations | Recall p50 / p95 | Context p50 / p95 | Governance p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 memories, 10 spaces | 17.61 ms | 83.77 ms | 3,628.15 ms | 5.43 / 6.09 ms | 0.10 / 0.37 ms | 109.91 / 120.81 ms |
| 10,000 memories, 100 spaces | 46.25 ms | 833.75 ms | 3,678.61 ms | 37.15 / 48.21 ms | 0.15 / 0.36 ms | 172.35 / 189.36 ms |
| 100,000 memories, 100 spaces | 18.32 ms | 17,012.76 ms | 3,920.91 ms | 443.31 / 483.95 ms | 0.18 / 0.37 ms | 20,349.12 / 20,586.53 ms |

| Dataset | Remember | New version | Lifecycle | Remove 1,000 sources | Restart | Database files | RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 memories | 14.92 ms | 3.68 ms | 3.22 ms | 39.14 ms | 3.06 ms | 1,425,408 B | 70,148,096 B |
| 10,000 memories | 24.62 ms | 15.66 ms | 9.52 ms | 27.46 ms | 3.33 ms | 8,015,872 B | 71,888,896 B |
| 100,000 memories | 120.93 ms | 165.29 ms | 110.30 ms | 27.61 ms | 2.83 ms | 80,244,736 B | 58,929,152 B |

All completed runs reported schema version 4, `PRAGMA integrity_check = ok`, and zero missing or unexpected FTS rows.

## Threshold assessment

| Reference target | Result | Assessment |
| --- | ---: | --- |
| 10,000-memory recall p95 at most 150 ms | 48.21 ms | PASS |
| 100,000-memory recall p95 at most 500 ms | 483.95 ms | PASS, with little headroom on this machine |
| Context rendering p95 at most 50 ms | 0.37 ms | PASS |
| Interactive governance at 100,000 memories | 20,586.53 ms p95 | FAIL |

The 100,000-memory governance result is a known P2 limitation. The view caps returned memories globally, but it still loads and aggregates relationship/query data across all visible spaces. It requires pagination or an aggregate-specific query before the manager can be described as responsive at that scale. Benchmark numbers are machine-specific diagnostic evidence, not a cross-platform hard gate.
