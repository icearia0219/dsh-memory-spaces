# Release checklist

- Version, Git tag, and changelog entry agree.
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
- GitHub Release notes use the matching changelog section and state migration risk.
