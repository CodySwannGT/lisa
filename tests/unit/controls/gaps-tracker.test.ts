/**
 * `lisa controls gaps` and the tracker: with nowhere to file a ticket, every
 * missing requirement is blocked, and the command says so itself.
 *
 * Whether a tracker is configured is read from the same two files, in the same
 * order, as the ticket writer reads them, so the command and the writer can
 * never disagree about it (CodySwannGT/lisa#4992).
 */
import { afterEach, describe, expect, it } from "vitest";

import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import { FIRST, SECOND } from "./audit-report-facts.js";
import {
  gaps,
  mixedRepository,
  printed,
  reportMissing,
  writeConfig,
} from "./support/gaps-run.js";
import { removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";

const TWO_MISSING = [
  { criterion: FIRST, scope: "." },
  { criterion: SECOND, scope: "api" },
] as const;

describe("a repository with no tracker configured", () => {
  it("reports every missing requirement as blocked", async () => {
    const run = await gaps(mixedRepository(reportMissing(TWO_MISSING)));
    const output = printed(run);

    expect(run.code).toBe(0);
    expect(output.gaps).toHaveLength(2);
    expect(output.gaps.map(gap => gap.outcome)).toEqual(["blocked", "blocked"]);
  });

  it("says in plain words that nothing can be filed and what to do", async () => {
    const { tracker } = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING)))
    );

    expect(tracker).toEqual({
      configured: false,
      name: null,
      problem:
        "No tracker is configured in .lisa.config.json, so no ticket can be filed. Run /lisa:setup:jira, /lisa:setup:github or /lisa:setup:linear, then run the enforce step again.",
      question: null,
    });
  });

  it("still gives each blocked requirement its marker", async () => {
    const withTracker = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), "github"))
    );
    const without = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING)))
    );

    expect(without.gaps.map(gap => gap.marker)).toEqual(
      withTracker.gaps.map(gap => gap.marker)
    );
  });

  it("treats a configuration with no tracker key the same way", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING));
    writeConfig(repoPath, CONFIG, JSON.stringify({ github: { org: "o" } }));

    const output = printed(await gaps(repoPath));

    expect(output.tracker.configured).toBe(false);
    expect(output.gaps.map(gap => gap.outcome)).toEqual(["blocked", "blocked"]);
  });

  it("treats an empty tracker value the same way", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), ""))
    );

    expect(output.tracker.configured).toBe(false);
    expect(output.tracker.problem).toContain("No tracker is configured");
  });
});

describe("a repository with a tracker configured", () => {
  it.each(["jira", "github", "linear"])(
    "leaves the outcome to the flow when the tracker is %s",
    async name => {
      const output = printed(
        await gaps(mixedRepository(reportMissing(TWO_MISSING), name))
      );

      expect(output.tracker).toEqual({
        configured: true,
        name,
        problem: null,
        question: null,
      });
      expect(output.gaps.map(gap => gap.outcome)).toEqual([null, null]);
    }
  );

  it("lets the local configuration name the tracker", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING));
    writeConfig(repoPath, LOCAL_CONFIG, JSON.stringify({ tracker: "linear" }));

    expect(printed(await gaps(repoPath)).tracker.name).toBe("linear");
  });

  it("prefers the local configuration over the committed one", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING), "github");
    writeConfig(repoPath, LOCAL_CONFIG, JSON.stringify({ tracker: "jira" }));

    expect(printed(await gaps(repoPath)).tracker.name).toBe("jira");
  });

  it("falls back to the committed one when the local value is empty", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING), "github");
    writeConfig(repoPath, LOCAL_CONFIG, JSON.stringify({ tracker: "" }));

    expect(printed(await gaps(repoPath)).tracker.name).toBe("github");
  });
});

describe("a tracker setting that cannot be used", () => {
  it("blocks on a tracker Lisa cannot file in, and names it", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), "spreadsheet"))
    );

    expect(output.tracker).toEqual({
      configured: false,
      name: null,
      problem:
        'The tracker named in .lisa.config.json is "spreadsheet", which is not one Lisa can file in, so no ticket can be filed. Set it to jira, github or linear, then run the enforce step again.',
      question: null,
    });
    expect(output.gaps.map(gap => gap.outcome)).toEqual(["blocked", "blocked"]);
  });

  it("blocks when the configuration cannot be read, and says the tracker is not known", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING));
    writeConfig(repoPath, CONFIG, "{ not json");

    const output = printed(await gaps(repoPath));

    expect(output.tracker.configured).toBe(false);
    expect(output.tracker.problem).toBe(
      ".lisa.config.json could not be read, so the tracker is not known and no ticket can be filed. Fix the file, then run the enforce step again."
    );
    expect(output.gaps.map(gap => gap.outcome)).toEqual(["blocked", "blocked"]);
  });

  it("still uses the committed tracker when only the local file is unreadable", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING), "github");
    writeConfig(repoPath, LOCAL_CONFIG, "{ not json");

    expect(printed(await gaps(repoPath)).tracker).toMatchObject({
      configured: true,
      name: "github",
    });
  });
});

describe("the tracker question", () => {
  it("is not referenced while the report records no questions", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING)))
    );

    expect(output.tracker.question).toBeNull();
    expect(TRACKER_QUESTION_ID).toBe("tracker");
  });
});
