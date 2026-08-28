/**
 * Contract tests for phase selection, emitted config, and the proxy read-back.
 *
 * The rule these protect is the one that is easy to get wrong twice: *when* a
 * surface materializes is not the same question as *whether* it may. A surface
 * whose setup script is skipped on a cache hit must materialize somewhere that
 * runs every session, or a rotated credential silently stays stale until the
 * cache expires days later.
 *
 * Every case here is a pure function against synthetic input. Nothing in this
 * file starts a container, reaches a provider, or writes a value to disk.
 * @module tests/unit/secrets/remote-env-phases
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SURFACES } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { assertPinned } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";
import {
  pinEnvironment,
  probe,
  emitClaudeWeb,
  selectPhases,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { verifyNotProxied } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/verify-remote-env.mjs";

/** A finding as the verify read-back records it. */
type Finding = { ok: boolean; label: string; detail: string };

/** The two moments a surface can materialize at, as the capability names them. */
const AT_SETUP = "setup";
const AT_SESSION_START = "session-start";

/** Materializes in the setup run AND from the session-start hook. */
const AT_BOTH = "both";

/**
 * Collect findings without touching the module's own results array.
 * @returns A collector holding its own findings and a matching reporter.
 */
const collect = (): {
  findings: Finding[];
  report: (ok: boolean, label: string, detail: string) => void;
} => {
  const findings: Finding[] = [];
  return {
    findings,
    report: (ok, label, detail) => findings.push({ ok, label, detail }),
  };
};

describe("materialize timing", () => {
  it("records when each surface materializes, not merely whether", () => {
    // Both remote surfaces may write. codex-cloud writes during setup;
    // claude-web writes in BOTH places, because on that surface either one
    // alone has a hole — the setup run is skipped when a cached environment is
    // reused, and the session-start hook cannot fire when Claude Code's project
    // directory is not the repository, which is every cloud environment
    // configured with more than one repo.
    expect(SURFACES["codex-cloud"].materializeAt).toBe(AT_SETUP);
    expect(SURFACES["claude-web"].materializeAt).toBe(AT_BOTH);
    expect(SURFACES.local.materializeAt).toBe(null);
    expect(SURFACES["github-actions"].materializeAt).toBe(null);
  });
});

describe("phase selection", () => {
  it("runs every phase on a surface that materializes during setup", () => {
    expect(selectPhases(undefined, AT_SETUP)).toEqual([
      "toolchain",
      "secrets",
      "hook",
    ]);
  });

  it("omits secrets on a surface that materializes per session", () => {
    // Writing here would produce a copy the surface never refreshes, because
    // this script is skipped whenever a cached environment exists.
    expect(selectPhases(undefined, AT_SESSION_START)).toEqual([
      "toolchain",
      "hook",
    ]);
  });

  it("omits secrets on a surface that never materializes at all", () => {
    expect(selectPhases(undefined, null)).toEqual(["toolchain", "hook"]);
  });

  it("runs only the requested phase when a hook asks for one", () => {
    expect(selectPhases("secrets", AT_SESSION_START)).toEqual(["secrets"]);
  });

  it("no-ops rather than failing when the session-start hook fires locally", () => {
    // The hook is committed to the repository, so it also runs on a developer's
    // machine. Failing there would make every correct local session look broken.
    expect(selectPhases("secrets", null)).toEqual([]);
    expect(selectPhases("secrets", AT_SETUP)).toEqual([]);
  });

  it("rejects a phase name it does not know", () => {
    expect(() => selectPhases("secrts", AT_SETUP)).toThrow(/unknown --phase/i);
  });
});

describe("environment pinning", () => {
  const LOCAL_SETTINGS = path.join(".claude", "settings.local.json");
  let root: string;

  const readSettings = (): Record<string, never> =>
    JSON.parse(readFileSync(path.join(root, LOCAL_SETTINGS), "utf8"));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-pin-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes the id where it outranks the machine-wide default", () => {
    // `/remote-env` stores one value for the whole machine, which is wrong the
    // moment a developer has two projects: an environment's setup script is a
    // repository-relative path, so the wrong one fails to start a session.
    expect(pinEnvironment("env_abc123", root)).toContain(LOCAL_SETTINGS);
    expect(readSettings()).toEqual({
      remote: { defaultEnvironmentId: "env_abc123" },
    });
  });

  it("preserves settings the developer already accumulated", () => {
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, LOCAL_SETTINGS),
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } })
    );
    pinEnvironment("env_xyz", root);
    expect(readSettings()).toEqual({
      permissions: { allow: ["Bash(ls:*)"] },
      remote: { defaultEnvironmentId: "env_xyz" },
    });
  });

  it("replaces only the environment id, leaving sibling remote keys", () => {
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, LOCAL_SETTINGS),
      JSON.stringify({ remote: { defaultEnvironmentId: "old", other: 1 } })
    );
    pinEnvironment("new", root);
    expect(readSettings()).toEqual({
      remote: { defaultEnvironmentId: "new", other: 1 },
    });
  });
});

