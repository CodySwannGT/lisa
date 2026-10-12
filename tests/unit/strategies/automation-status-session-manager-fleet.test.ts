/**
 * Regression coverage for the locally hosted session-manager fleet entry (#4448).
 *
 * The session manager runs as a `/loop` inside a tmux session that
 * `/lisa:setup:session-manager` starts, not on the runtime's scheduler. The
 * status surface must still show it, so the expected fleet adds exactly one
 * UNSUPPORTED opt-in entry when (and only when) `sessionManager` is configured.
 * Both adapters already render runbook and run history for unsupported
 * entries, so the adapter test here proves the entry reaches the report with no
 * adapter change.
 * @module tests/unit/strategies/automation-status-session-manager-fleet
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectClaudeAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-claude-adapter.mjs";
import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";
import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import {
  runRecordLine,
  scaffoldRunbook,
  writeRunRecordsFile,
} from "./automation-run-history-helpers.js";

const LOOP_ID = "session-manager";
const NOW = "2026-05-26T12:00:00Z";
const AUTOMATION_ID = "lisa-auto-o-r-session-manager";
const RUNBOOK = ".lisa/automations/session-manager.runbook.md";
const OBSERVED =
  "Hosted locally in tmux; the scheduler cannot observe it — check `/lisa:session-manager status`";
const SETUP_COMMAND = "/lisa:setup:session-manager";
const BASE_CONFIG = { tracker: "github", github: { org: "o", repo: "r" } };
const MANAGER_BLOCK = {
  name: "r-manager",
  interval: "5m",
  notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-r" },
};

/**
 * Resolve the fleet with an optional session-manager block.
 * @param sessionManager - The `sessionManager` config block, or undefined.
 * @returns The resolved expected fleet.
 */
const fleetWith = (sessionManager?: Record<string, unknown>) =>
  resolveExpectedAutomationFleet({
    config:
      sessionManager === undefined
        ? BASE_CONFIG
        : { ...BASE_CONFIG, sessionManager },
  });

