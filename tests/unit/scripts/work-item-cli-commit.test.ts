/**
 * Commit-message and tracker-liveness checks, driven in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
  createFixture,
  offlineFixture,
  Fixture,
  issueJson,
  OTHER_REF,
  REF,
} from "../../support/work-item-cli.js";

const PREPARE = "prepare-commit-msg";
const VALIDATE = "validate-commit";
const UNTRACKED = "feat: untracked\n";
const RELEASE = "chore(release): 1.2.3 [skip ci]";
const CONTAINER = "is a container; bind a claimed leaf";
const TRACKED = `feat: tracked\n\nWork-Item: ${REF}\n`;

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Write a commit message file inside a fixture.
 * @param fixture - The repository to write in.
 * @param body - The message text.
 * @returns Absolute path of the file.
 */
function message(fixture: Fixture, body: string): string {
  const file = path.join(fixture.root, "MSG");
  writeFileSync(file, body);
  return file;
}

describe("in-process CLI: prepare-commit-msg", () => {
  it("adds the bound trailer and preserves the subject", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(fixture, "feat: keep this subject\n");
    expect(cli(fixture, [PREPARE, file]).exitCode).toBeUndefined();
    const prepared = readFileSync(file, "utf8");
    expect(prepared.split("\n")[0]).toBe("feat: keep this subject");
    expect(prepared).toContain(`Work-Item: ${REF}`);
  });

  it("adds nothing when no work item is bound", () => {
    const fixture = offlineFixture();
    const file = message(fixture, UNTRACKED);
    cli(fixture, [PREPARE, file]);
    expect(readFileSync(file, "utf8")).toBe(UNTRACKED);
  });

  it("leaves a merge message alone", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(fixture, "Merge branch 'main'\n");
    cli(fixture, [PREPARE, file, "merge"]);
    expect(readFileSync(file, "utf8")).toBe("Merge branch 'main'\n");
  });

  it("leaves an exact release subject alone", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(fixture, `${RELEASE}\n`);
    cli(fixture, [PREPARE, file]);
    expect(readFileSync(file, "utf8")).toBe(`${RELEASE}\n`);
  });

  it("does NOT treat a near-miss release subject as exempt", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(fixture, "chore(release): 1.2.3\n");
    cli(fixture, [PREPARE, file]);
    expect(readFileSync(file, "utf8")).toContain(`Work-Item: ${REF}`);
  });

  it("requires the commit message file", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, [PREPARE]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "prepare-commit-msg requires the commit message file"
    );
  });
});

/**
 * The commit-msg hook is the EARLIEST moment the machinery speaks to an
 * operator, and #2681 is about withholding what is already known. Every one of
 * the five gates is knowable here — the checklist costs six lines and replaces
 * a sequence of surprises with one read.
 */