describe("tool presence probe", () => {
  /**
   * A runner that fails the way a real binary does.
   * @param code Spawn error code — `ENOENT` only when the binary is absent.
   * @param stdout What the tool printed before failing.
   * @param stderr What the tool complained about.
   * @returns A runner that throws that failure.
   */
  const failsWith =
    (code: string | undefined, stdout: string, stderr: string) => () => {
      throw Object.assign(new Error("command failed"), {
        code,
        stdout,
        stderr,
      });
    };

  it("treats a non-zero exit as present, not missing", () => {
    // Info-ZIP's unzip — shipped by both macOS and Ubuntu — parses `--version`
    // one letter at a time, warns that -n and -o conflict, and exits 10.
    // Reading that as absence made `require` fail on a machine that had it.
    const result = probe(
      "unzip",
      failsWith(
        undefined,
        "UnZip 6.00 of 20 April 2009, by Info-ZIP.",
        "caution: both -n and -o specified; ignoring -o"
      )
    );
    expect(result.present).toBe(true);
    expect(result.version).toBe("6.00");
  });

  it("treats a failure to spawn as genuinely missing", () => {
    const result = probe("nope", failsWith("ENOENT", "", ""));
    expect(result).toEqual({ present: false, version: null });
  });

  it("reads the version from a clean run", () => {
    const result = probe("node", () => "v22.22.0\n");
    expect(result).toEqual({ present: true, version: "22.22.0" });
  });
});

describe("emitted Claude configuration", () => {
  const emitted = emitClaudeWeb({
    bootstrapKey: "BWS_ACCESS_TOKEN",
    install: "bun install",
    repoDir: "lisa",
  });

  it("states that emit is the only tier for this surface", () => {
    expect(emitted).toMatch(/no settings page, no/i);
    expect(emitted).toMatch(/no API/i);
  });

  // The repo-less exports the emitted guidance must carry are covered in
  // `emit-claude-web-exports`, which keeps this file inside its line budget.

  it("emits one setup line that is identical for every project", () => {
    // Previously this named the repository and the package manager, so a
    // Claude environment for an npm project and one for a bun project differed
    // by a string a human had to get right — in a settings box with no review,
    // no version history and no test. The script finds the checkout itself and
    // reads the package manager from the committed lockfile.
    // cwd-relative FIRST. Codex Cloud's checkout is not under $HOME at all, so
    // a field that led with a $HOME glob matched nothing there and bash got a
    // path containing a literal asterisk. $HOME is a later fallback, for the
    // case where cwd is neither the checkout nor its parent — that ordering is
    // the invariant, which the behavioural tests in remote-env-setup-field
    // exercise against each layout.
    expect(emitted).toContain("for f in scripts/lisa-remote-env/setup.sh");
    expect(emitted.indexOf("for f in scripts/")).toBeLessThan(
      emitted.indexOf('"$HOME"')
    );
    expect(emitted).not.toMatch(/cd '?lisa'?/);
    expect(emitted).not.toContain("bun install &&");
  });

  it("explains the setup line it actually printed, on both surfaces", () => {
    // The paragraph under the field drifted twice behind the field itself: it
    // still told the operator that "the glob is what locates it" after the
    // locator had become cwd-relative, and it named Claude Code web as the
    // only surface — the exact assumption that made the old $HOME-only field
    // fail on Codex Cloud. Prose in a settings box is the only explanation an
    // operator gets, so it is pinned to the field rather than left to rot.
    const paragraph = emitted
      .slice(emitted.indexOf("This line is identical"))
      .split("\n\n")[0];
    expect(paragraph).toMatch(/Codex Cloud/);
    expect(paragraph).toMatch(/Claude Code web/);
    expect(paragraph).toMatch(/relative to cwd/i);
    expect(paragraph).not.toMatch(/the glob is what locates/i);
    // Naming neither the repository nor the package manager is why one line
    // works everywhere, and it is the claim most likely to be quietly lost.
    expect(paragraph).toMatch(/names this\s+repository or its package manager/);
  });

  it("uses custom network access so the credential manager can be reached", () => {
    expect(emitted).toContain("Network access:  Custom");
    expect(emitted).toMatch(/credential manager API/i);
    expect(emitted).not.toContain("Trusted, or Custom");
  });

  it("asks for the bootstrap and warns who else can read it", () => {
    expect(emitted).toContain("BWS_ACCESS_TOKEN=");
    expect(emitted).toMatch(/readable by anyone who uses the environment/i);
    expect(emitted).toMatch(/organization-shared/i);
  });

  it("wires the session-start hook and says why it exists", () => {
    expect(emitted).toContain("session-start.sh");
    expect(emitted).toMatch(/skipped whenever a cached environment exists/i);
  });

  it("names the base-image surprises rather than leaving them to be discovered", () => {
    expect(emitted).toMatch(/GitHub CLI is not pre-installed/i);
    expect(emitted).toContain("proxy-injected");
  });

  it("says how to fill the bootstrap in, rather than naming a config path", () => {
    // It used to print `<secrets.bootstrap.key is not configured>`, which reads
    // as an error in a file the operator of a repo-less surface does not have.
    // The actionable version names the flag that resolves it.
    const missing = emitClaudeWeb({
      bootstrapKey: null,
      install: "npm ci",
      repoDir: "lisa",
    });

    expect(missing).toMatch(/Re-run with --tenant=/);
  });
});