describe("session-manager fleet entry (#4448)", () => {
  it("adds nothing when sessionManager is absent", () => {
    const fleet = fleetWith();
    const ids = [...fleet.expected, ...fleet.unsupported].map(e => e.id);

    expect(ids).not.toContain(LOOP_ID);
    expect(fleet.unsupported.map(e => e.id)).toEqual([
      "exploratory-bugs",
      "learnings-audit",
    ]);
  });

  it("adds exactly one unsupported opt-in entry when configured", () => {
    const fleet = fleetWith(MANAGER_BLOCK);
    const entries = fleet.unsupported.filter(e => e.id === LOOP_ID);

    expect(fleet.expected.map(e => e.id)).not.toContain(LOOP_ID);
    expect(entries).toEqual([
      {
        id: LOOP_ID,
        automationId: AUTOMATION_ID,
        group: "opt-in",
        expectedCadence: "every 5m (tmux-hosted /loop)",
        expectedRRule: "FREQ=MINUTELY;INTERVAL=5",
        reason: expect.any(String),
        observed: OBSERVED,
        runbookPath: RUNBOOK,
        runbookSetupCommand: SETUP_COMMAND,
      },
    ]);
  });

  it("names the tmux host and how to check liveness in the reason", () => {
    const [entry] = fleetWith(MANAGER_BLOCK).unsupported.filter(
      e => e.id === LOOP_ID
    );

    expect(entry?.reason).toContain("tmux session `r-manager`");
    expect(entry?.reason).toContain("/lisa:session-manager status");
    expect(entry?.reason).toMatch(/not by this runtime's scheduler/);
  });

  it.each([
    ["30s", "every 30s (tmux-hosted /loop)", "FREQ=SECONDLY;INTERVAL=30"],
    ["90s", "every 90s (tmux-hosted /loop)", "FREQ=SECONDLY;INTERVAL=90"],
    ["2h", "every 2h (tmux-hosted /loop)", "FREQ=HOURLY;INTERVAL=2"],
    ["120m", "every 120m (tmux-hosted /loop)", "FREQ=HOURLY;INTERVAL=2"],
    ["1d", "every 1d (tmux-hosted /loop)", "FREQ=DAILY;INTERVAL=1"],
  ])("derives cadence from interval %s", (interval, human, rrule) => {
    const manager = fleetWith({ ...MANAGER_BLOCK, interval }).unsupported.find(
      e => e.id === LOOP_ID
    );

    expect(manager).toBeDefined();
    expect(manager?.expectedCadence).toBe(human);
    expect(manager?.expectedRRule).toBe(rrule);
  });

  it.each([undefined, "soon", "0m"])(
    "falls back to the 5m default for interval %s",
    interval => {
      const manager = fleetWith({
        name: "r-manager",
        interval,
      }).unsupported.find(e => e.id === LOOP_ID);

      expect(manager?.expectedCadence).toBe("every 5m (tmux-hosted /loop)");
      expect(manager?.expectedRRule).toBe("FREQ=MINUTELY;INTERVAL=5");
    }
  );

  it("still names the session generically when name is missing", () => {
    const manager = fleetWith({ interval: "5m" }).unsupported.find(
      e => e.id === LOOP_ID
    );

    expect(manager?.reason).toMatch(/tmux session/);
    expect(manager?.reason).not.toContain("undefined");
  });
});

// Both status adapters, each inspecting a fresh project root with the
// session manager configured and nothing scheduled.
const INSPECTORS = [
  [
    "Claude",
    (projectRoot: string) =>
      inspectClaudeAutomationFleet({
        expectedFleet: fleetWith(MANAGER_BLOCK),
        scheduleListing: { routines: [] },
        projectRoot,
        now: NOW,
      }),
  ],
  [
    "Codex",
    async (projectRoot: string) => {
      const automationsDir = path.join(projectRoot, "codex-automations");
      await fs.mkdir(automationsDir);
      return inspectCodexAutomationFleet({
        expectedFleet: fleetWith(MANAGER_BLOCK),
        automationsDir,
        projectRoot,
        now: NOW,
      });
    },
  ],
] as const;

describe("session-manager entry in the Claude status report (#4448)", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("renders runbook and last recorded outcome on the UNSUPPORTED item", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-sm-"));
    roots.push(projectRoot);
    await scaffoldRunbook(projectRoot, LOOP_ID);
    await writeRunRecordsFile(projectRoot, LOOP_ID, [
      runRecordLine({ loopId: LOOP_ID, outcome: "nothing-needed", n: 1 }),
      runRecordLine({
        loopId: LOOP_ID,
        outcome: "change-proved",
        n: 2,
        summary: "Spawned 1 worker.",
      }),
    ]);

    const report = await inspectClaudeAutomationFleet({
      expectedFleet: fleetWith(MANAGER_BLOCK),
      scheduleListing: { routines: [] },
      projectRoot,
      now: NOW,
    });
    const optIn = report.groups.find(g => g.title === "Opt-in automations");
    const item = optIn?.items.find(i => i.id === AUTOMATION_ID);

    expect(item?.status).toBe("UNSUPPORTED");
    expect(item?.runbook).toContain(RUNBOOK);
    expect(item?.lastOutcome).toEqual(
      expect.objectContaining({
        outcome: "change-proved",
        summary: "Spawned 1 worker.",
      })
    );
    expect(item?.outcomeHistory?.length).toBe(2);
  });

  it.each(INSPECTORS)(
    "%s adapter names /lisa:setup:session-manager when the runbook is missing",
    async (_name, inspect) => {
      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-sm-"));
      roots.push(projectRoot);
      const report = await inspect(projectRoot);
      const items = report.groups.flatMap(g => g.items);
      const manager = items.find(i => i.id === AUTOMATION_ID);
      const other = items.find(
        i => i.status === "UNSUPPORTED" && i.id !== AUTOMATION_ID
      );

      expect(manager?.runbook).toBe(`not scaffolded — run ${SETUP_COMMAND}`);
      expect(other?.runbook).toBe(
        "not scaffolded — run /lisa:setup-automations"
      );
    }
  );

  it.each(INSPECTORS)(
    "%s adapter shows the hosted-locally observed text, not 'no automation expected'",
    async (_name, inspect) => {
      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-sm-"));
      roots.push(projectRoot);
      const report = await inspect(projectRoot);
      const items = report.groups.flatMap(g => g.items);
      const manager = items.find(i => i.id === AUTOMATION_ID);
      const other = items.find(
        i => i.status === "UNSUPPORTED" && i.id !== AUTOMATION_ID
      );

      expect(manager?.observed).toBe(OBSERVED);
      expect(other?.observed).toBe(
        "No automation is expected for this repo/runtime combination."
      );
    }
  );
});
