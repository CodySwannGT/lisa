# Expo Verification Capabilities

This rule documents the native and web verification surfaces available in Expo projects. Agents must use these tools when verifying UI changes, features, and bugs.

---

## Environment Strategy

Frontend changes are typically verified against the **remote dev backend**, not a local backend. The backend is generally deployed before the frontend, so the dev environment is the default target for verification.

Use `:local` variants only when explicitly running the companion backend repo locally. Use `:dev` for most verification work.

---

## Native Simulator Testing

Expo manages simulator and emulator lifecycle directly. Never use `xcrun simctl` or manual emulator commands.

### Start Dev Server with Simulator

These commands copy the target environment file, launch the Expo dev server, and open the app in the simulator automatically:

```bash
# iOS Simulator
bun run start:simulator:ios:local       # Against local backend
bun run start:simulator:ios:dev         # Against dev backend (default for verification)
bun run start:simulator:ios:staging     # Against staging backend
bun run start:simulator:ios:production  # Against production backend

# Android Emulator
bun run start:simulator:android:local       # Against local backend
bun run start:simulator:android:dev         # Against dev backend (default for verification)
bun run start:simulator:android:staging     # Against staging backend
bun run start:simulator:android:production  # Against production backend
```

### Build Native Binary and Run on Simulator

These commands compile a full native binary and install it on the simulator. Slower than dev server but closer to production:

```bash
# iOS Simulator
bun run build-and-run:simulator:ios:local       # Against local backend
bun run build-and-run:simulator:ios:dev         # Against dev backend
bun run build-and-run:simulator:ios:staging     # Against staging backend
bun run build-and-run:simulator:ios:production  # Against production backend

# Android Emulator
bun run build-and-run:simulator:android:local       # Against local backend
bun run build-and-run:simulator:android:dev         # Against dev backend
bun run build-and-run:simulator:android:staging     # Against staging backend
bun run build-and-run:simulator:android:production  # Against production backend
```

Use `build-and-run` when testing native modules, push notifications, deep linking, or any feature that requires a full native build.

### Dev Server Only (Manual Simulator Selection)

```bash
bun run start:local   # Start dev server, then press 'i' for iOS or 'a' for Android
```

---

## Native E2E Testing with Maestro

Maestro provides automated native UI testing on simulators and emulators.

### Run All Flows

```bash
bun run maestro:test
```

### Run Smoke Tests Only

```bash
bun run maestro:test:smoke
```

### Interactive Flow Development

```bash
bun run maestro:studio
```

Maestro flows live in `.maestro/flows/`. Tag flows with `smoke` for the smoke test subset.

---

## Web Testing with Playwright

### Run Playwright Tests

```bash
bun run playwright:test          # Build and run all tests
bun run playwright:test:ui       # Build and run with interactive UI
```

### Ad-Hoc Browser Verification

Use the Playwright MCP tools (`browser_snapshot`, `browser_click`, `browser_take_screenshot`, `browser_navigate`, `browser_console_messages`, `browser_network_requests`) for interactive browser verification without writing test files.

---

## Cross-Repo Log Correlation

When debugging frontend issues, errors often originate on the server side. Agents must check both client and server logs to diagnose problems.

### Client-Side Logs

Use the Playwright MCP tools to capture browser logs during verification:

- `browser_console_messages` — Console output (errors, warnings, info, debug)
- `browser_network_requests` — Failed API calls, status codes, response payloads

For native simulators, check the Expo dev server terminal output for Metro bundler errors and React Native logs.

### Server-Side Logs

When the frontend is configured as an additional working directory alongside a companion backend repo (or vice versa), agents have access to both codebases. Use this to:

1. **Read the backend's CLAUDE.md and verification rules** to understand how to check server logs
2. **Check backend logs locally** if the backend is running via `bun run start:local` in the companion repo
3. **Check remote logs** using whatever observability tools the backend documents (CloudWatch, Sentry, etc.)

### Debugging Workflow

When a frontend action produces an error:

1. **Capture the client error** — Use `browser_console_messages` and `browser_network_requests` to identify the failing request (URL, status code, error body)
2. **Correlate with server logs** — Use the companion backend repo's documented log-checking tools to find the corresponding server-side error
3. **Identify the root cause** — Determine whether the issue is a frontend bug (bad request, missing field, wrong query) or a backend bug (server error, schema mismatch, auth failure)
4. **Document both sides** — Include client and server log excerpts in proof artifacts

