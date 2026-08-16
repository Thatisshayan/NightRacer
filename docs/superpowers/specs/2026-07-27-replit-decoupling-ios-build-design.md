# Replit decoupling, sub-project 3: iOS build pipeline

Part of the larger Replit-decoupling effort (database → web hosting → **iOS build
pipeline** → CI check). Sub-projects 1 (Neon) and 2 (Vercel hosting) are done.

**Approval:** repo owner (Shayan) directed this in conversation on 2026-07-27, explicitly
requesting a GitHub Actions iOS build workflow rather than EAS Build (Expo's cloud build
service) — a scoping decision made together, not unilateral.

## Decision

Keep `artifacts/warboss-highway-mobile` as a React Native + Expo Router app (no migration
off Expo SDK/Router — that was explicitly ruled out as too large a scope). Replace only
the *build/distribution mechanism*: instead of EAS Build's cloud queue, a GitHub Actions
macOS runner runs `expo prebuild` to generate the native `ios/` project (not committed —
regenerated fresh every run, matching Expo's Continuous Native Generation model), then
builds, signs, and archives it with plain `xcodebuild` — no Fastlane, no EAS.

- PRs touching the mobile app: build + archive + export an IPA, uploaded as a GitHub
  Actions artifact. Proves it compiles; nothing shipped anywhere.
- Pushes to `main`: same, plus an additional `xcodebuild -exportArchive` with
  `destination: upload`, which uploads directly to TestFlight using the App Store Connect
  API key (no `xcrun altool` — that path is being phased out by Apple; `xcodebuild` doing
  the upload itself, given the key directly, sidesteps altool's private-key-file lookup
  convention entirely).

## What was done

**Apple-side setup**, done via the App Store Connect API (JWT-authenticated with the
API key the user provided) rather than clicking through the web portal, except where the
API doesn't allow it:
- Registered bundle ID `com.warbosshighway.app` (id `NPK45P7542`) — automatable.
- **App Store Connect app record creation is NOT automatable** — confirmed by trying:
  `POST /v1/apps` returns `403 FORBIDDEN_ERROR`, "The resource 'apps' does not allow
  'CREATE'. Allowed operations are: GET_COLLECTION, GET_INSTANCE, UPDATE." This is a hard
  platform restriction, not a permissions/role issue — Apple requires app records to be
  created through the web UI regardless of API key role. **The user still needs to do
  this manually**: App Store Connect → My Apps → + → New App, using bundle ID
  `com.warbosshighway.app`, matching the name/SKU used below. TestFlight uploads will fail
  until this exists.
- Found 3 existing `IOS_DISTRIBUTION` certificates already on the Apple team (all named
  "Shayan Salimi", presumably from other apps) — Apple caps this type at 3 per account.
  With explicit user confirmation, revoked the oldest (`VRY42BVQ49`, expiring 2027-06-04)
  and created a fresh one (`59483WUGHW`) dedicated to this project, since I don't have the
  private keys for the other two and couldn't reuse them.
- Generated an RSA 2048 keypair + CSR locally, submitted it to get the signed
  certificate, packaged it into a `.p12` with a randomly-generated password.
- Created an `IOS_APP_STORE` provisioning profile (`382AM5SKCX`) referencing the bundle ID
  and the new certificate.
- Set 6 GitHub Actions secrets: `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_P12_PASSWORD`,
  `IOS_PROVISIONING_PROFILE_BASE64`, `APP_STORE_CONNECT_KEY_ID`,
  `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`. Deleted all local scratch
  copies of the private key/cert/profile material afterward.

**Workflow**: `.github/workflows/ios-build.yml` — checkout → pnpm install (workspace
root) → `expo prebuild --platform ios` → import cert+profile into a temporary CI keychain
→ `xcodebuild archive` (manual signing) → `xcodebuild -exportArchive` (produces an IPA,
uploaded as a build artifact) → on `main` only, a second export with `destination: upload`
ships it to TestFlight.

## Known unknowns going into the first real CI run

This could not be tested locally (no macOS machine available in this session) — the
first real signal comes from an actual GitHub Actions run:
- The exact Xcode workspace/scheme names `expo prebuild` generates from `app.json`'s
  `name`/`slug` (`ios/warbosshighway.xcworkspace`, scheme `warbosshighway` are best-guess,
  not confirmed).
- Whether `macos-15`'s default Xcode version is compatible with Expo SDK 54's native
  requirements (React Native new architecture is enabled per `app.json`).
- Whether the codesigning keychain/partition-list setup works exactly as written on a
  fresh CI runner (this pattern is standard but every detail — keychain search-list
  ordering, `security import` flags — has failed in subtly different ways across
  Xcode/macOS versions in the wild).

Expect this to need at least one iteration once the workflow actually runs.

## Not in scope / not done here

- The mobile app's own `dev` script and `app.json`'s expo-router `origin` field
  (`https://replit.com/`) are still Replit-specific — untouched, since this sub-project is
  about the *production build/distribution pipeline*, not the local dev experience.
- Android build pipeline — not requested, not started.
- The hand-rolled `scripts/build.js` + `server/` static-bundle-hosting system (the one
  with the CodeRabbit-flagged path-traversal/SSRF findings from PR #4's review) is
  unrelated to this — that was for serving a web-viewable Expo Go bundle, not native iOS
  builds. Still present, still has those findings open.
