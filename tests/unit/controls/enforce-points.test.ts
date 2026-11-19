/**
 * Whether a register entry's enforcement points now run its check, as far as
 * a read of the checkout's carriers and the merge-protection result say
 * (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import type { EnforcementPoint } from "../../../src/controls/register-types.js";
import {
  COMMIT,
  DISAGREES,
  EDIT,
  IN_PLACE,
  MERGE,
  NOTHING,
  NOT_IN_PLACE,
  NO_HOOK,
  PIPELINE_FILE,
  TASK,
  carried,
  carriers,
  entry,
  judge,
  protect,
} from "./support/enforce-points-samples.js";

describe("a commit or push point", () => {
  it("is wired when the checkout holds the carrier", async () => {
    const judged = await judge(entry([COMMIT]));

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toBe(
      "Git starts the declared checks at commit in this checkout."
    );
  });

  it("is blocked, for the reason the read of the checkout gives, when the carrier is not in place", async () => {
    const judged = await judge(entry([COMMIT]), {
      carriers: carriers([carried("commit", NOT_IN_PLACE)]),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("A hook file is in the way.");
  });

  it("is blocked when the read of the checkout reports no carrier for the moment", async () => {
    const judged = await judge(entry([COMMIT]), { carriers: carriers([]) });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("found no carrier for commit");
  });

  it("says so when the saved carriers result claimed the carrier was in place", async () => {
    const judged = await judge(entry([COMMIT]), {
      carriers: carriers([
        carried("commit", NOT_IN_PLACE, { contradicts: DISAGREES }),
      ]),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.points[0]?.reason).toBe(
      `A hook file is in the way. ${DISAGREES}`
    );
  });

  it("says so when the checkout holds a carrier the saved result did not report", async () => {
    const judged = await judge(entry([COMMIT]), {
      carriers: carriers([
        carried("commit", IN_PLACE, { contradicts: "The two disagree." }),
      ]),
    });

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain("The two disagree.");
  });
});

describe("a point after a coding agent writes a file", () => {
  const agents = [
    carried("post-tool", IN_PLACE, {
      agent: "claude",
      refusal: "exit-2",
      refusal_evidence: "documented",
    }),
    carried("post-tool", IN_PLACE, {
      agent: "devin",
      refusal: "exit-2",
      refusal_evidence: "assumed",
    }),
    carried("post-tool", NO_HOOK, { agent: "agy" }),
  ];

  it("is wired, naming the agent that cannot refuse and the one whose refusal is assumed", async () => {
    const judged = await judge(entry([EDIT]), { carriers: carriers(agents) });

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain("run on claude and devin");
    expect(judged.reason).toContain("agy has no hook that can refuse");
    expect(judged.reason).toContain("On devin");
    expect(judged.reason).toContain("assumed, not measured");
  });

  it("is blocked when no agent was named and the check is a declared command", async () => {
    const judged = await judge(entry([EDIT]));

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("--agents=<names>");
  });

  it("is blocked when the only agent named cannot refuse a write", async () => {
    const judged = await judge(entry([EDIT]), {
      carriers: carriers(agents.slice(2)),
    });

    expect(judged.outcome).toBe("blocked");
  });

  it("is blocked when one agent's carrier is not in place", async () => {
    const judged = await judge(entry([EDIT]), {
      carriers: carriers([
        ...agents,
        carried("post-tool", NOT_IN_PLACE, {
          agent: "codex",
          contradicts: DISAGREES,
        }),
      ]),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("On codex: A hook file is in the way.");
    expect(judged.reason).toContain(DISAGREES);
  });

  it("says that an agent which is only told of a failure is not stopped by it", async () => {
    const judged = await judge(entry([EDIT]), {
      carriers: carriers([
        agents[0] ?? carried("post-tool", IN_PLACE),
        carried("post-tool", IN_PLACE, {
          agent: "cursor",
          refusal: "additional-context",
          refusal_evidence: "documented",
        }),
      ]),
    });

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain("run on claude and cursor");
    expect(judged.reason).toContain(
      "On cursor, a failed check does not fail the write: the agent is told afterwards, and nothing stops it going on."
    );
    expect(judged.reason).not.toContain("On claude");
  });

  it("is left unchecked for a check a Lisa project type ships", async () => {
    const judged = await judge(entry([EDIT], TASK));

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.points[0]?.state).toBe("not-checked");
  });
});

describe("a pull-request point", () => {
  it.each(["wired", "blocked"] as const)(
    "is %s when merge protection says so",
    async outcome => {
      const judged = await judge(entry([MERGE]), { protect: protect(outcome) });

      expect(judged.outcome).toBe(outcome);
      expect(judged.reason).toContain(`The platform says ${outcome}.`);
    }
  );

  const hosted: EnforcementPoint = {
    ...MERGE,
    executor: { platform: "gitlab", path: PIPELINE_FILE },
  };

  it("is blocked when the pipeline file the host wrote does not start the runner", async () => {
    const judged = await judge(entry([hosted]), {
      protect: protect("wired"),
      file: {
        state: "not-wired",
        reason: ".gitlab-ci.yml is not in this checkout.",
        checked: PIPELINE_FILE,
      },
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("is not in this checkout");
  });

  it("says the entry stays unproved on a platform other than GitHub", async () => {
    const judged = await judge(entry([{ ...hosted, level: "optional" }]));

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain("stays marked unproved");
    expect(judged.reason).toContain("GitLab");
  });
});