describe("proxy read-back", () => {
  it("fails a credential that is only a proxy stand-in", () => {
    // Present and non-empty, so a presence check passes — while any consumer
    // reading the variable receives the placeholder instead of a credential.
    const { findings, report } = collect();
    verifyNotProxied(
      ["GITHUB_TOKEN"],
      { GITHUB_TOKEN: "proxy-injected" },
      report
    );
    expect(findings[0].ok).toBe(false);
    expect(findings[0].detail).toMatch(/substituted at egress/i);
  });

  it("passes a real credential without printing it", () => {
    const { findings, report } = collect();
    verifyNotProxied(["API_KEY"], { API_KEY: "sk-live-do-not-print" }, report);
    expect(findings[0].ok).toBe(true);
    expect(JSON.stringify(findings)).not.toContain("sk-live-do-not-print");
  });

  it("fails a declared credential that is absent", () => {
    const { findings, report } = collect();
    verifyNotProxied(["MISSING"], {}, report);
    expect(findings[0].ok).toBe(false);
    expect(findings[0].detail).toMatch(/not present/i);
  });
});

/** The install kind gh needs, since it publishes no Linux zip. */
const RELEASE_TAR = "release-tar";

describe("pinned tarball installs", () => {
  // gh publishes no zip for Linux — only .deb, .rpm and .tar.gz — so a
  // zip-only installer could not pin the very CLI that Lisa's own commit and
  // push guardrails shell out to. A cloud container ships without it, which is
  // why a dispatched session could not commit at all.
  it("requires a url and a checksum, exactly like a zip", () => {
    expect(() =>
      assertPinned({ name: "gh", install: RELEASE_TAR, url: "https://x/y.tgz" })
    ).toThrow(/needs both url and sha256/);
    expect(() =>
      assertPinned({ name: "gh", install: RELEASE_TAR, sha256: "a".repeat(64) })
    ).toThrow(/needs both url and sha256/);
  });

  it("accepts a fully pinned tarball", () => {
    expect(() =>
      assertPinned({
        name: "gh",
        install: RELEASE_TAR,
        url: "https://x/y.tgz",
        sha256: "a".repeat(64),
      })
    ).not.toThrow();
  });

  it("names the tar kind when refusing an unknown one", () => {
    // The message is where an operator learns which kinds exist at all.
    expect(() => assertPinned({ name: "x", install: "release-deb" })).toThrow(
      /Supported: release-zip, release-tar, release-tree, release-binary, npm-global/
    );
  });

  it("pins gh with a checksum and a path inside the archive, on every platform", () => {
    // Release archives nest under a versioned directory, so a bare name would
    // resolve to nothing and the install would fail after the download.
    //
    // Asserted per platform rather than once. gh ships a .tar.gz for Linux and
    // a .zip for macOS, and the nested directory is named after the platform
    // too — so a block copied from another one and edited halfway produces a
    // download that succeeds and an install that cannot find its binary.
    const cfg = JSON.parse(readFileSync(".lisa.config.json", "utf8")) as {
      remoteEnv: {
        tools: {
          install: readonly {
            name: string;
            version: string;
            platforms?: Record<string, Record<string, string>>;
          }[];
        };
      };
    };
    const gh = cfg.remoteEnv.tools.install.find(t => t.name === "gh");

    expect(gh).toBeDefined();
    const platforms = Object.entries(gh?.platforms ?? {});
    expect(platforms.length).toBeGreaterThan(1);

    for (const [platform, block] of platforms) {
      expect([RELEASE_TAR, "release-zip"], platform).toContain(block.install);
      expect(block.sha256, platform).toMatch(/^[0-9a-f]{64}$/);
      expect(block.binary, platform).toMatch(/\/bin\/gh$/);
      // The pin and the URL must agree, or a version bump silently installs the
      // old binary under the new number.
      expect(block.url, platform).toContain(`v${gh?.version}`);
      // And the archive must be the one this platform can actually run: the
      // failure being prevented is a Linux binary landing on a laptop.
      expect(block.binary, platform).toContain(gh?.version ?? "");
    }
  });
});
