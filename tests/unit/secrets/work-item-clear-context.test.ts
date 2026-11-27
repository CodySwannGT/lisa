/**
 * Clearing a finished ticket's binding also clears its context, and a
 * prepare that cannot replace a context says whose it is
 * (CodySwannGT/lisa#5199).
 *
 * Before this, `clear` left `.lisa/work-item-context.md` behind, and the next
 * ticket's prepare refused with generic resolver text naming neither the file
 * nor the ticket, so a session stopped until a person deleted the file.
 * @module tests/unit/secrets/work-item-clear-context
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const cleanup: string[] = [];
const CONTEXT = ".lisa/work-item-context.md";
const TICKET_A = "fixture/project#1";
const TICKET_B = "fixture/project#2";
const WORK_ITEM = path.resolve("scripts/lisa-work-item.mjs");

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A project whose context names ticket A, with drivers for the work-item CLI
 * and the prepare owner.
 * @returns The fixture and its drivers
 */
function project() {
  const f = taskFixture(true);
  const owner = path.join(
    f.plugin,
    "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
  );
  const run = (label: string, args: string[]) =>
    boundedSpawnSync({
      label,
      command: process.execPath,
      args,
      cwd: f.root,
      env: f.env,
    });
  const workItem = (...args: string[]) =>
    run(`work-item ${args[0]}`, [WORK_ITEM, ...args]);
  const prepare = (ref: string, withBody = true) => {
    const file = path.join(f.root, "..", `prepare-${path.basename(f.root)}`);
    cleanup.push(file);
    writeFileSync(
      file,
      JSON.stringify({
        requirements_complete: true,
        required_access: [],
        ...(withBody ? { context_body: `# ${ref}\nIts full body.\n` } : {}),
      })
    );
    return run("prepare", [
      owner,
      "--prepare",
      "--ref",
      ref,
      "--input-file",
      file,
    ]);
  };
  const context = () => path.join(f.root, CONTEXT);
  cleanup.push(f.root);
  return { f, workItem, prepare, context };
}

describe("clear", () => {
  it("removes the cleared ticket's context, so the next ticket prepares", () => {
    const { workItem, prepare, context } = project();
    expect(workItem("link", TICKET_A).status).toBe(0);
    const cleared = workItem("clear");
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).toContain(`removed ${CONTEXT} (${TICKET_A})`);
    expect(existsSync(context())).toBe(false);
    expect(workItem("current").status).not.toBe(0);
    const next = prepare(TICKET_B);
    expect(next.status, next.stderr).toBe(0);
    expect(readFileSync(context(), "utf8")).toContain(
      `"work_item_ref":"${TICKET_B}"`
    );
  });

  it("keeps a context that names another ticket, and says why", () => {
    const { f, workItem, context } = project();
    f.refresh(undefined, { ref: TICKET_B, tracker: "github" });
    expect(workItem("link", TICKET_A).status).toBe(0);
    const cleared = workItem("clear");
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).toContain(
      `kept ${CONTEXT}, which holds the context of ${TICKET_B}, not of ${TICKET_A}`
    );
    expect(readFileSync(context(), "utf8")).toContain(
      `"work_item_ref":"${TICKET_B}"`
    );
  });

  it("removes a context with no requirements header", () => {
    const { workItem, context } = project();
    expect(workItem("link", TICKET_A).status).toBe(0);
    writeFileSync(context(), "Notes with no header.\n");
    expect(workItem("clear").stdout).toContain(`removed ${CONTEXT}`);
    expect(existsSync(context())).toBe(false);
  });
});

describe("a prepare that cannot replace the context", () => {
  it("names the leftover file and its ticket when nothing is bound", () => {
    const { prepare, context } = project();
    const before = readFileSync(context(), "utf8");
    const refused = prepare(TICKET_B);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/^requirements-stale: /u);
    expect(refused.stderr).toContain(
      `${CONTEXT} holds the context of ${TICKET_A}, not ${TICKET_B}`
    );
    expect(refused.stderr).toContain(`link ${TICKET_B}`);
    expect(readFileSync(context(), "utf8")).toBe(before);
  });

  it("names the leftover file and its ticket when no new body is given", () => {
    const { prepare, context } = project();
    const before = readFileSync(context(), "utf8");
    const refused = prepare(TICKET_B, false);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(
      `${CONTEXT} holds the context of ${TICKET_A}, not ${TICKET_B}`
    );
    expect(readFileSync(context(), "utf8")).toBe(before);
  });

  it("asks for a fresh body when this ticket is bound over another's context", () => {
    const { workItem, prepare } = project();
    expect(workItem("link", TICKET_B).status).toBe(0);
    const refused = prepare(TICKET_B, false);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(
      `holds the context of ${TICKET_A}, not ${TICKET_B}. Run this prepare again with this ticket's full text as "context_body"`
    );
  });

  it("names the bound ticket when another one is bound", () => {
    const { workItem, prepare } = project();
    expect(workItem("link", TICKET_A).status).toBe(0);
    const refused = prepare(TICKET_B);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(
      `this checkout is bound to ${TICKET_A}, and prepare runs only for the bound ticket`
    );
  });
});
