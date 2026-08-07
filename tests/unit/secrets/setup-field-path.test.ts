/**
 * The setup field must put every install directory on PATH, not just one.
 *
 * `~/.local/bin` is where the *pinned* binaries land. A vendor script installs
 * wherever it likes — SonarQube's puts `sonar` under
 * `~/.local/share/sonarqube-cli/bin` — so a field that exports only the first
 * one reports a successful install of a tool the session cannot find. Observed
 * on a live Claude Tag channel: `aws` resolved, `sonar` read as MISSING, and it
 * was on disk the whole time.
 *
 * The bootstrap does write these into the shell rc files. On a cloud surface
 * that is inert — the tool shell is not a login shell and reads no profile —
 * which is why the field has to carry them itself.
 * @module tests/unit/secrets/setup-field-path
 */

import { describe, expect, it } from "vitest";

import { pathDirs } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/catalogue.mjs";
import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The field's PATH export, as emitted. */
const exported = /export PATH="([^"]*)"/.exec(SETUP_FIELD)?.[1] ?? "";

/**
 * The exact PATH the field must emit, written out rather than computed.
 *
 * Deriving it from `pathDirs` would let the same defect satisfy both sides: a
 * directory dropped from the catalogue would disappear from the expectation
 * too, and the test would stay green through the outage it exists to catch.
 *
 * `$HOME/.local/bin` leads because it holds the pinned, checksummed installs,
 * which must win over whatever the image ships under the same name. `$PATH`
 * trails because dropping it costs the session git, node, and every builtin.
 */
const EXPECTED_PATH = [
  "$HOME/.local/bin",
  "$HOME/.opencode/bin",
  "$HOME/.local/share/sonarqube-cli/bin",
  "$PATH",
];

describe("the PATH the setup field exports", () => {
  it("is exactly the catalogue's directories, in order, then $PATH", () => {
    // A whole-sequence assertion rather than membership: containment cannot see
    // a reordering, and it cannot see an extra absolute path spliced in.
    expect(exported.split(":")).toEqual(EXPECTED_PATH);
  });

  it("fails when the catalogue gains a directory this test does not name", () => {
    // The pairing that makes the hardcoded list safe. A tool added with a new
    // binDir breaks HERE — visibly, with the new directory in the diff —
    // instead of going quietly missing inside a container.
    expect(pathDirs("$HOME")).toEqual(EXPECTED_PATH.slice(0, -1));
  });

  it("leaves $HOME for the container to expand", () => {
    // Emitted on one machine and run as another user in another container. An
    // expanded home would point at the author's laptop.
    expect(exported).not.toMatch(/\/(Users|home)\//);
  });

  it("exports before the secrets phase, which spawns the provider CLI", () => {
    const path = SETUP_FIELD.indexOf("export PATH=");
    const secrets = SETUP_FIELD.indexOf("remote-env --phase=secrets");

    expect(path).toBeGreaterThan(-1);
    expect(secrets).toBeGreaterThan(path);
  });
});
