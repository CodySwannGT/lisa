/**
 * A tool that installs outside `~/.local/bin` must still be reachable from it.
 *
 * The catalogue records where a vendor script puts its binary — SonarQube's
 * lands in `~/.local/share/sonarqube-cli/bin` — and nothing made that directory
 * reachable in a cloud container. The bootstrap edits the shell rc files, which
 * a container's tool shell never reads because it is not a login shell; and an
 * `export PATH` inside the setup script dies with that process. Only the
 * filesystem survives into the session.
 *
 * Observed on a live Claude Tag channel: `~/.local/share/sonarqube-cli` existed,
 * `command -v sonar` came back empty, and the tool selection that asked for it
 * looked like it had failed.
 * @module tests/unit/workstation/link-into-bin-dir
 */

import { existsSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { linkIntoBinDir } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation.mjs";

/** A catalogue entry shaped like the one that exposed this. */
const SONAR = {
  name: "sonar",
  binDir: "~/.local/share/sonarqube-cli/bin",
};

/** Where the vendor installer actually drops the binary, relative to home. */
const INSTALLED = ".local/share/sonarqube-cli/bin/sonar";

let home: string;

/**
 * The link the tool must become reachable through.
 * @returns Absolute path to `~/.local/bin/sonar`.
 */
function linkPath(): string {
  return path.join(home, ".local", "bin", SONAR.name);
}

/**
 * Create a file where a vendor installer would have put its binary.
 * @param relative Path under the fake home.
 */
function place(relative: string): void {
  const full = path.join(home, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "#!/bin/sh\n");
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-link-")));
});

describe("linkIntoBinDir", () => {
  it("links a tool installed elsewhere into ~/.local/bin", () => {
    place(INSTALLED);

    linkIntoBinDir(SONAR, { home });

    const link = linkPath();
    expect(existsSync(link)).toBe(true);
    expect(readlinkSync(link)).toBe(path.join(home, INSTALLED));
  });

  it("creates ~/.local/bin when the install has not made it yet", () => {
    // Ordering is not guaranteed: a vendor script may be the first thing to run
    // on a fresh container, before anything has created the bin directory.
    place(INSTALLED);

    linkIntoBinDir(SONAR, { home });

    expect(existsSync(linkPath())).toBe(true);
  });

  it("replaces a stale link rather than leaving it", () => {
    // A link left by an earlier version, pointing where the vendor no longer
    // installs, is worse than no link: it resolves and fails at the moment of
    // use.
    place(INSTALLED);
    place(".local/old/sonar");
    mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    writeFileSync(linkPath(), "stale\n");

    linkIntoBinDir(SONAR, { home });

    expect(readlinkSync(linkPath())).toBe(path.join(home, INSTALLED));
  });

  it("does nothing when the binary is not where the catalogue says", () => {
    // The install failed. Writing a dangling link would turn that into a
    // `command -v` hit and move the error to the moment of use.
    linkIntoBinDir(SONAR, { home });

    expect(existsSync(linkPath())).toBe(false);
  });

  it("does nothing for an entry that installs into ~/.local/bin already", () => {
    // No binDir means the pinned installers, which land there by construction.
    linkIntoBinDir({ name: "bws" }, { home });

    expect(existsSync(path.join(home, ".local", "bin", "bws"))).toBe(false);
  });

  it("honours a binary name that differs from the command", () => {
    place(".local/share/x/bin/opencode-bin");

    linkIntoBinDir(
      {
        name: "opencode",
        binary: "opencode-bin",
        binDir: "~/.local/share/x/bin",
      },
      { home }
    );

    expect(readlinkSync(path.join(home, ".local", "bin", "opencode"))).toBe(
      path.join(home, ".local/share/x/bin/opencode-bin")
    );
  });

  it("never throws, so the probe stays the authority on success", () => {
    // A symlink error standing in for the real diagnosis is a worse report than
    // "installer exited 0 but sonar is still not on PATH".
    place(INSTALLED);

    expect(() =>
      linkIntoBinDir(SONAR, {
        home,
        link: () => {
          throw new Error("EPERM");
        },
      })
    ).not.toThrow();
  });
});