describe("in-process CLI: the checklist at the earliest moment", () => {
  it("names all five gates when the commit-msg hook refuses", () => {
    const fixture = createFixture();
    const file = message(fixture, UNTRACKED);
    const result = cli(fixture, [VALIDATE, file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("All five gates, and when each one bites:");
    expect(result.stderr).toContain("the pull-request BODY declares EXACTLY");
    expect(result.stderr).toContain("backlink comment");
  });

  it("keeps the original refusal above the checklist", () => {
    const fixture = createFixture();
    const file = message(fixture, UNTRACKED);
    const result = cli(fixture, [VALIDATE, file]);
    const refusal = result.stderr.indexOf(
      "No Work-Item trailer anywhere in the commit message"
    );
    const checklist = result.stderr.indexOf("All five gates");
    expect(refusal).toBeGreaterThan(-1);
    expect(checklist).toBeGreaterThan(refusal);
  });
});

describe("in-process CLI: validate-commit", () => {
  it("accepts a message naming the bound work item", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    expect(cli(fixture, [VALIDATE, message(fixture, TRACKED)]).stdout).toBe(
      `WORK_ITEM_TRACKING_OK ${REF}`
    );
  });

  it("accepts the same reference repeated, as Lisa's own hook produces", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(
      fixture,
      `feat: tracked\n\nWork-Item: ${REF}\n\nCo-Authored-By: X <x@y.z>\nWork-Item: ${REF}\n`
    );
    expect(cli(fixture, [VALIDATE, file]).stdout).toBe(
      `WORK_ITEM_TRACKING_OK ${REF}`
    );
  });

  it("reads a trailer that is not in the final block", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = message(
      fixture,
      `feat: tracked\n\nWork-Item: ${REF}\n\nClosing prose nobody planned for.\n`
    );
    expect(cli(fixture, [VALIDATE, file]).stdout).toBe(
      `WORK_ITEM_TRACKING_OK ${REF}`
    );
  });

  it("refuses two DIFFERENT references, naming both", () => {
    const fixture = offlineFixture();
    const file = message(
      fixture,
      `feat: tracked\n\nWork-Item: ${REF}\nWork-Item: ${OTHER_REF}\n`
    );
    const result = cli(fixture, [VALIDATE, file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("names 2 different work items");
    expect(result.stderr).toContain(`${REF}, ${OTHER_REF}`);
  });

  it("refuses a message with no trailer, and offers the remedy", () => {
    const fixture = offlineFixture();
    const file = message(fixture, UNTRACKED);
    const result = cli(fixture, [VALIDATE, file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
    expect(result.stderr).toContain("Mention the ticket this work relates to");
  });

  it("ignores a commented-out trailer", () => {
    const fixture = offlineFixture();
    const file = message(fixture, `${UNTRACKED}\n# Work-Item: ${REF}\n`);
    expect(cli(fixture, [VALIDATE, file]).exitCode).toBe(1);
  });

  it("ignores a trailer that only appears inside a verbose diff", () => {
    const fixture = offlineFixture();
    const file = message(fixture, `${UNTRACKED}\n+Work-Item: ${REF}\n`);
    expect(cli(fixture, [VALIDATE, file]).exitCode).toBe(1);
  });

  it("exempts an exact release subject without asking the tracker", () => {
    const fixture = offlineFixture();
    expect(
      cli(fixture, [VALIDATE, message(fixture, `${RELEASE}\n`)]).stdout
    ).toBe("WORK_ITEM_TRACKING_OK release");
  });

  it("requires the commit message file", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, [VALIDATE]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "validate-commit requires the commit message file"
    );
  });
});

describe("in-process CLI: what the tracker says", () => {
  it("refuses a closed issue", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: issueJson({ state: "CLOSED" }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is closed; bind an open work item");
  });

  // These two used to assert the opposite, and the reversal is the point.
  // Claim-state enforcement was the only check here that could refuse work that
  // was entirely correct — right ticket, right trailer, the tracker's label
  // simply not transitioned yet — and it did. What a label says about its own
  // timing is not evidence about whether a commit belongs to the ticket it
  // names. See the note in the guard where `assertClaimedLifecycle` used to be.
  it("accepts an issue that is not yet claimed", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: issueJson({ labels: [{ name: "status:ready" }] }),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`work-item bound: ${REF}`);
  });

  // A terminal LABEL on an issue the tracker still reports as open is drift in
  // the label, not a verdict about the work. The tracker's own answer is what
  // decides here, and the closed case one test up still refuses.
  it("accepts an open issue whose lifecycle label reads terminal", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: issueJson({ labels: [{ name: "status:done" }] }),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`work-item bound: ${REF}`);
  });

  it("refuses an epic", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: issueJson({
        labels: [{ name: "status:in-progress" }, { name: "type:Epic" }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(CONTAINER);
  });

  it("refuses an item with an open child", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_HIERARCHY_JSON: JSON.stringify({
        data: {
          repository: { issue: { subIssues: { nodes: [{ state: "OPEN" }] } } },
        },
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(CONTAINER);
  });

  it("accepts an item whose only children are closed", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_HIERARCHY_JSON: JSON.stringify({
        data: {
          repository: {
            issue: { subIssues: { nodes: [{ state: "CLOSED" }] } },
          },
        },
      }),
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("refuses a hierarchy response with no sub-issue field at all", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_HIERARCHY_JSON: '{"data":{"repository":{"issue":{}}}}',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "did not expose native sub-issue hierarchy"
    );
  });

  it("refuses when the tracker hands back a different issue", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: issueJson({ number: 43 }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("GitHub returned the wrong issue");
  });

  it("refuses malformed JSON from the tracker", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], {
      FAKE_GH_ISSUE_JSON: "{not json",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("returned malformed JSON");
  });

  it("degrades loudly when gh cannot authenticate", () => {
    const fixture = createFixture();
    bindTo(fixture, REF);
    const result = cli(fixture, [VALIDATE, message(fixture, TRACKED)], {
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "gh auth login required",
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain("live validation SKIPPED");
    expect(result.stderr).toContain("credential gap, not a problem");
  });

  it("degrades when GitHub itself is down, rather than accusing the ticket", () => {
    const fixture = createFixture();
    bindTo(fixture, REF);
    const result = cli(fixture, [VALIDATE, message(fixture, TRACKED)], {
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "HTTP 503: No server is currently available",
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain("upstream outage, not a problem");
  });

  it("does NOT degrade when the tracker simply said no", () => {
    const fixture = createFixture();
    bindTo(fixture, REF);
    const result = cli(fixture, [VALIDATE, message(fixture, TRACKED)], {
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "gone",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not exist or is inaccessible");
  });

  it("refuses a gh too old for the field the backlink is read from", () => {
    const fixture = createFixture();
    const result = cli(fixture, ["link", REF], { FAKE_GH_VERSION: "2.72.0" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is too old for work-item tracking");
  });

  it("accepts exactly the minimum gh", () => {
    const fixture = createFixture();
    expect(
      cli(fixture, ["link", REF], { FAKE_GH_VERSION: "2.73.0" }).exitCode
    ).toBeUndefined();
  });
});
