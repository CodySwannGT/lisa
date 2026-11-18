/**
 * Whether a register entry's enforcement points now run its check, as far as
 * the results of the enforce step's own commands say
 * (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import type {
  HandedCarrierPoint,
  HandedCarriers,
  HandedProtect,
} from "../../../src/controls/enforce-inputs.js";
import { enforcedEntries } from "../../../src/controls/enforce-points.js";
import type { EnforcedEntry } from "../../../src/controls/enforce-types.js";
import type { PointVerdict } from "../../../src/controls/reconcile-types.js";
import type {
  ControlRegisterEntry,
  EnforcementPoint,
  MeasuringMechanism,
} from "../../../src/controls/register-types.js";

const PIPELINE_FILE = ".gitlab-ci.yml";
const NOTHING = "nothing-to-enforce";

const COMMAND: MeasuringMechanism = {
  kind: "command",
  argv: ["ruff", "check", "."],
};
const TASK: MeasuringMechanism = {
  kind: "task",
  task: "lint",
  command: "npm run lint",
};

const COMMIT: EnforcementPoint = {
  moment: "commit",
  level: "required",
  location: "local-checkout",
};
const EDIT: EnforcementPoint = {
  moment: "post-tool",
  level: "required",
  location: "coding-agent",
};
const MERGE: EnforcementPoint = {
  moment: "pull-request",
  level: "required",
  location: "hosting-platform",
};
const DEPLOY: EnforcementPoint = {
  moment: "pre-deploy:production",
  level: "required",
  location: "deployment-pipeline",
};

/**
 * A register entry for the whole repository.
 * @param points - Its enforcement points
 * @param mechanism - What measures it
 * @returns The entry
 */
function entry(
  points: readonly EnforcementPoint[],
  mechanism: MeasuringMechanism = COMMAND
): ControlRegisterEntry {
  return {
    id: "code-style@.",
    gate: "code-style",
    criteria: ["SI7"],
    scope: ".",
    tier: "authoritative",
    enforcement_points: points,
    measuring_mechanism: mechanism,
    parameters: {},
    proof: {
      clean: null,
      violation: null,
      failure_shape: null,
      timeout_seconds: null,
      external_effects: null,
    },
    accountable_party: null,
  };
}

/**
 * One point of a carriers result.
 * @param moment - `commit`, `push` or `post-tool`
 * @param outcome - What became of it
 * @param extra - The agent and how its refusal is known, for an agent point
 * @returns The point
 */
function carried(
  moment: string,
  outcome: HandedCarrierPoint["outcome"],
  extra: Partial<HandedCarrierPoint> = {}
): HandedCarrierPoint {
  return {
    kind: moment === "post-tool" ? "agent-hook" : "git-hook",
    location: moment === "post-tool" ? "coding-agent" : "local-checkout",
    moment,
    outcome,
    reason: outcome === "blocked" ? "A hook file is in the way." : null,
    ...extra,
  };
}

/**
 * A carriers result holding the given points.
 * @param points - The points
 * @returns The result
 */
function carriers(points: readonly HandedCarrierPoint[]): HandedCarriers {
  return { mode: "install", enforcement_points: points, changes: [] };
}

/**
 * A merge-protection result.
 * @param outcome - What it says of the entry; left out, it lists no entry
 * @returns The result
 */
function protect(outcome?: "wired" | "blocked"): HandedProtect {
  return {
    mode: "read-only",
    branch: "main",
    platform: { name: "github" },
    entries:
      outcome === undefined
        ? []
        : [
            {
              id: "code-style@.",
              outcome,
              reason: `The platform says ${outcome}.`,
            },
          ],
    handover: {
      path: ".lisa/controls/merge-protection-change.md",
      action: "none",
    },
    requests: [],
  };
}

const FILE_WIRED: PointVerdict = {
  state: "wired",
  reason: "The pipeline file runs the gate runner.",
  checked: PIPELINE_FILE,
};

/**
 * Judge one entry.
 * @param judged - The entry
 * @param sources - The carriers and merge-protection results
 * @param sources.carriers - The carriers result
 * @param sources.protect - The merge-protection result
 * @param sources.file - What reading the host's pipeline file says
 * @returns The judged entry
 */
async function judge(
  judged: ControlRegisterEntry,
  sources: {
    readonly carriers?: HandedCarriers;
    readonly protect?: HandedProtect;
    readonly file?: PointVerdict;
  } = {}
): Promise<EnforcedEntry> {
  const [result] = await enforcedEntries(
    { schema_version: 1, entries: [judged] },
    {
      carriers: sources.carriers ?? carriers([carried("commit", "installed")]),
      protect: sources.protect ?? protect(),
      executorVerdict: () => Promise.resolve(sources.file ?? FILE_WIRED),
    }
  );
  if (result === undefined) throw new Error("No entry was judged.");
  return result;
}

describe("a commit or push point", () => {
  it.each(["installed", "updated", "already-wired"] as const)(
    "is wired when the carrier is %s",
    async outcome => {
      const judged = await judge(entry([COMMIT]), {
        carriers: carriers([carried("commit", outcome)]),
      });

      expect(judged.outcome).toBe("wired");
    }
  );

  it("is blocked, for the carrier's own reason, when the carrier is blocked", async () => {
    const judged = await judge(entry([COMMIT]), {
      carriers: carriers([carried("commit", "blocked")]),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("A hook file is in the way.");
  });

  it("is blocked when the carriers result says nothing about the moment", async () => {
    const judged = await judge(entry([COMMIT]), { carriers: carriers([]) });

    expect(judged.outcome).toBe("blocked");
  });
});

describe("a point after a coding agent writes a file", () => {
  const agents = [
    carried("post-tool", "installed", {
      agent: "claude",
      refusal_evidence: "documented",
    }),
    carried("post-tool", "installed", {
      agent: "devin",
      refusal_evidence: "assumed",
    }),
    carried("post-tool", "unenforceable", { agent: "agy" }),
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

  it("is blocked when one agent's carrier is blocked", async () => {
    const judged = await judge(entry([EDIT]), {
      carriers: carriers([
        ...agents,
        carried("post-tool", "blocked", { agent: "codex" }),
      ]),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("On codex");
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

describe("what an entry's points add up to", () => {
  it("is blocked when one point is wired and another is blocked", async () => {
    const judged = await judge(entry([COMMIT, MERGE]), {
      protect: protect("blocked"),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.points.map(point => point.state)).toEqual([
      "wired",
      "blocked",
    ]);
  });

  it("is wired when one point is wired and another could not be checked", async () => {
    const judged = await judge(entry([COMMIT, DEPLOY]));

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain(
      "Not checked by the enforce step: pre-deploy:production"
    );
  });

  it("is blocked when a declared command runs only where nothing Lisa installs starts it", async () => {
    const judged = await judge(entry([DEPLOY]));

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("scripts/lisa-run-gates.mjs");
  });

  it("has nothing to enforce when a shipped check runs only where Lisa's project type runs it", async () => {
    expect((await judge(entry([DEPLOY], TASK))).outcome).toBe(NOTHING);
  });

  it("has nothing to enforce when every moment is switched off", async () => {
    expect((await judge(entry([]))).outcome).toBe(NOTHING);
  });
});
