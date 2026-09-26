# DSH compatibility

Version 0.1.1 supports stock DSH aggregate releases `>=0.1.5-rc.3 <0.2.0`. The component package peer ranges begin earlier because DSH component versions are not released in lockstep; those resolver constraints are not a promise that every older aggregate can boot the plugin. Exact fresh-install evidence is the authority for aggregate compatibility.

| DSH aggregate | Evidence date | Fresh tarball | Dump config | Web mount | Browser core flow | Source link and uninstall | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0.1.5-rc.3` | 2026-09-26 | PASS | PASS | PASS | PASS | PASS | Supported npm `latest` |
| `0.1.7-rc.2` | 2026-09-26 | PASS | PASS | PASS | PASS | PASS | Supported npm `next` |

The browser core flow opens stock DSH Web, submits `/memory list`, opens the manager, creates an isolated `CiSpace-*`, saves one memory, stages it from a matching draft, observes a positive token estimate, suppresses it, observes a zero preview count, and deletes the space. The hosted workflow additionally repeats the mount, uninstalls the tarball, verifies absence from the composed Profile, installs linked source, remounts it, and uninstalls it. Both supported versions passed the complete hosted workflow for commit `b099b09` before the legacy jobs were removed from the release gate.

DSH `0.1.0-rc.6` and `0.1.0-rc.7` passed the v0.1.0 matrix on 2026-08-25, but that historical result is not current support evidence. On 2026-09-26, fresh Windows and Ubuntu installs of both aggregates terminated in DSH's own `watchUserPatches` startup path with `user patch-layer watching requires the Cordis HMR service`, after printing the Web URL and before the plugin could activate. Version 0.1.1 therefore stops claiming or gating on those aggregates rather than hiding the host failure with a compatibility shim.

Current DSH publishes `uiConversation.events`, exposes Session event accessors, expects an attachments argument for command execution, and no longer exports several rc.7 UI primitives. The plugin selects the available conversation-event registry, reads the current Session API, supplies the attachments argument, and owns its small icons and command-text rendering. Narrow legacy fallbacks remain tested for installations whose host can still boot, but they do not extend the supported aggregate range.

The client uses the published `conversation.chat.node`, `conversation.session.header.actions`, `conversation.input.dock`, and `conversation.chat.commandview` slots. DSH `0.1.5-rc.3` and `0.1.7-rc.2` do not publish the optional `sidebar.workspaces.session.leading` and `sidebar.workspaces.overlay` slots, so the title-bar flow is the real-mount entry and the sidebar enhancement remains dormant.

The source-link flow requires `DSH_MEMORY_SPACES_DATABASE_PATH` to name an absolute file under the intended Profile. A linked checkout is outside that Profile, so the plugin fails rather than guessing a shared storage owner. Tarball installation resolves the owning Profile automatically.

The public repository runs Ubuntu, Windows, and macOS package tests on Node 22.19 and 24. It separately installs exact stock DSH `0.1.5-rc.3` and `0.1.7-rc.2` artifacts on Ubuntu and executes the complete mount workflow. Authenticated Web URLs are discovered from the server readiness line, and retained logs redact the bearer query token. Every release tag invokes this reusable matrix before npm publication; an earlier green commit does not validate later changes.
