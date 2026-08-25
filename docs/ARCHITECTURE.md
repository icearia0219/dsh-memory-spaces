# Architecture

The package has one ESM Host entry (`lib/index.js`) and one CommonJS Web client entry (`lib/client.cjs`) for DSH's browser module loader. The Host uses published DSH services and effects to own SQLite persistence, direct-human commands, browser-private transports, history summarization, recall, injection, and cleanup. The client contributes only published conversation header, message-node, input-dock, and command-view slots. It imports no DSH repository source path.

Source relationships authorize explicit contributions. Consumer relationships authorize answer-time use and carry `automatic`, `confirm`, or `paused` mode. Both are owner-governed and independent. Memory versions retain provenance and lifecycle state. Only active, non-expired rows are indexed and recalled.

Before a model step, direct human text is bounded and used for lexical FTS5 retrieval. Automatic matches and user-selected confirmation matches are deduplicated, serialized as tagged JSON in one untrusted-context message, and logged through the normal Session event stream. Pending usage rows are attached only when a durable assistant message arrives, otherwise they are removed when the turn ends.

Selected-message snapshot links are separate from memory spaces. The browser projects only selected loaded user/assistant messages; the Host stores an immutable text snapshot and hashed bearer tokens. Opening a link does not add a source or consumer relationship.
