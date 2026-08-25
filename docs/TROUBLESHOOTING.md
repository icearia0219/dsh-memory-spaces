# Troubleshooting

## Plugin remains on “Loading plugins”

Run `dsh --profile web --dump-config`, confirm `dsh-memory-spaces` and its client entry appear, and restart the Web process after install or removal. Check that the exact DSH release falls within [the verified matrix](DSH_COMPATIBILITY.md). A source-linked install also needs `DSH_MEMORY_SPACES_DATABASE_PATH` because no owning profile can be inferred.

## A Session cannot recall a memory

In **Memory spaces**, verify that the target Session is a consumer, its mode is not paused, and the memory version is active and not expired. Being a source does not grant use. Confirmation candidates must be selected in the current composer preview. Run `pnpm doctor:fts -- <database-path>` to compare active rows with the FTS index.

## A Session cannot contribute

Being a consumer does not make a Session a source. The owner must explicitly add it as a source. Saving, importing, or snapshotting requires a current human action; model-generated or replayed command events are rejected.

## A local snapshot URL cannot be opened elsewhere

`127.0.0.1` addresses the viewer's own computer. Remote use requires a deliberately deployed DSH Web service, reachable base URL, TLS, and host authentication. Treat the entire URL as a secret until it expires or is revoked.
