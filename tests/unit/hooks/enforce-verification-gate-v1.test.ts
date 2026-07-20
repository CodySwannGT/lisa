/**
 * v1 compatibility pins for the enforce-verification-gate.sh Stop hook.
 *
 * This hook is the non-bypassable completion gate for /lisa:implement, so its
 * pre-schema-v2 decision table is pinned here verbatim. These tests are the
 * compatibility proof for the v1/v2 window: they passed before the v2 upgrade
 * and must pass identically after it, because a verdict with no
 * `schema_version` (or `1`) has to be judged exactly as it was before v2
 * existed. A change that reddens this file is a break in the compat window,
 * not a test that needs updating.
 *
 * Fail-open and MAX_BLOCKS escalation are pinned here too — a malformed or
 * missing verdict must block (a green gate is never free) while the block
 * counter guarantees the session is never hard-wedged.
 * @module tests/unit/hooks/enforce-verification-gate-v1
 */
import {
  FAILING_CRITERION,
  PASSING_CRITERION,
  v1Verdict,
} from "../../helpers/verification-gate-fixtures";
import type { GateScenario } from "../../helpers/verification-gate-harness";
import {
  createGateScenario,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  MAX_BLOCKS,
} from "../../helpers/verification-gate-harness";

let harness: GateScenario;

beforeEach(() => {
  harness = createGateScenario(process.env);
});

afterEach(() => {
  harness.cleanup();
});

describe("enforce-verification-gate.sh (v1 compatibility)", () => {
  describe("arming and exemptions", () => {
    it("allows a stop when no implement flow was ever armed", () => {
      expect(harness.stop("idle-session").status).toBe(EXIT_ALLOWED);
    });

    it("arms on a /lisa:implement prompt", () => {
      harness.armSession("s1");
      expect(harness.stop("s1").status).toBe(EXIT_BLOCKED);
    });

    it("arms when the Skill tool loads lisa-implement", () => {
      harness.runHook({
        hook_event_name: "PreToolUse",
        session_id: "s2",
        tool_name: "Skill",
        tool_input: { skill: "lisa-implement" },
      });
      expect(harness.stop("s2").status).toBe(EXIT_BLOCKED);
    });

    it("never gates a teammate (subagent) stop", () => {
      harness.armSession("s3");
      harness.runHook({
        hook_event_name: "SubagentStart",
        session_id: "s3",
      });
      expect(harness.stop("s3").status).toBe(EXIT_ALLOWED);
    });
  });

  describe("decision table", () => {
    it("blocks when no verdict file exists", () => {
      harness.armSession("v1-missing");
      const { status, stderr } = harness.stop("v1-missing");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("No verification verdict found");
    });

    it("releases on a schema-less pass verdict with all criteria passing", () => {
      harness.armSession("v1-pass");
      harness.writeVerdict(v1Verdict("pass", [PASSING_CRITERION]));
      expect(harness.stop("v1-pass").status).toBe(EXIT_ALLOWED);
    });

    it("releases on an explicit schema_version 1 pass verdict", () => {
      harness.armSession("v1-explicit");
      harness.writeVerdict(
        v1Verdict("pass", [PASSING_CRITERION], { schema_version: 1 })
      );
      expect(harness.stop("v1-explicit").status).toBe(EXIT_ALLOWED);
    });

    it("releases on a blocked verdict (deliberate stop)", () => {
      harness.armSession("v1-blocked");
      harness.writeVerdict(
        v1Verdict("blocked", [
          {
            ...PASSING_CRITERION,
            status: "blocked",
            evidence: "no AWS access",
          },
        ])
      );
      expect(harness.stop("v1-blocked").status).toBe(EXIT_ALLOWED);
    });

    it("disarms after releasing so a follow-up stop is not re-gated", () => {
      harness.armSession("v1-disarm");
      harness.writeVerdict(v1Verdict("pass", [PASSING_CRITERION]));
      harness.stop("v1-disarm");
      harness.writeVerdict(v1Verdict("in_progress", []));
      expect(harness.stop("v1-disarm").status).toBe(EXIT_ALLOWED);
    });

    it("blocks a pass verdict that still carries a failing criterion", () => {
      harness.armSession("v1-failcrit");
      harness.writeVerdict(
        v1Verdict("pass", [PASSING_CRITERION, FAILING_CRITERION])
      );
      const { status, stderr } = harness.stop("v1-failcrit");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("T2");
    });

    it("blocks an in_progress verdict", () => {
      harness.armSession("v1-inprogress");
      harness.writeVerdict(v1Verdict("in_progress", [PASSING_CRITERION]));
      expect(harness.stop("v1-inprogress").status).toBe(EXIT_BLOCKED);
    });

    it("blocks a fail verdict", () => {
      harness.armSession("v1-fail");
      harness.writeVerdict(v1Verdict("fail", [FAILING_CRITERION]));
      expect(harness.stop("v1-fail").status).toBe(EXIT_BLOCKED);
    });

    it("blocks a stale verdict left over from a previous plan", () => {
      harness.armSession("v1-stale");
      harness.writeVerdict(v1Verdict("pass", [PASSING_CRITERION]), {
        stale: true,
      });
      expect(harness.stop("v1-stale").status).toBe(EXIT_BLOCKED);
    });

    it("does not crash on a malformed verdict", () => {
      harness.armSession("v1-malformed");
      harness.writeVerdict("{ this is not json");
      expect(harness.stop("v1-malformed").status).toBe(EXIT_BLOCKED);
    });

    it("escalates and releases after MAX_BLOCKS consecutive blocks", () => {
      const session = "v1-escalate";
      harness.armSession(session);
      for (let i = 0; i < MAX_BLOCKS; i += 1) {
        expect(harness.stop(session).status).toBe(EXIT_BLOCKED);
      }
      const { status, stderr } = harness.stop(session);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("Do NOT claim this work is verified");
    });
  });
});
