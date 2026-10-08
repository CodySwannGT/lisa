/** A readable but damaged state file is not proof that no binding exists. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  buildFixture,
  runGuard,
  stateKey,
} from "./support/worktree-binding.js";

const BINDING_DIR = "worktree-binding";
const DAMAGED = "{unfinished-json";
const OWNER_MESSAGE = /binding.*owner|binding.*belongs/iu;

describe("damaged binding records cannot authorize a new baseline", () => {
  it.each([undefined, null, "", "relative/root", 17, {}])(
    "preserves an owned reserved record with invalid boundRoot %j",
    boundRoot => {
      const fixture = buildFixture();
      const call = { state: fixture.state, session: "s", agent: "a" };
      const file = path.join(
        fixture.state,
        BINDING_DIR,
        `${stateKey("s", "a")}.json`
      );
      expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(ALLOWED);
      const state = JSON.parse(readFileSync(file, "utf8"));
      const damaged = JSON.stringify({ ...state, boundRoot });
      writeFileSync(file, damaged);

      expect(runGuard({ ...call, cwd: fixture.b }).status).toBe(BLOCKED);
      expect(
        runGuard({ ...call, cwd: fixture.b, event: "SessionStart" }).status
      ).toBe(ALLOWED);
      expect(readFileSync(file, "utf8")).toBe(damaged);
      expect(
        runGuard({
          ...call,
          cwd: fixture.b,
          input: {
            command: `echo 'lisa-worktree-binding: accept ${fixture.b}'`,
          },
        }).status
      ).toBe(BLOCKED);
      expect(readFileSync(file, "utf8")).toBe(damaged);
    }
  );

  it("refuses a damaged reserved slot and preserves its bytes", () => {
    const fixture = buildFixture();
    const call = { state: fixture.state, session: "s", agent: "a" };
    const file = path.join(
      fixture.state,
      BINDING_DIR,
      `${stateKey("s", "a")}.json`
    );
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(ALLOWED);
    writeFileSync(file, DAMAGED);

    const unknown = runGuard({ ...call, cwd: fixture.b });
    expect(unknown.status).toBe(BLOCKED);
    expect(unknown.stderr).toMatch(OWNER_MESSAGE);
    expect(
      runGuard({ ...call, cwd: fixture.b, event: "SessionStart" }).status
    ).toBe(ALLOWED);
    expect(readFileSync(file, "utf8")).toBe(DAMAGED);
    expect(
      runGuard({
        ...call,
        cwd: fixture.b,
        input: { command: `echo 'lisa-worktree-binding: accept ${fixture.b}'` },
      }).status
    ).toBe(BLOCKED);
    expect(readFileSync(file, "utf8")).toBe(DAMAGED);
  });

  it("requires explicit intent for a damaged legacy file without changing it", () => {
    const fixture = buildFixture();
    const call = { state: fixture.state, session: "s", agent: "a" };
    const file = path.join(fixture.state, BINDING_DIR, "s--a.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, DAMAGED);

    const unknown = runGuard({ ...call, cwd: fixture.b });
    expect(unknown.status).toBe(BLOCKED);
    expect(unknown.stderr).toMatch(OWNER_MESSAGE);
    expect(
      runGuard({
        ...call,
        cwd: fixture.b,
        input: { command: `echo 'lisa-worktree-binding: accept ${fixture.b}'` },
      }).status
    ).toBe(ALLOWED);
    expect(readFileSync(file, "utf8")).toBe(DAMAGED);
    expect(runGuard({ ...call, cwd: fixture.b }).status).toBe(ALLOWED);
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(BLOCKED);
  });
});
