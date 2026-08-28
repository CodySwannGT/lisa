/**
 * Behavioral RED for sourcing Lisa's exact materialized environment directly.
 *
 * The real SessionStart asset runs with a profile that returns before its
 * Lisa-managed block. Success therefore cannot come from profile control flow.
 * @module tests/unit/secrets/remote-env-materialized-direct-source
 */
import { readFileSync, rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  artifactIdentity,
  createMaterializedFixture,
  HOSTILE_VALUE,
  readFixtureFile,
  runMaterializedSession,
} from "../../helpers/remote-env-materialized-fixture.js";

const roots: string[] = [];

/**
 * Create a fixture and register its bounded cleanup.
 * @returns The isolated materialized environment fixture.
 */
function fixture(): ReturnType<typeof createMaterializedFixture> {
  const created = createMaterializedFixture();
  roots.push(created.root);
  return created;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("remote SessionStart direct materialized environment", () => {
  it("passes the exact artifact value without a profile", () => {
    const created = fixture();
    const identity = artifactIdentity(created);

    expect(identity).toMatchObject({
      fileMode: 0o600,
      directoryMode: 0o700,
    });
    if (typeof process.getuid === "function") {
      expect(identity.fileUid).toBe(process.getuid());
      expect(identity.directoryUid).toBe(process.getuid());
    }

    const run = runMaterializedSession(created);

    expect(run.status).toBe(0);
    expect(readFixtureFile(created.hookLog)).toBe(`${HOSTILE_VALUE}\n`);
    expect(readFixtureFile(created.profileLog)).toBe("");
    expect(readFixtureFile(created.hostileEffect)).toBe("");
    expect(readFileSync(`${created.home}/.profile`, "utf8")).toBe(
      created.profileBefore
    );
  });

  it("ignores ambient secret, HOME, PATH, CWD, and profile", () => {
    const created = fixture();
    const run = runMaterializedSession(created);

    expect(run.status).toBe(0);
    expect(readFixtureFile(created.hookLog)).not.toContain("ambient-must-lose");
    expect(readFixtureFile(created.hookLog)).toBe(`${created.value}\n`);
    expect(readFixtureFile(created.profileLog)).toBe("");
    expect(run.stdout + run.stderr).not.toContain(created.value);
  });

  it("repeats idempotently with one project-hook delivery per session", () => {
    const created = fixture();
    const first = runMaterializedSession(created);
    const second = runMaterializedSession(created);

    expect([first.status, second.status]).toEqual([0, 0]);
    expect(
      readFixtureFile(created.hookLog).split("\n").filter(Boolean)
    ).toEqual([created.value, created.value]);
    expect(readFixtureFile(created.profileLog)).toBe("");
    expect(readFileSync(`${created.home}/.profile`, "utf8")).toBe(
      created.profileBefore
    );
  });
});
