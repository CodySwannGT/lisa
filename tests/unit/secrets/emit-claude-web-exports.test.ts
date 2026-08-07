/**
 * The emitted Claude configuration must carry the exports the script cannot
 * inherit.
 *
 * A cloud setup script sees NONE of the environment's configured variables — it
 * runs while the image is being built, before the environment exists. So a
 * session with no checkout has to be told its tenant inside the script itself.
 * Without that the field finds nothing to prepare, prints "no tenant
 * configured", and exits 0 — indistinguishable from success, which is what made
 * it cost several live attempts to diagnose.
 *
 * The emit template predates the repo-less path, so it documented only the
 * bootstrap variable and left the reader to discover the rest.
 * @module tests/unit/secrets/emit-claude-web-exports
 */

import { describe, expect, it } from "vitest";

import { emitClaudeWeb } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

// The tenant is supplied because that is the case worth asserting: with one,
// every placeholder is filled in and the block is shell that runs as pasted.
// Without one the guidance switches to "re-run with --tenant=", which
// `emit-tenant-provider` covers.
const emitted = emitClaudeWeb({
  bootstrapKey: "BWS_ACCESS_TOKEN_acme",
  tenant: "acme",
  provider: "bitwarden",
});

describe("the repo-less exports in the emitted configuration", () => {
  it("names all three", () => {
    expect(emitted).toContain("export LISA_TENANT=");
    expect(emitted).toContain("export BWS_ACCESS_TOKEN_acme=");
    expect(emitted).toContain("export LISA_SECRETS_SURFACE=claude-web");
  });

  it("uses the project's OWN bootstrap key, not a generic one", () => {
    // The field resolves `BWS_ACCESS_TOKEN_<tenant>`; telling an operator to
    // export the unsuffixed name produces a container that has the credential
    // under a name nothing reads.
    expect(emitted).not.toContain("export BWS_ACCESS_TOKEN=");
  });

  it("puts them BEFORE the field, where they can still take effect", () => {
    // After it, the field has already decided there is no tenant and returned.
    expect(emitted.indexOf("export LISA_TENANT=")).toBeLessThan(
      emitted.indexOf("for f in scripts/")
    );
  });

  it("says why the surface is named rather than left to detection", () => {
    // Detection keys off CLAUDE_CODE_REMOTE. A surface that does not set it
    // falls through to `local`, which is `materialized: false` — no credentials
    // reach disk at all, and the session looks configured but has nothing.
    expect(emitted).toMatch(/CLAUDE_CODE_REMOTE/);
  });

  it("explains that the script cannot see the variables box above it", () => {
    // Without the reason, the three exports read as redundant with the
    // environment variables the operator has already filled in, and the first
    // person to tidy them away reintroduces the silent failure.
    expect(emitted).toMatch(/sees NONE of the variables/i);
  });
});
