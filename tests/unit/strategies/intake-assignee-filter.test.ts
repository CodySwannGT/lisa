/**
 * Regression tests for the optional local assignee filter on build-intake.
 *
 * Intake may narrow the ready queue to items already assigned to one person for
 * a local automation lane, but the default shared queue behavior must remain
 * unchanged when no assignee is resolved. Both source and generated plugin
 * roots are asserted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

const ISSUE_PAGES = JSON.stringify([
  [
    { number: 1, labels: [{ name: "ready" }], assignees: [{ login: "sam" }] },
    { number: 2, labels: [{ name: "ready" }], assignees: [], pull_request: {} },
  ],
  [
    { number: 3, labels: [{ name: "ready" }], assignees: [{ login: "lee" }] },
    { number: 4, labels: [{ name: "blocked" }], assignees: [] },
  ],
]);

/**
 * Execute the documented query with paged API responses and the real jq filter.
 * @param content - Source or generated skill text.
 * @param assignee - Requested assignee, including the @me alias.
 * @param failed - Whether the API command fails after emitting partial data.
 * @returns The shell exit status and captured output.
 */
function runReadyQuery(content: string, assignee: string, failed = false) {
  const snippet = content
    .split("### Phase 2 — Find ready issues")[1]
    ?.split("```bash")[1]
    ?.split("```")[0];
  if (!snippet) throw new Error("Ready-query example was not found");
  return boundedSpawnSync({
    label: "documented intake ready query",
    command: "/bin/bash",
    cwd: path.resolve("."),
    args: [
      "-c",
      `
    gh() {
      [ "$1" = api ] || return 2
      if [ "$2" = user ]; then printf '%s' sam; return; fi
      case " $* " in *" repos/owner/repo/issues "*) ;; *) return 2 ;; esac
      case " $* " in *" --slurp "*) ;; *) return 2 ;; esac
      case " $* " in
        *" --paginate "*) printf '%s' "$TEST_ISSUE_PAGES" ;;
        *) printf '%s' "$TEST_ISSUE_PAGES" | jq '.[0:1]' ;;
      esac
      [ "$TEST_READ_FAILED" != 1 ]
    }
    ${snippet}
  `,
    ],
    env: {
      ...process.env,
      QUEUE_REPO: "owner/repo",
      READY: "ready",
      ASSIGNEE: assignee,
      TEST_ISSUE_PAGES: ISSUE_PAGES,
      TEST_READ_FAILED: failed ? "1" : "0",
    },
  });
}

describe("intake assignee filter", () => {
  describe.each(ROOTS)("%s/lisa-intake", root => {
    const content = readSkill(root, "lisa-intake");

    it("documents the assignee argument and local config resolution order", () => {
      expect(content).toContain("assignee=<vendor-user-id-or-login>");
      expect(content).toContain(".lisa.config.local.json` `intake.assignee`");
      expect(content).toMatch(/empty default/i);
    });

    it("states that the filter is selection-only", () => {
      expect(content).toMatch(/never assigns or reassigns tickets/i);
      expect(content).toMatch(
        /ready[\s\S]*already assigned to that assignee are considered/i
      );
    });
  });

  describe.each(ROOTS)("%s/lisa-github-build-intake", root => {
    const content = readSkill(root, "lisa-github-build-intake");

    it("documents assignee resolution for github build intake", () => {
      expect(content).toContain("assignee=<github-login>");
      expect(content).toContain(".lisa.config.local.json` `intake.assignee`");
      expect(content).toMatch(/empty default/i);
    });

    it.each([
      { assignee: "", expected: [1, 3] },
      { assignee: "sam", expected: [1] },
      { assignee: "@me", expected: [1] },
      { assignee: "missing", expected: [] },
    ])(
      "selects ready issues across pages for assignee '$assignee'",
      ({ assignee, expected }) => {
        const result = runReadyQuery(content, assignee);
        expect(result.status, result.stderr).toBe(0);
        expect(
          JSON.parse(result.stdout).map(
            (issue: { number: number }) => issue.number
          )
        ).toEqual(expected);
      }
    );

    it("does not dispatch from partial output when a page read fails", () => {
      const result = runReadyQuery(content, "", true);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    });

    it("preserves shared-queue behavior when no assignee is resolved", () => {
      expect(content).toMatch(/scan the shared ready queue exactly as before/i);
      expect(content).toMatch(
        /filter the ready-item query to issues already assigned/i
      );
    });
  });
});

const RULES_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;

describe.each(RULES_ROOTS)(
  "config-resolution intake.assignee docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("documents intake.assignee as a local-only override", () => {
      expect(content).toContain(
        "### Intake assignee filter (`intake.assignee`)"
      );
      expect(content).toMatch(/local-only/i);
      expect(content).toMatch(/\.lisa\.config\.local\.json/);
    });

    it("documents argument override and empty default behavior", () => {
      expect(content).toContain(
        "$ARGUMENTS` `assignee=<vendor-user-id-or-login>`"
      );
      expect(content).toMatch(/empty default/i);
      expect(content).toMatch(
        /empty resolved value disables the[\s\S]*shared ready-queue behavior/i
      );
    });
  }
);
