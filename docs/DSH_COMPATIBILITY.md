# DSH compatibility

The package peer range is `>=0.1.0-rc.6 <0.2.0`, but a declared peer range is not evidence that every release works. This table records local tests against stock npm artifacts on Windows on 2026-08-25. The authored hosted matrix remains `UNVERIFIED` until it runs in the public repository.

| DSH version | Contract/build | Fresh tarball | Source link | Dump config | Web mount | Browser core flow | Local status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | PASS | PASS | PASS with explicit database path | PASS | PASS | PASS | Verified locally |
| `0.1.0-rc.7` | PASS | PASS | PASS with explicit database path | PASS | PASS | PASS | Verified locally |

The fresh-profile browser core flow opens the stock DSH Web client, lists memory spaces, opens the manager, creates `CiSpace`, saves one memory, stages it from a matching draft, observes a positive token estimate, suppresses it, and observes a zero preview count. The tarball flow also checks FTS integrity, a second mount, uninstall, and absence from the dumped Profile.

The source-link flow requires `DSH_MEMORY_SPACES_DATABASE_PATH` to name an absolute file under the intended Profile. A linked checkout is outside that Profile, so the plugin fails rather than guessing a shared storage owner. Tarball installation resolves the owning Profile automatically.

DSH rc.6 exposes `commands/execute` with `(sessionId, line, images, signal?)`; rc.7 exposes `(sessionId, line, signal?)`. The client compatibility adapter first uses the rc.7 form and retries the rc.6 form only for the exact pre-dispatch business-argument-count error. Other failures are not replayed.

The browser contract uses only the published `conversation.chat.node`, `conversation.session.header.actions`, `conversation.input.dock`, and `conversation.chat.commandview` slots. The Host imports public package exports only. Re-run the real mount matrix whenever DSH changes, even within the peer range.

The repository includes an Ubuntu/Windows/macOS and Node 22.19/24 CI matrix plus separate stock rc.6/rc.7 mount jobs. Those hosted jobs have not run because the independent repository has not been uploaded. They are release gates, not current PASS evidence.
