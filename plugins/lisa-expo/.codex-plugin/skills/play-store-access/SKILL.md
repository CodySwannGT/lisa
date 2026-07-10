---
name: play-store-access
description: "Read-only Google Play Console…"
version: 1.0.0
license: MIT
allowed-tools:
  - Bash
  - Read
---

# Play Store Access: $ARGUMENTS

Read-only access layer for Google Play release state in Expo projects. Use it to
answer whether the Android app is live, halted, draft, or in staged rollout on a
Play track after EAS submission.

This skill MUST NOT promote tracks, change rollout percentages, create releases,
or submit builds. EAS remains the submission path.

## Invocation Contract

```text
operation: setup
operation: production-status [track:production] [package:<android.package>]
operation: track-status track:<track> [package:<android.package>]
operation: resolve-package
```

Return a concise result with the package name, track, release `name` /
`versionCodes`, `status`, `userFraction` when present, and any `countryTargeting`
or in-app update priority fields present in the API response.

## Configuration

Project-safe config can live in `.lisa.config.json`:

```json
{
  "playStore": {
    "packageName": "com.example.app",
    "track": "production"
  }
}
```

Local credential config belongs in `.lisa.config.local.json`, which must stay
gitignored:

```json
{
  "playStore": {
    "serviceAccountKeyPath": "./google-play-service-account.json"
  }
}
```

Supported credential locations, in resolution order:

1. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` containing the raw service-account JSON.
2. `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64` containing base64 JSON.
3. `.lisa.config.local.json` `playStore.serviceAccountKeyPath`.
4. Darwin keychain item `lisa-google-play` account `<packageName>`.

Fail closed if no credential is available. Never prompt indefinitely and never
fall back to Play Console UI scraping.

## One-Time Setup Flow

For `operation: setup`:

1. Confirm the project is an Expo app by checking for `app.json`,
   `app.config.json`, `app.config.js`, or `app.config.ts`.
2. Resolve or ask the operator to provide the Android package name. Prefer
   `.lisa.config.json` `playStore.packageName`, then `expo.android.package` from
   app config.
3. In Google Cloud Console, create a service account dedicated to read-only Play
   release visibility and create a JSON key for it.
4. In Play Console, open **Setup -> API access**, link the Google Cloud project if
   needed, then grant the service-account email app access with read-level
   release visibility. Do not grant release-management write permissions for v1.
5. Store the key locally using one of the credential locations above. If using a
   path, add the path to `.gitignore` and record only the path in
   `.lisa.config.local.json`.
6. Record non-secret defaults in `.lisa.config.json`:

   ```bash
   jq '.playStore.packageName = "com.example.app" | .playStore.track = "production"' \
     .lisa.config.json > /tmp/lisa-config.json && mv /tmp/lisa-config.json .lisa.config.json
   ```

The key material itself must never be committed.

## Resolve Package Name

Resolution order:

1. Explicit `package:<value>` argument.
2. `.lisa.config.json` `playStore.packageName`.
3. `app.json` / `app.config.json` `expo.android.package`.
4. `app.config.ts` / `app.config.js` by running Expo config export:

   ```bash
   npx expo config --json | jq -r '.android.package // empty'
   ```

If the package still cannot be resolved, fail with:

```text
Error: Google Play package name is not configured. Set playStore.packageName in .lisa.config.json or pass package:<name>.
```

## Read Track State

The androidpublisher API requires an edit even for track reads. Create the edit,
list the track, then delete the edit. Do not commit the edit.

```bash
PACKAGE_NAME="${PACKAGE_NAME:-$(jq -r '.playStore.packageName // empty' .lisa.config.json)}"
TRACK="${TRACK:-$(jq -r '.playStore.track // "production"' .lisa.config.json)}"
KEY_PATH="$(jq -r '.playStore.serviceAccountKeyPath // empty' .lisa.config.local.json 2>/dev/null)"

read_service_account_json() {
  if [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
    printf '%s' "$GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"
    return
  fi
  if [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64:-}" ]; then
    printf '%s' "$GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64" | base64 --decode 2>/dev/null ||
      printf '%s' "$GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64" | base64 -D
    return
  fi
  if [ -n "$KEY_PATH" ] && [ -f "$KEY_PATH" ]; then
    cat "$KEY_PATH"
    return
  fi
  if [ "$(uname -s)" = "Darwin" ] && [ -n "$PACKAGE_NAME" ]; then
    security find-generic-password -s lisa-google-play -a "$PACKAGE_NAME" -w 2>/dev/null
    return
  fi
}

SERVICE_ACCOUNT_JSON="$(read_service_account_json)"
[ -n "$SERVICE_ACCOUNT_JSON" ] || {
  echo "Error: no Google Play service-account key found. Run play-store-access operation: setup." >&2
  exit 1
}
[ -n "$PACKAGE_NAME" ] || {
  echo "Error: Google Play package name is not configured. Set playStore.packageName or pass package:<name>." >&2
  exit 1
}

ACCESS_TOKEN="$(
  SERVICE_ACCOUNT_JSON="$SERVICE_ACCOUNT_JSON" node <<'NODE'
const crypto = require("crypto");

const account = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
const now = Math.floor(Date.now() / 1000);
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
  iss: account.client_email,
  scope: "https://www.googleapis.com/auth/androidpublisher",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
})}`;
const signature = crypto
  .createSign("RSA-SHA256")
  .update(unsigned)
  .sign(account.private_key, "base64url");

fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  }),
})
  .then(async (response) => {
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    process.stdout.write(body.access_token);
  })
  .catch((error) => {
    console.error(`Error: failed to obtain Google Play access token: ${error.message}`);
    process.exit(1);
  });
NODE
)"

BASE="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}"
EDIT_ID="$(curl -fsS -X POST "${BASE}/edits" -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq -r '.id')"
trap 'curl -fsS -X DELETE "${BASE}/edits/${EDIT_ID}" -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null 2>&1 || true' EXIT

curl -fsS "${BASE}/edits/${EDIT_ID}/tracks/${TRACK}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" |
  jq --arg packageName "$PACKAGE_NAME" \
    '{packageName: $packageName, track: .track, releases: (.releases // [])}'
```

Interpretation:

- `status: completed` means the release is live on that track.
- `status: inProgress` means staged rollout; inspect `userFraction`.
- `status: halted` means rollout was stopped.
- `status: draft` means it is not live.
- Absence of a production release means the app has no watchable production-track
  release through the API.

Known limitation: androidpublisher exposes track/release state well, but
pre-publication review state is coarse. The reliable watchable signal is whether
the target version is live on the production track.

## Error Handling

- `401` / token exchange failure: service-account key is invalid or expired.
- `403`: service account is not invited to the Play Console app or lacks read
  access to releases.
- `404`: package name is wrong, the app is not created in Play Console, or the
  service account has no access to that app.

In all cases, report the package name and credential source used, but never print
private key material or the access token.
