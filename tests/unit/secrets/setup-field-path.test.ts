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

describe("the PATH the setup field exports", () => {
  it("carries EVERY directory the catalogue installs into", () => {
    // Derived from the catalogue, so a tool added with a new binDir fails here
    // rather than silently going missing in a container.
    for (const dir of pathDirs("$HOME")) {
      expect(exported.split(":")).toContain(dir);
    }
  });

  it("includes the one that was missing, by name", () => {
    // Named outright: the generic check above passes if pathDirs itself loses
    // the entry, and that is the same outage with a green test.
    expect(exported).toContain("$HOME/.local/share/sonarqube-cli/bin");
  });

  it("puts the pinned binaries first", () => {
    // ~/.local/bin holds the checksummed installs, which must win over whatever
    // the image happens to ship under the same name.
    expect(exported.split(":")[0]).toBe("$HOME/.local/bin");
  });

  it("keeps the inherited PATH last rather than replacing it", () => {
    // Dropping $PATH costs the session git, node, and every image builtin.
    expect(exported.split(":").at(-1)).toBe("$PATH");
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
