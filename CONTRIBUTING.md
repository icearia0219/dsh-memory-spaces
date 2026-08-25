# Contributing

Use Node.js 22.19.0 or a supported Node.js 24 release and the pnpm version selected by the lockfile. Read [AGENTS.md](AGENTS.md), [Architecture](docs/ARCHITECTURE.md), and [Threat model](docs/THREAT_MODEL.md) before changing behavior.

Run `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, and `pnpm package:check`. Changes to migrations, governance, tokens, injection, transcript projection, or packaging require focused regression tests. Performance-sensitive database changes also run `pnpm benchmark -- --memories 1000 --spaces 10 --relations 1000 --samples 30 --governance-samples 5`. Never commit a SQLite database, WAL/SHM file, token, transcript, `.env`, provider response, screenshot containing user data, or generated coverage output.

Compatibility claims require a fresh tarball install into the exact DSH version, `--dump-config`, a real Web mount, and a browser workflow. Record the command and date in [DSH compatibility](docs/DSH_COMPATIBILITY.md).
