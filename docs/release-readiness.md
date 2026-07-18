# AI History Recall Release Readiness

This document is the production handoff for signing, notarization, Windows signing, and automatic updates. The repository can already build unsigned development installers. A production release must pass the gates below before any artifact is distributed outside a trusted development channel.

## Current Status

- macOS DMG and Windows NSIS/MSI development installers are built by `.github/workflows/desktop-build.yml`.
- Development installers are intentionally unsigned.
- The app bundles the UI, daemon, browser extension copy, and Node runtime under Tauri resources.
- `npm run release:check` verifies the release configuration that is safe to check without secrets.
- `npm run release:check -- --production` additionally requires signing, notarization, Windows signing, and update secrets in the environment.

## Production Release Gates

1. Run the local verification set:

   ```bash
   npm run lint
   npm test
   npm run build
   npm run release:check
   cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
   ```

2. Confirm product metadata:

   - `src-tauri/tauri.conf.json` has a stable reverse-DNS identifier.
   - Tauri version and Git tag use the same semver value.
   - Bundled resources include `daemon`, `ui`, `extension`, and `runtime`.

3. Configure macOS signing and notarization secrets:

   - `APPLE_CERTIFICATE_P12_BASE64`
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_DEVELOPER_ID_APPLICATION`
   - `APPLE_ID`
   - `APPLE_TEAM_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`

4. Configure Windows signing secrets:

   - `WINDOWS_CODESIGN_CERT_PFX_BASE64`
   - `WINDOWS_CODESIGN_CERT_PASSWORD`
   - `WINDOWS_TIMESTAMP_URL`

5. Configure update signing and hosting:

   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   - `AIHR_UPDATE_BASE_URL`

6. Run the production secret gate in CI or a local release shell:

   ```bash
   npm run release:check -- --production
   ```

7. Build signed artifacts only on native runners:

   - macOS: build DMG on macOS, sign the app bundle, notarize, staple, then verify Gatekeeper assessment.
   - Windows: build NSIS/MSI on Windows, Authenticode-sign every installer and executable, then verify the signature and timestamp.

8. Publish update metadata only after signed artifact verification succeeds.

9. Keep at least one previous signed release available for rollback.

## Automatic Update Plan

The production update channel should be static and rollback-friendly:

- Host signed installers and update manifests under `AIHR_UPDATE_BASE_URL`.
- Use immutable versioned artifact URLs.
- Publish a manifest only after signed artifacts pass install and launch smoke tests.
- Keep the previous manifest and artifacts available for rollback.
- Never publish an update that changes the local database schema without a backup/restore validation pass.

## CI Implementation Checklist

When release credentials are available, add a production workflow or release job with these steps:

1. Import the macOS Developer ID certificate into a temporary keychain.
2. Import the Windows PFX certificate into the Windows certificate store or pass it to the signing tool.
3. Run `npm run release:check -- --production`.
4. Run the same JS/Rust verification used by the unsigned desktop workflow.
5. Run `npm run desktop:prepare`.
6. Build platform installers with `npx tauri build`.
7. Sign and notarize macOS artifacts.
8. Sign Windows artifacts and verify timestamped signatures.
9. Generate and sign updater metadata.
10. Upload release artifacts and update metadata.
11. Run a smoke test from the final packaged artifacts.

## Acceptance Evidence

A release is ready when the release ticket links to:

- The exact Git tag and commit.
- `npm run release:check -- --production` output.
- macOS signing identity, notarization result, staple verification, and Gatekeeper assessment output.
- Windows Authenticode verification output for NSIS/MSI and bundled executables.
- Update manifest URL, signature verification output, and rollback URL.
- DMG/Windows installer smoke-test notes.
