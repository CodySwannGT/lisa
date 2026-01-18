# npm Publishing Setup for @codyswann/lisa

This document captures the setup process for npm publishing with OIDC trusted publishing.

## Current Status

- [x] Package published: [@codyswann/lisa@1.0.0](https://www.npmjs.com/package/@codyswann/lisa)
- [x] Workflows updated for OIDC (PR #2)
- [ ] Delete temporary granular token
- [ ] Configure OIDC trusted publisher on npmjs.com
- [ ] Merge PR #2

## Remaining Steps

### 1. Delete the Temporary Token

Go to [npmjs.com/settings/codyswann/tokens](https://www.npmjs.com/settings/codyswann/tokens) and delete the `lisa-first-publish` token (or any token created for the initial publish).

### 2. Configure OIDC Trusted Publisher

1. Go to [npmjs.com/package/@codyswann/lisa/access](https://www.npmjs.com/package/@codyswann/lisa/access)
2. Click **Trusted Publishers** → **Add GitHub Actions**
3. Fill in:
   - **Organization/User**: `CodySwannGT`
   - **Repository**: `lisa`
   - **Workflow filename**: `publish.yml` (must match exactly)
   - **Environment**: *(leave blank)*
4. Click **Save**

### 3. Set Package 2FA Policy

On the same access page, select:
- **"Require two-factor authentication and disallow tokens (recommended)"**

This is secure because OIDC doesn't use tokens - it uses short-lived credentials.

### 4. Merge the PR

Merge [PR #2](https://github.com/CodySwannGT/lisa/pull/2) to enable OIDC publishing.

After merging, future pushes to `main` will automatically publish new versions via OIDC.

---

## Troubleshooting

### WebAuthn "A request is already pending" Error

If you see this error on npmjs.com:
```
OperationError: A request is already pending
```

**Fix:**
1. Look for an existing passkey dialog (might be behind windows or in another tab)
2. Close/cancel any pending authentication dialogs
3. Refresh the npm page
4. Try again - click the button only once and wait
5. If it persists, try a different browser or restart your computer

### npm CLI Asks for OTP but You Only Have Passkeys

npm's WebAuthn/passkeys don't work properly with CLI publishing. Solutions:

1. **Use OIDC trusted publishing** (recommended) - no tokens needed
2. **Create a granular access token** with "Bypass 2FA" enabled for manual publishes

### Package Name Already Taken

The name `lisa` was taken on npm. We use the scoped name `@codyswann/lisa` instead.

---

## How OIDC Trusted Publishing Works

1. GitHub Actions workflow runs with `id-token: write` permission
2. GitHub generates a short-lived OIDC token for the workflow
3. npm verifies the token matches your trusted publisher configuration
4. Package publishes without any stored secrets

**Benefits:**
- No tokens to manage, rotate, or leak
- Automatic provenance attestations
- Short-lived credentials (can't be stolen and reused)

---

## Reference: First-Time Publish Process

For future reference, here's how the first publish was done:

```bash
# 1. Login to npm
npm login

# 2. Create granular token on npmjs.com with:
#    - Permissions: Read and write
#    - Packages: All packages
#    - Bypass 2FA: ENABLED

# 3. Publish with token
npm publish --access public \
  --registry=https://registry.npmjs.org \
  --//registry.npmjs.org/:_authToken=YOUR_TOKEN

# 4. Delete the token after publishing
# 5. Configure OIDC trusted publisher for future releases
```
