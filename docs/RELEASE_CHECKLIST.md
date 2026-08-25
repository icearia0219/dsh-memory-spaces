# Release checklist

- Version, Git tag, and changelog entry agree.
- `scripts/release-metadata.mjs` accepts the intended tag and extracts non-empty release notes from the matching changelog section.
- `pnpm install --frozen-lockfile`, lint, typecheck, tests, coverage, build, publint, attw, and pack pass.
- Migration and security tests pass without ignored branches or real paid models.
- Tarball inventory contains required Host/client/types/config/docs and no database, WAL/SHM, token, log, `.env`, transcript, coverage, screenshot, cache, bundled React, or bundled DSH runtime.
- Tarball and source installs pass in fresh profiles for every claimed DSH version.
- `--dump-config`, Web boot, browser E2E, repeated mount, uninstall, and reinstall pass with telemetry disabled.
- The hosted Ubuntu/Windows/macOS and Node 22/24 matrix passes; authored but unexecuted workflow files are not sufficient.
- The 100,000-memory governance latency limitation remains disclosed until pagination or aggregate-specific queries land.
- Primary UI flows pass a dedicated keyboard, screen-reader, contrast, and automated accessibility review before any conformance claim.
- Compatibility, claim-verification, quality-audit, README, security, and backup documents match current evidence.
- npm trusted publishing is configured for the exact GitHub repository, workflow, and `npm` environment; the release uses OIDC provenance without a long-lived plaintext token.
- For the first npm version only, use a short-lived granular `NPM_BOOTSTRAP_TOKEN` environment secret because npm cannot configure a trusted publisher before the package exists. Delete the secret immediately after the first publish, then configure the trusted publisher for `icearia0219/dsh-memory-spaces`, `release.yml`, environment `npm`, and `npm publish`.
- GitHub Release notes use the matching changelog section and state migration risk.
