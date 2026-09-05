/**
 * The container arm of `block-direct-issue-create.sh`.
 *
 * The guard used to accept exactly two declarations — the configured
 * build-ready role, or a `[lisa-human-gate]` marker. Neither is legitimate for
 * a container: `leaf-only-lifecycle` FORBIDS the build-ready role on an Epic,
 * and `lisa-github-write-issue` says a container needs no human gate because
 * its state rolls up from children. So a container could be filed only by
 * writing something untrue, and both available untruths corrupt data another
 * control reads — a container in the build lane is exactly the input
 * `leaf-only-lifecycle`'s claim-time arm exists to reject, and a fabricated
 * hold marker is a state change with no inverse.
 *
 * The third declaration is NOT the declared type. `--label type:Epic` costs a
 * leaf nothing and yields an item that still looks buildable, which is the
 * shape of this repository's measured case where an allowlist added to harden
 * a guard became the way around it. It is the canonical container line that
 * `derived-branch-plan` already defines and `lisa-github-write-issue` already
 * stamps in place of a Target Backend Environment. Writing it costs the item
 * the environment and Branch Plan a leaf needs to be built, so the declaration
 * is only useful to something that actually is a container.
 *
 * Both arms are pinned here. A change that admits containers and also stops
 * refusing an unreadied leaf has moved the defect, not fixed it.
 * @module tests/unit/hooks/block-direct-issue-create-container
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  CONTAINER_DECLARATION,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
  UNDECLARED_CREATE,
} from "./support/direct-issue-create.js";

describe("block-direct-issue-create.sh container arm", () => {
  describe("a container declares neither ready nor gated, and is allowed", () => {
    it("allows an Epic whose inline body carries the container declaration", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "Harden the filing path" ' +
            '--label "type:Epic" ' +
            `--body "## Target Backend Environment\n\n${CONTAINER_DECLARATION}\n"`
        )
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows an Epic whose --body-file carries the container declaration", () => {
      const cwd = projectWithTracker();
      const bodyPath = path.join(cwd, "epic.md");
      writeFileSync(
        bodyPath,
        `## Target Backend Environment\n\n${CONTAINER_DECLARATION}\n`,
        "utf-8"
      );

      const { status } = runHook(
        bash(
          `gh issue create --title "Harden the filing path" ` +
            `--label "type:Epic" --body-file ${bodyPath}`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a container filing that names no type label at all", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "Rollup" ' +
            `--body "${CONTAINER_DECLARATION}"`
        )
      );

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("the leaf arm still bites — the control on this change", () => {
    it("refuses a leaf filing that declares neither a role nor a gate", () => {
      const { status, stderr } = runHook(bash(UNDECLARED_CREATE));

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("status:ready");
      expect(stderr).toContain("[lisa-human-gate]");
    });

    it("refuses a leaf whose body merely mentions containers in prose", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "x" ' +
            '--body "This is not a container and its state does not roll up."'
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a leaf whose body describes the rollup without declaring it", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "x" ' +
            '--body "For an Epic, container: state rolls up from children."'
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("a leaf cannot escape by claiming to be a container", () => {
    it("refuses the container declaration paired with type:Bug", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "Crash on save" --label "type:Bug" ' +
            `--body "${CONTAINER_DECLARATION}"`
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses the container declaration paired with type:Task", () => {
      const { status } = runHook(
        bash(
          'gh issue create --title "Rename the flag" --label "type:Task" ' +
            `--body "${CONTAINER_DECLARATION}"`
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses the container declaration paired with a jira --type leaf", () => {
      const { status } = runHook(
        bash(
          `jira issue create --summary "x" --type Bug ` +
            `--body "${CONTAINER_DECLARATION}"`
        ),
        {
          cwd: projectWithTracker({
            tracker: "jira",
            jira: { workflow: { ready: "Ready" } },
          }),
        }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a container declaration that arrives only after a bare --", () => {
      const { status } = runHook(
        bash(`gh issue create --title "x" -- --body "${CONTAINER_DECLARATION}"`)
      );

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("the refusal names the container route", () => {
    it("tells a refused filer how a container declares itself", () => {
      const { stderr } = runHook(bash(UNDECLARED_CREATE));

      expect(stderr).toContain(CONTAINER_DECLARATION);
    });
  });

  describe("the guard and the filing skill agree on what a container is", () => {
    /**
     * One string, defined in one rule, read by the guard and stamped by the
     * writer. The root cause of the defect this pins was an exemption that
     * lived in writer prose while the guard that runs knew nothing about it;
     * asserting the agreement is what stops it diverging a second time.
     * @param relative - A repo-relative path to one of the artifacts.
     * @returns The file's contents.
     */
    const readSource = (relative: string): string =>
      readFileSync(path.resolve(relative), "utf-8");

    it.each([
      [
        "the rule that defines it",
        "plugins/src/base/rules/reference/derived-branch-plan.md",
      ],
      [
        "the rule that requires it",
        "plugins/src/base/rules/reference/ready-role-filing.md",
      ],
      [
        "the writer that stamps it",
        "plugins/src/base/skills/lisa-github-write-issue/SKILL.md",
      ],
      [
        "the guard that reads it",
        "plugins/src/base/hooks/block-direct-issue-create.sh",
      ],
    ])("%s carries the declaration verbatim", (_role, relative) => {
      expect(readSource(relative)).toContain(CONTAINER_DECLARATION);
    });

    it("names the same by-design leaf types the rule does", () => {
      const guard = readSource(
        "plugins/src/base/hooks/block-direct-issue-create.sh"
      );
      const rule = readSource(
        "plugins/src/base/rules/reference/leaf-only-lifecycle.md"
      );

      expect(rule).toContain(
        "the by-design leaf types (Bug, Task, Sub-task, Improvement)"
      );
      expect(guard).toContain(
        'BY_DESIGN_LEAF_TYPES = {"bug", "task", "sub-task", "subtask", "improvement"}'
      );
    });
  });
});
