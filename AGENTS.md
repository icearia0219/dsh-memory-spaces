# Repository instructions

These rules apply to every change in this repository. Preserve user changes, use only published DeepSeek Harness extension points, and do not claim compatibility or security properties without reproducible evidence.

## Invariants

1. The plugin shares no Session by default.
2. Source and consumer relationships remain independent.
3. Only the space owner may change governance relationships.
4. The plugin does not register governance or durable-write tools for the model.
5. Durable commands must originate from the current direct human event.
6. A consumer is not implicitly a source.
7. A version chain has at most one `active` version.
8. Only `active`, non-expired memories enter FTS and recall.
9. Lifecycle changes and their FTS effects occur in one database transaction.
10. Clearing provenance removes every application-level provenance derivative owned by the plugin.
11. `automatic`, `confirm`, and `paused` behavior remains distinct.
12. A target turn receives a given memory version at most once.
13. Injected context is bounded, valid UTF-8, and a complete serialized value.
14. History-summary failure, cancellation, tool calls, empty output, or truncation writes nothing.
15. Snapshot tokens are stored only as hashes.
16. Snapshot expiry, revocation, and use-limit checks are atomic.
17. Snapshots contain no reasoning, system prompts, or unselected messages.
18. Migrations are transactional and recoverable.
19. Unknown schema versions are not modified.
20. DSH private-path imports are forbidden.
21. Plugin disposal releases listeners, transports, and the database handle.
22. Tarballs contain no user data.
23. README claims require code and test evidence.
24. Every supported DSH upgrade requires renewed contract and real mount tests.

These are application invariants, not an operating-system security boundary. A model or local user with unrestricted filesystem or shell access can modify the unencrypted SQLite database.

## Definition of done

- Lint passes.
- Type checking passes.
- Unit, integration, migration, and security tests pass.
- Build and package validation pass.
- A fresh DSH install, `--dump-config`, real Web mount, and browser E2E pass for each claimed version.
- README and compatibility documentation match the evidence.
- This file remains synchronized with architecture and security changes.
