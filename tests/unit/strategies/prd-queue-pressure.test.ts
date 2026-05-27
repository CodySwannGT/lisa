/**
 * Focused fixture coverage for the auto-ready PRD queue-pressure gate.
 *
 * These tests keep project-ideation's pressure policy deterministic without
 * requiring live GitHub writes.
 * @module tests/unit/strategies/prd-queue-pressure
 */
import { describe, expect, it } from "vitest";

import {
  createPrdQueueSnapshot,
  evaluatePrdQueuePressure,
} from "../../../plugins/src/base/scripts/queue-status-prd-readers.mjs";

const GITHUB_PRD_QUEUE_ARGUMENT = "github intake_mode=prd";
const GITHUB_PRD_ITEM_URL_BASE = "https://github.com/CodySwannGT/lisa/issues";

describe("auto-ready PRD queue pressure", () => {
  it("evaluates quiet, lifecycle pressure, and source failure fixtures", () => {
    const quiet = createPrdQueueSnapshot({
      source: "github",
      namespaceAdopted: true,
      queueArgument: GITHUB_PRD_QUEUE_ARGUMENT,
      items: [],
    });
    const ready = createPressureSnapshot("ready", 101);
    const blocked = createPrdQueueSnapshot({
      source: "github",
      namespaceAdopted: true,
      queueArgument: GITHUB_PRD_QUEUE_ARGUMENT,
      items: [
        toPressureFixtureItem("ready", 102),
        toPressureFixtureItem("blocked", 103),
      ],
    });
    const ticketed = createPressureSnapshot("ticketed", 104);
    const shipped = createPressureSnapshot("shipped", 105);
    const sourceFailure = createPrdQueueSnapshot({
      source: "github",
      namespaceAdopted: true,
      queueResolved: false,
      queueArgument: GITHUB_PRD_QUEUE_ARGUMENT,
      resolutionError: "github.org and github.repo are required",
      items: [],
    });

    expect(evaluatePrdQueuePressure(quiet)).toEqual({
      allowed: true,
      decisiveRole: null,
      blockerItem: null,
      nextStep: null,
    });
    expect(evaluatePrdQueuePressure(ready)).toMatchObject({
      allowed: false,
      decisiveRole: "ready",
      blockerItem: {
        url: `${GITHUB_PRD_ITEM_URL_BASE}/101`,
        nextStep:
          "Run /lisa:intake github intake_mode=prd to ticket the next PRD.",
      },
    });
    expect(evaluatePrdQueuePressure(blocked)).toMatchObject({
      allowed: false,
      decisiveRole: "blocked",
      blockerItem: {
        url: `${GITHUB_PRD_ITEM_URL_BASE}/103`,
        nextStep:
          "Run /lisa:repair-intake github intake_mode=prd after clarifying the blocker.",
      },
    });
    expect(evaluatePrdQueuePressure(ticketed)).toMatchObject({
      allowed: false,
      decisiveRole: "ticketed",
      blockerItem: {
        url: `${GITHUB_PRD_ITEM_URL_BASE}/104`,
        nextStep:
          "Monitor downstream build work or inspect the build queue with /lisa:queue-status queue=build.",
      },
    });
    expect(evaluatePrdQueuePressure(shipped)).toMatchObject({
      allowed: false,
      decisiveRole: "shipped",
      blockerItem: {
        url: `${GITHUB_PRD_ITEM_URL_BASE}/105`,
        nextStep: `Run /lisa:verify-prd ${GITHUB_PRD_ITEM_URL_BASE}/105 to close the shipped loop.`,
      },
    });
    expect(evaluatePrdQueuePressure(sourceFailure)).toEqual({
      allowed: false,
      decisiveRole: "misconfigured",
      blockerItem: null,
      nextStep:
        "Fix PRD source queue configuration: github.org and github.repo are required",
    });
  });

  it("keeps marker reuse behind unrelated queue pressure", () => {
    const snapshot = createPrdQueueSnapshot({
      source: "github",
      namespaceAdopted: true,
      queueArgument: GITHUB_PRD_QUEUE_ARGUMENT,
      items: [
        {
          ...toPressureFixtureItem("draft", 106),
          title: "Existing matching marker draft PRD",
        },
        {
          ...toPressureFixtureItem("ready", 107),
          title: "Unrelated ready PRD blocks auto-ready reuse",
        },
      ],
    });

    expect(evaluatePrdQueuePressure(snapshot)).toMatchObject({
      allowed: false,
      decisiveRole: "ready",
      blockerItem: {
        ref: "#107",
        title: "Unrelated ready PRD blocks auto-ready reuse",
      },
      nextStep:
        "Run /lisa:intake github intake_mode=prd to ticket the next PRD.",
    });
  });
});

const createPressureSnapshot = (role: string, number: number) =>
  createPrdQueueSnapshot({
    source: "github",
    namespaceAdopted: true,
    queueArgument: GITHUB_PRD_QUEUE_ARGUMENT,
    items: [toPressureFixtureItem(role, number)],
  });

const toPressureFixtureItem = (role: string, number: number) => ({
  id: String(number),
  ref: `#${number}`,
  title: `${role} PRD pressure fixture`,
  url: `${GITHUB_PRD_ITEM_URL_BASE}/${number}`,
  createdAt: `2026-05-27T19:${number % 60}:00Z`,
  role,
});
