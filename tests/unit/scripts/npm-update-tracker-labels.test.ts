/**
 * CodySwannGT/lisa#4859 review fix B1: a free-text label someone types on a
 * Jira ticket or Linear issue can never stand in for the lifecycle status,
 * issue type or priority the adapter derives from the tracker's own fields.
 * The configured human-hold label still passes through, so holds keep working.
 */
import { describe, expect, it } from "vitest";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { leafRoles } from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  JIRA_CONFIG,
  LINEAR_CONFIG,
  REPOSITORY,
} from "../../support/npm-update-tracker-host.js";

const HUMAN = "human-needed";
const TYPE_TASK = "type:Task";
const PRIORITY_MEDIUM = "priority:medium";
const SPOOFED = ["In Progress", "in progress", TYPE_TASK, PRIORITY_MEDIUM];

/**
 * Label names an adapter reports for its first stored item.
 * @param tracker - The adapter.
 * @param tracker.issue - Its normalized issue read.
 * @returns The label names.
 */
async function labelsOf(tracker: {
  issue: (n: number) => Promise<{ labels: Array<{ name: string }> }>;
}) {
  return (await tracker.issue(1)).labels.map(label => label.name);
}

describe("vendor labels cannot spoof derived lifecycle, type or priority", () => {
  it("drops Jira hand labels that mimic the claimed status, type:Task and priority:medium", async () => {
    const roles = leafRoles(JIRA_CONFIG, REPOSITORY);
    const jira = fakeJira();
    jira.seed({
      summary: "Update selected npm dependencies",
      status: "Ready",
      issuetype: { name: "Bug", subtask: false },
      priority: { name: "High" },
      labels: [...SPOOFED, HUMAN],
    });
    const tracker = createTracker(
      JIRA_CONFIG,
      { JIRA_API_TOKEN: "t", JIRA_LOGIN: "bot@example.test" },
      jira.transport
    )!;
    const labels = await labelsOf(tracker);
    expect(labels.some(label => roles.later.includes(label))).toBe(false);
    expect(labels).not.toContain(TYPE_TASK);
    expect(labels).not.toContain(PRIORITY_MEDIUM);
    expect(labels).toEqual(["Ready", "type:Bug", HUMAN]);
  });

  it("drops Linear hand labels that mimic the claimed state and Medium priority on an Urgent issue", async () => {
    const roles = leafRoles(LINEAR_CONFIG, REPOSITORY);
    const linear = fakeLinear();
    linear.seed({ stateId: "state-ready", priority: 1 });
    linear.issues[0]!.labels = [...SPOOFED, HUMAN];
    const tracker = createTracker(
      LINEAR_CONFIG,
      { LINEAR_API_KEY: "k" },
      linear.transport
    )!;
    const labels = await labelsOf(tracker);
    expect(labels.some(label => roles.later.includes(label))).toBe(false);
    expect(labels).not.toContain(PRIORITY_MEDIUM);
    expect(labels).toEqual(["Ready", TYPE_TASK, HUMAN]);
  });
});
