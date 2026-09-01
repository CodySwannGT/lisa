/**
 * Declaration coverage for the tracker whose build-ready role is a STATE.
 *
 * GitHub's ready role is a label, labels are argv-native, and `--label` has
 * always been writable. JIRA's and Linear's are workflow STATES: the mandated
 * client is `curl`, `curl` has no flag that carries a state, and the state
 * lives in the payload as an id the guard cannot resolve without a network
 * round-trip it refuses to make.
 *
 * So the only declaration those trackers could satisfy was `[lisa-human-gate]`
 * — which the guard's own comments correctly forbid on a build-ready item,
 * because it stamps the item as held for a human product call and build-intake
 * scans the ready role and nothing else. An honest operator had NO compliant
 * command and exactly one dishonest one, which is a guard failing in the
 * harmful direction: complying was worse than not.
 *
 * What these tests pin is the SCOPE of the remedy. The lifecycle-role
 * declaration answers only where nothing checkable can be written down —
 * a state-based tracker filing at its own tracker. On GitHub, same-repo or
 * cross-repo, the label is still the only declaration, because a second and
 * weaker spelling where a real one exists is a hole rather than a remedy.
 * @module tests/unit/hooks/block-direct-issue-create-state-declaration
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A Linear-tracked project, whose build-ready role is a workflow state. */
const LINEAR_CONFIG = {
  tracker: "linear",
  linear: { workflow: { ready: "Ready" } },
};

/** The GraphQL body a hand-rolled Linear creation submits. */
const LINEAR_MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

/**
 * Write a file into a throwaway project directory.
 * @param cwd - The project directory.
 * @param name - The file name.
 * @param body - The contents.
 * @returns The absolute path written.
 */
const fixture = (cwd: string, name: string, body: string): string => {
  const target = path.join(cwd, name);
  writeFileSync(target, body, "utf-8");
  return target;
};

/** The first line of every script fixture below. */
const SHEBANG = "#!/usr/bin/env bash";

describe("block-direct-issue-create.sh state-role declarations", () => {
  describe("a state-based tracker has a declaration it can actually write", () => {
    it("refuses a hand-rolled Linear creation that declares nothing", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { status } = runHook(
        bash(
          `curl -X POST https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows the same creation when it declares the ready lifecycle role", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { status } = runHook(
        bash(
          "LIFECYCLE_ROLE=ready curl -X POST https://api.linear.app/graphql " +
            `-d '${LINEAR_MUTATION}'`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows the role declared inside the executed script", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(
        cwd,
        "declared.sh",
        [
          SHEBANG,
          "LIFECYCLE_ROLE=ready",
          "curl -sS -X POST https://api.linear.app/graphql \\",
          `  -d '${LINEAR_MUTATION}'`,
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("refuses a lifecycle role that is not the build-ready one", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { status } = runHook(
        bash(
          "LIFECYCLE_ROLE=blocked curl -X POST " +
            `https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the lifecycle-role path in the refusal a Linear operator sees", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { stderr } = runHook(
        bash(
          `curl -X POST https://api.linear.app/graphql -d '${LINEAR_MUTATION}'`
        ),
        { cwd }
      );

      expect(stderr).toContain("LIFECYCLE_ROLE=ready");
    });

    // The escape exists because a state cannot be written in argv. On GitHub
    // the label CAN be, so a second and weaker spelling there would be a hole
    // rather than a remedy.
    it("does not accept the role declaration on a label-based tracker", () => {
      const { status } = runHook(
        bash("gh issue create --title x --body 'lifecycle_role:ready'")
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The refusal tells the operator to put the declaration in the request
    // payload, and a JSON payload quotes its keys. A pattern that refused the
    // spelling it just asked for would put the operator back where #3484 found
    // them: instructed to do something the guard rejects.
    it("accepts the JSON spelling the refusal message asks for", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { status } = runHook(
        bash(
          "curl -X POST https://api.linear.app/graphql " +
            `-d '{"lifecycle_role": "ready", "query":` +
            `"mutation{issueCreate(input:{}){id}}"}'`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("does not accept a file-scope role on a cross-repo GitHub filing", () => {
      const cwd = projectWithTracker({
        tracker: "linear",
        linear: { workflow: { ready: "Ready" } },
        github: { org: "own-org", repo: "own-repo" },
      });
      const script = fixture(
        cwd,
        "cross.sh",
        [
          "# lifecycle_role: ready",
          'gh issue create --repo other-org/other-repo --title "x"',
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("does not accept the role declaration on a cross-repo GitHub filing", () => {
      const cwd = projectWithTracker({
        tracker: "linear",
        linear: { workflow: { ready: "Ready" } },
        github: { org: "examplecorp", repo: "widget-service" },
      });

      const { status } = runHook(
        bash(
          "LIFECYCLE_ROLE=ready gh issue create --repo otherorg/othername " +
            "--title x --body y"
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });
  });
});
