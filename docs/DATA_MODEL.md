# Data model

Schema version 4 stores spaces, independent source and consumer relations, versioned memories, source-message excerpts, recall usages, conversation share links, and immutable share snapshots. Opaque ids are generated for every durable entity.

A memory version belongs to one space and one version root. The lifecycle transition matrix is:

| From | Allowed next states |
| --- | --- |
| `active` | `superseded`, `disputed`, `expired`, `deleted` |
| `superseded` | `deleted` |
| `disputed` | `active`, `deleted` |
| `expired` | `deleted` |
| `deleted` | none |

Creating a version supersedes exactly one current active row in the same transaction. Only the latest version can be reactivated or revised. FTS triggers index active content of at least three characters and remove every non-active row.

Provenance includes source Session id and title, source sequence range, manual or model-extracted method, selected source excerpts, timestamps, prior/next version ids, and recent completed answer usages. Clearing provenance removes the plugin's source fields and excerpts, but does not promise physical erasure from SQLite pages, WAL, filesystem snapshots, or external backups.
