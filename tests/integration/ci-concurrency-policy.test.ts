/** Superseded PRs may stop; distinct manual runs must retain their own slots. */
import fs from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { githubCondition } from "../helpers/github-expression.js";

const workflow = load(
  fs.readFileSync("typescript/create-only/.github/workflows/ci.yml", "utf8")
) as {
  concurrency: { group: string; "cancel-in-progress": string };
};

describe("seeded CI concurrency", () => {
  it.each(["workflow_dispatch", "schedule"])(
    "keeps distinct %s requests",
    event => {
      const context = {
        github: {
          event_name: event,
          event: {},
          run_id: "run-a",
          ref: "refs/heads/main",
        },
      };
      const groupExpression = workflow.concurrency.group
        .replace(/^ci-\$\{\{|\}\}$/gu, "")
        .trim();
      expect(githubCondition(`(${groupExpression}) == 'run-a'`, context)).toBe(
        true
      );
      expect(githubCondition(`(${groupExpression}) == 'run-b'`, context)).toBe(
        false
      );
      expect(
        githubCondition(workflow.concurrency["cancel-in-progress"], context)
      ).toBe(false);
    }
  );

  it("groups successive PR revisions together and cancels the superseded run", () => {
    const context = {
      github: {
        event_name: "pull_request",
        event: { pull_request: { number: 42 } },
        run_id: "run-a",
      },
    };
    const groupExpression = workflow.concurrency.group
      .replace(/^ci-\$\{\{|\}\}$/gu, "")
      .trim();
    expect(githubCondition(`(${groupExpression}) == 42`, context)).toBe(true);
    expect(
      githubCondition(workflow.concurrency["cancel-in-progress"], context)
    ).toBe(true);
  });
});
