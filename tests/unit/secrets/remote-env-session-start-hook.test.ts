/**
 * What the session-start hook is responsible for running.
 *
 * A cloud environment skips its setup script whenever a filesystem cache
 * exists, so anything that only runs there goes stale: it is re-run when the
 * vendor's setup field changes, or after roughly seven days, and not otherwise.
 *
 * This hook is part of the clone rather than the snapshot, which makes it the
 * one place that runs on every session regardless of cache state. The secrets
 * phase already lived here for that reason. The toolchain had the same
 * staleness problem and no answer to it — a tool added to `remoteEnv.tools` was
 * invisible to a cached container, so a pin could be merged, correct, and
 * simply absent from the next session.
 * @module tests/unit/secrets/remote-env-session-start-hook
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("session-start hook covers the complete cached-session lifecycle", () => {
  const TOOLCHAIN_PHASE = "--phase=toolchain";
  const SECRETS_PHASE = "--phase=secrets";
  const HOOK_PHASE = "--phase=hook";
  const HOOK = readFileSync(
    "plugins/src/base/skills/lisa-setup-remote-env/assets/session-start.sh",
    "utf8"
  );

  it("runs the toolchain and project hook, not only secrets", () => {
    // The toolchain used to run only from the environment setup script, which a
    // cached environment SKIPS. A tool added to remoteEnv.tools was therefore
    // invisible until the cache expired about a week later, or until someone
    // edited the vendor's setup field by hand to force a rebuild — so a
    // container could be missing a tool its own committed config pins.
    //
    // This hook is part of the clone, so it is the one place that runs every
    // session regardless of cache state.
    expect(HOOK).toContain(TOOLCHAIN_PHASE);
    expect(HOOK).toContain(SECRETS_PHASE);
    expect(HOOK).toContain(HOOK_PHASE);
  });

  it("runs toolchain, secrets, and hook in full-setup order", () => {
    // Materializing needs the provider CLI the toolchain step installs. Run the
    // other way round, a missing binary is reported as a missing credential.
    expect(HOOK.indexOf(TOOLCHAIN_PHASE)).toBeLessThan(
      HOOK.indexOf(SECRETS_PHASE)
    );
    expect(HOOK.indexOf(SECRETS_PHASE)).toBeLessThan(HOOK.indexOf(HOOK_PHASE));
  });

  it("returns the project hook result to the session host", () => {
    // `set -e` makes the first two phases fatal. The final phase is exec'd so
    // its non-zero status is not swallowed by a wrapper that exits cleanly.
    expect(HOOK).toContain('exec bash "${here}/setup.sh" --phase=hook "$@"');
  });

  it("still does nothing at all on a developer machine", () => {
    // The hook is committed, so it fires on every local session too. Doing the
    // remote work there would be noise on every single startup.
    expect(HOOK).toContain('if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]');
  });
});
