# DSH compatibility

The package peer range is `>=0.1.0-rc.6 <0.2.0`, but that range alone is not compatibility evidence. Version 0.1.1 keeps the rc.6/rc.7 compatibility tests and expands the exact stock-DSH release matrix to current npm `latest` and `next`. The release tag cannot publish until all four hosted mount jobs pass.

| DSH version | Evidence date | Fresh tarball | Dump config | Web mount | Browser core flow | Evidence status |
| --- | --- | --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | 2026-08-25 | PASS | PASS | PASS | PASS | Local and hosted evidence for v0.1.0; v0.1.1 tag gate configured |
| `0.1.0-rc.7` | 2026-08-25 | PASS | PASS | PASS | PASS | Local and hosted evidence for v0.1.0; exact development interfaces retained |
| `0.1.5-rc.3` | 2026-09-26 | PASS | PASS | PASS | PASS | Fresh Windows v0.1.1-candidate tarball and real browser flow |
| `0.1.7-rc.2` | 2026-09-26 | PASS | PASS | PASS | PASS | Fresh Windows v0.1.1-candidate tarball and real browser flow |

The browser core flow opens stock DSH Web, submits `/memory list`, opens the manager, creates an isolated `CiSpace-*`, saves one memory, stages it from a matching draft, observes a positive token estimate, suppresses it, observes a zero preview count, and deletes the space. The hosted matrix additionally repeats the mount, uninstalls the tarball, verifies absence from the composed Profile, installs linked source, remounts it, and uninstalls it.

The older client publishes `conversationEvents`, exposes Session events as an array, and varies the `commands/execute` business-argument count between rc.6 and rc.7. Current DSH publishes `uiConversation.events`, exposes Session event accessors, and expects an attachments argument. The compatibility adapters select the available event registry, read either Session representation, try the attachment-aware command form first, and fall back only for the exact pre-dispatch rc.7 argument-count error. Other command failures are not replayed.

The client uses the published `conversation.chat.node`, `conversation.session.header.actions`, `conversation.input.dock`, and `conversation.chat.commandview` slots. It owns the small icons and plain command-text rendering that DSH renamed after rc.7. DSH versions that publish `sidebar.workspaces.session.leading` and `sidebar.workspaces.overlay` also receive the sidebar batch selector; current `0.1.5-rc.3` and `0.1.7-rc.2` do not publish those optional slots, so the title-bar flow remains the real-mount entry.

The source-link flow requires `DSH_MEMORY_SPACES_DATABASE_PATH` to name an absolute file under the intended Profile. A linked checkout is outside that Profile, so the plugin fails rather than guessing a shared storage owner. Tarball installation resolves the owning Profile automatically.

The public repository runs Ubuntu, Windows, and macOS package tests on Node 22.19 and 24. It separately installs exact stock DSH `0.1.0-rc.6`, `0.1.0-rc.7`, `0.1.5-rc.3`, and `0.1.7-rc.2` artifacts on Ubuntu and executes the mount workflow above. Authenticated Web URLs are discovered from the server readiness line, and retained logs redact the bearer query token. Every release tag invokes this reusable matrix before npm publication; an earlier green commit does not validate later changes.