This cross-repo correlation is especially valuable for:

- GraphQL query errors (client sends bad query vs. server resolver failure)
- Authentication failures (expired token vs. misconfigured auth)
- Data inconsistencies (frontend cache staleness vs. backend data issue)
- Network errors (frontend timeout vs. backend performance)

---

## Deployment

### Authentication

Before deploying, ensure you are logged into EAS:

```bash
bun run eas:whoami    # Check current login status
bun run eas:login     # Log in to Expo account (interactive)
```

### EAS Build (Full Native Deploy)

`eas:deploy` triggers a full native build in the EAS cloud. Use this when native code has changed (new native modules, SDK upgrades, native config changes). Builds take several minutes.

```bash
bun run eas:deploy:dev           # Build for dev environment
bun run eas:deploy:staging       # Build for staging environment
bun run eas:deploy:production    # Build for production environment
```

Build profiles are defined in `eas.json`. Each profile specifies its channel, environment variables, and distribution settings.

### EAS Update (OTA Publish)

`eas:publish` pushes an over-the-air JavaScript bundle update. Use this for JS-only changes (bug fixes, UI tweaks, logic changes) that don't require a new native build. Updates are fast (seconds, not minutes).

```bash
bun run eas:publish:dev          # Publish OTA update to dev channel
bun run eas:publish:staging      # Publish OTA update to staging channel
bun run eas:publish:production   # Publish OTA update to production channel
```

### When to Use Build vs Update

| Scenario | Command |
|----------|---------|
| New native module added | `eas:deploy` (full build required) |
| SDK version upgrade | `eas:deploy` (full build required) |
| Native config change (`app.json`, `eas.json`) | `eas:deploy` (full build required) |
| JS bug fix | `eas:publish` (OTA update) |
| UI change (styles, layout, text) | `eas:publish` (OTA update) |
| New screen or feature (JS-only) | `eas:publish` (OTA update) |

### Deployment Verification

After deploying, verify the deployment landed:

1. **For OTA updates**: Check the EAS dashboard or run `eas update:list` to confirm the update was published to the correct channel
2. **For full builds**: Check the EAS dashboard or run `eas build:list` to confirm the build completed successfully
3. **End-to-end**: Open the app on a device/simulator pointed at the target environment and verify the changes are present

---

## Verification Quick Reference

| Change Type | Verification Method | Command |
|-------------|-------------------|---------|
| UI feature (web) | Playwright MCP tools or tests | `bun run playwright:test` |
| UI feature (native) | Maestro flows | `bun run maestro:test` |
| Unit/integration logic | Jest | `bun run test -- path/to/file` |
| Type safety | TypeScript compiler | `bun run typecheck` |
| Code quality | ESLint | `bun run lint` |
| Native module integration | Build and run on simulator | `bun run build-and-run:simulator:ios:dev` |
| Full native E2E | Maestro smoke suite | `bun run maestro:test:smoke` |
| Client-side errors | Playwright browser logs | `browser_console_messages` MCP tool |
| Server-side errors | Companion backend repo logs | Check backend CLAUDE.md for log commands |
| Deploy (native change) | EAS Build | `bun run eas:deploy:dev` |
| Deploy (JS-only change) | EAS Update (OTA) | `bun run eas:publish:dev` |
| Check EAS auth | EAS CLI | `bun run eas:whoami` |

---

## Verification Patterns for Native Changes

### UI Feature on Native

End user: human on iOS or Android device.

Required proof:

- Maestro flow recording or screenshots from simulator
- Console output showing flow passed

```bash
# Start the app on iOS simulator against dev backend
bun run start:simulator:ios:dev

# Run Maestro verification
bun run maestro:test
```

### Native Module or Platform-Specific Code

End user: application on device.

Required proof:

- Successful native build (no build errors)
- App launches and target feature is functional

```bash
# Build and install native binary against dev backend
bun run build-and-run:simulator:ios:dev

# Verify with Maestro
bun run maestro:test:smoke
```

### Cross-Platform Verification

For changes that affect both web and native, agents must verify on both surfaces:

1. **Web**: Playwright MCP tools or `bun run playwright:test`
2. **Native**: `bun run start:simulator:ios:dev` + `bun run maestro:test`

If only one surface is available, label the result as **PARTIALLY VERIFIED** with explicit gap documentation.
