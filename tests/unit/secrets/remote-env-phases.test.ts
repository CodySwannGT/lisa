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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SURFACES } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import {
  detectInstallCommand,
  emitClaudeWeb,
  selectPhases,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { verifyNotProxied } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/verify-remote-env.mjs";

/** A finding as the verify read-back records it. */
type Finding = { ok: boolean; label: string; detail: string };

/** The two moments a surface can materialize at, as the capability names them. */
const AT_SETUP = "setup";
const AT_SESSION_START = "session-start";
const BUN_INSTALL = "bun install";

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
    // Both remote surfaces may write; only one of them may write during setup.
    expect(SURFACES["codex-cloud"].materializeAt).toBe(AT_SETUP);
    expect(SURFACES["claude-web"].materializeAt).toBe(AT_SESSION_START);
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

describe("install command detection", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-install-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ["bun.lock", BUN_INSTALL],
    ["bun.lockb", BUN_INSTALL],
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
    ["yarn.lock", "yarn install --immutable"],
    ["package-lock.json", "npm ci"],
  ])("reads %s as %s", (lockfile, expected) => {
    writeFileSync(path.join(root, lockfile), "");
    expect(detectInstallCommand(root)).toBe(expected);
  });

  it("refuses to guess when no lockfile identifies the manager", () => {
    // A guessed package manager produces a container that fails on its very
    // first command, with an error that blames the project rather than the guess.
    expect(detectInstallCommand(root)).toBe("<your install command>");
  });
});

describe("emitted Claude configuration", () => {
  const emitted = emitClaudeWeb({
    bootstrapKey: "BWS_ACCESS_TOKEN",
    install: "bun install",
  });

  it("states that emit is the only tier for this surface", () => {
    expect(emitted).toMatch(/no settings page, no/i);
    expect(emitted).toMatch(/no API/i);
  });

  it("puts the install ahead of the setup script", () => {
    expect(emitted).toContain(
      "bun install && bash scripts/lisa-remote-env/setup.sh"
    );
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

  it("says plainly when the bootstrap has not been configured", () => {
    const missing = emitClaudeWeb({ bootstrapKey: null, install: "npm ci" });
    expect(missing).toMatch(/secrets\.bootstrap\.key is not configured/);
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
