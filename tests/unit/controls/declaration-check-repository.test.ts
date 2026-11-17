/**
 * `lisa controls declaration-check` for a requirement that has one answer for
 * the whole repository.
 *
 * Such a requirement has its only finding in the whole-repository section of
 * the audit report, whichever folder its check was found in. A part declared
 * for that folder is supported by that finding, and a question still open
 * there stops a part in every folder (CodySwannGT/lisa#4984).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  foundAt,
  openQuestion,
  reportWith,
} from "../../helpers/control-audit-findings.js";
import { evidenceAt, type GatesBlock } from "../../helpers/control-register.js";
import {
  MIXED_PARTS,
  configured,
  declarationCheck,
} from "./support/declaration-check-run.js";
import { removeFixtures } from "./support/report-check-run.js";

/** A requirement about secrets, which is answered once for the repository. */
const SECRETS = "AC6.3";

/** A requirement about style, which is answered for each part. */
const STYLE = "SI7";

const API_SETTINGS = "api/ruff.toml";

/**
 * A secret scanner declared for one folder.
 * @param scope - The folder the part covers
 * @returns The `gates` block
 */
function scanner(scope: string): GatesBlock {
  return {
    "credential-leakage": {
      "pull-request": "required",
      criteria: [SECRETS],
      parts: [
        {
          scope,
          command: ["gitleaks", "detect"],
          evidence: evidenceAt(API_SETTINGS),
        },
      ],
    },
  };
}

afterEach(removeFixtures);

describe("a requirement with one answer for the whole repository", () => {
  const FOUND = reportWith(MIXED_PARTS, [foundAt(SECRETS, ".", API_SETTINGS)]);
  const OPEN = reportWith(MIXED_PARTS, [openQuestion(SECRETS, ".")]);

  it.each(["api", "."])(
    "supports a part for %j from the finding in the whole-repository section",
    async scope => {
      const run = await declarationCheck(
        configured("F-mixed", scanner(scope), FOUND)
      );

      expect(run.stderr).toEqual([]);
      expect(run.code).toBe(0);
    }
  );

  it("stops a part in any folder while its question is open", async () => {
    const run = await declarationCheck(
      configured("F-mixed", scanner("api"), OPEN)
    );

    expect(run.code).toBe(1);
    expect(
      run.stderr.filter(line =>
        line.includes(
          "has a part for the folder api, but the audit still has an open question for the whole repository"
        )
      )
    ).toHaveLength(1);
  });

  it("does not lend its finding to a gate that serves another requirement", async () => {
    const run = await declarationCheck(
      configured(
        "F-mixed",
        {
          "code-style": {
            "pull-request": "required",
            criteria: [STYLE],
            parts: [
              {
                scope: "api",
                command: ["ruff", "check", "."],
                evidence: evidenceAt(API_SETTINGS),
              },
            ],
          },
        },
        FOUND
      )
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("reports no check there for a requirement");
  });
});
