/**
 * Closed copy inventory for direct materialized-environment SessionStart.
 *
 * OpenCode installs the canonical Markdown skill verbatim, while Claude,
 * Codex, Cursor, Antigravity, and Copilot have the five checked-in fanout
 * surfaces below. The installed repository copy is the seventh executable
 * boundary: a freshly cloned remote container runs it before plugins exist.
 * @module tests/unit/secrets/remote-env-materialized-parity
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** One checked-in distribution path and the agents it serves. */
interface Distribution {
  readonly agents: readonly string[];
  readonly path: string;
}

const RELATIVE = "skills/lisa-setup-remote-env/assets/session-start.sh";
const SOURCE =
  "plugins/src/base/skills/lisa-setup-remote-env/assets/session-start.sh";
const INSTALLED = "scripts/lisa-remote-env/session-start.sh";
const AUTHORITY_NAME = "materialized-env-authority.mjs";
const FORBIDDEN_FIXTURE_OVERRIDE = /LISA_FIXTURE_[A-Z0-9_]*/u;
const FORBIDDEN_SHELL_AUTHORITY_OVERRIDE =
  /\$\{?[A-Z0-9_]*(?:AUTHORITY|OWNER|UID)[A-Z0-9_]*/u;

const DISTRIBUTIONS: readonly Distribution[] = [
  {
    agents: ["claude", "opencode"],
    path: `plugins/lisa/${RELATIVE}`,
  },
  {
    agents: ["codex"],
    path:
      "plugins/lisa/.codex-plugin/skills/" +
      "lisa-setup-remote-env/assets/session-start.sh",
  },
  {
    agents: ["cursor"],
    path: `plugins/lisa-cursor/${RELATIVE}`,
  },
  {
    agents: ["agy"],
    path: `plugins/lisa-agy/${RELATIVE}`,
  },
  {
    agents: ["copilot"],
    path: `plugins/lisa-copilot/${RELATIVE}`,
  },
];

/**
 * Read one checked-in shell boundary as UTF-8.
 * @param path - Canonical, generated, or installed file path.
 * @returns Exact UTF-8 source for parity comparison.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Replace the SessionStart filename with its authority CLI sibling.
 * @param file - SessionStart path in one supported distribution.
 * @returns Sibling materialized authority module path.
 */
function authorityPath(file: string): string {
  return file.replace("session-start.sh", AUTHORITY_NAME);
}

/**
 * Assert direct sourcing occurs after materialization and before the hook.
 * @param body - SessionStart shell source under review.
 */
function expectDirectBoundary(body: string): void {
  const materialize = body.indexOf("--phase=secrets");
  const direct = body.indexOf("secrets.env");
  const hook = body.indexOf("--phase=hook");

  expect(materialize).toBeGreaterThanOrEqual(0);
  expect(direct).toBeGreaterThan(materialize);
  expect(hook).toBeGreaterThan(direct);
  expect(body).not.toContain("$HOME/.profile");
  expect(body).not.toContain("$HOME/.bashrc");
}

/**
 * Pin SessionStart to one predicate-backed authority command.
 * @param session - SessionStart shell source under review.
 * @param authority - Self-contained authority module source.
 */
function expectAuthorityBoundary(session: string, authority: string): void {
  expect(
    session.match(/node "\$\{here\}\/materialized-env-authority\.mjs"/gu)
  ).toHaveLength(1);
  expect(authority).toContain("materializedOwnersMatch");
  expect(authority.match(/materializedOwnersMatch\(/gu)).toHaveLength(1);
  expect(session).not.toMatch(FORBIDDEN_FIXTURE_OVERRIDE);
  expect(session).not.toMatch(FORBIDDEN_SHELL_AUTHORITY_OVERRIDE);
  expect(authority).not.toContain("process.env");
  expect(authority).not.toMatch(FORBIDDEN_FIXTURE_OVERRIDE);
}

describe("remote materialized environment generated parity", () => {
  it("closes the inventory over all six supported coding agents", () => {
    expect(
      DISTRIBUTIONS.flatMap(row => row.agents).toSorted((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual(["agy", "claude", "codex", "copilot", "cursor", "opencode"]);
  });

  it("keeps generated agent boundaries byte-equal to source", () => {
    const canonical = source(SOURCE);
    const authority = source(authorityPath(SOURCE));
    for (const row of DISTRIBUTIONS) {
      expect(source(row.path), row.agents.join(", ")).toBe(canonical);
      expectDirectBoundary(source(row.path));
      expect(source(authorityPath(row.path))).toBe(authority);
      expectAuthorityBoundary(source(row.path), authority);
    }
  });

  it("keeps the clone-time installed boundary equal and direct", () => {
    expect(source(INSTALLED)).toBe(source(SOURCE));
    expectDirectBoundary(source(INSTALLED));
    const authority = source(authorityPath(SOURCE));
    expect(source(authorityPath(INSTALLED))).toBe(authority);
    expectAuthorityBoundary(source(INSTALLED), authority);
  });
});
