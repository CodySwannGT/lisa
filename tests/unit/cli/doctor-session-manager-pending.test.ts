/**
 * The session-manager doctor check lists items waiting on a human
 * (CodySwannGT/lisa#4555, part 3).
 *
 * It reads `.lisa/session-manager/ledger.json` in the project root, lists each
 * pending question by ref, kind and age (never its text, which came from a
 * worker or a ticket), and warns when one recorded more than one `interval`
 * ago was never marked on the tracker (`markedAt: null`). A temp project and
 * an injected clock keep it off the operator's real ledger and `~/.claude`.
 * @module tests/unit/cli/doctor-session-manager-pending
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkSessionManagerIsolation } from "../../../src/cli/doctor-session-manager.js";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const LEDGER_DIR = [".lisa", "session-manager"] as const;
const SECRETISH = "the question text never appears";
const roots: string[] = [];

/**
 * A project with a no-channel session manager and this ledger.
 * @param items - Ledger items, or a raw string for a corrupt file
 * @returns Project root and home
 */
async function project(items: Record<string, unknown> | string | undefined) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-smp-"));
  const proj = path.join(root, "proj");
  const home = path.join(root, "home");
  roots.push(root);
  await mkdir(path.join(proj, ...LEDGER_DIR), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(proj, ".lisa.config.json"),
    JSON.stringify({
      tracker: "github",
      sessionManager: { name: "p-manager", interval: "10m" },
    })
  );
  if (items !== undefined) {
    await writeFile(
      path.join(proj, ...LEDGER_DIR, "ledger.json"),
      typeof items === "string" ? items : JSON.stringify({ version: 1, items })
    );
  }
  return { proj, home, managed: path.join(root, "managed.json") };
}

/**
 * Run the check offline with the fixed clock.
 * @param fx - Fixture
 * @returns Doctor check
 */
async function check(fx: Awaited<ReturnType<typeof project>>) {
  return checkSessionManagerIsolation(
    fx.proj,
    {
      home: fx.home,
      env: {},
      managedSettingsPaths: [fx.managed],
      now: () => NOW,
    },
    { offline: true }
  );
}

/**
 * A pending question asked `minutesAgo` before NOW.
 * @param minutesAgo - Age
 * @param marked - Whether the tracker mark was read back
 * @param kind - Question kind
 * @returns Ledger item
 */
function waiting(minutesAgo: number, marked: boolean, kind = "decision") {
  const askedAt = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  return {
    pendingQuestion: {
      text: SECRETISH,
      kind,
      askedAt,
      markedAt: marked ? askedAt : null,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

describe("session-manager doctor: items pending a human", () => {
  it("adds nothing when the ledger is absent or has no pending question", async () => {
    expect((await check(await project(undefined))).detail).toBe(
      "notifications: none"
    );
    expect(
      (await check(await project({ "o/r#1": { pendingQuestion: null } })))
        .detail
    ).toBe("notifications: none");
  });

  it("lists marked items by ref, kind and age and stays ok", async () => {
    const result = await check(
      await project({
        "o/r#1": waiting(180, true, "worker-question"),
        "o/r#2": waiting(5, false),
      })
    );
    expect(result.status).toBe("ok");
    expect(result.detail).toBe(
      "notifications: none; 2 pending a human: o/r#1 (worker-question, 3h), o/r#2 (decision, 5m)"
    );
    expect(result.detail).not.toContain(SECRETISH);
  });

  it("warns when an item was never marked within one interval", async () => {
    const result = await check(await project({ "o/r#3": waiting(25, false) }));
    expect(result.status).toBe("warn");
    expect(result.detail).toContain(
      "o/r#3 has waited 25m for a human but was never marked human-needed"
    );
    expect(result.detail).toContain("1 pending a human: o/r#3 (decision, 25m)");
    expect(result.detail).not.toContain(SECRETISH);
  });

  it("warns, rather than failing the whole check, on a corrupt ledger", async () => {
    const result = await check(await project("{not json"));
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("is not valid JSON");
    expect(result.detail).not.toContain("could not be read");
  });

  it("says the ledger could not be read, not that it is invalid, when reading fails", async () => {
    const fx = await project(undefined);
    await mkdir(path.join(fx.proj, ...LEDGER_DIR, "ledger.json"));
    const result = await check(fx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("could not be read");
    expect(result.detail).not.toContain("is not valid JSON");
  });
});
