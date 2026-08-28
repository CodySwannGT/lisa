/**
 * Closed authored/generated parity for stable review identity handling (#3382).
 * @module tests/unit/strategies/latest-review-identity-parity
 */
import { describe, expect, it } from "vitest";

import {
  extractReviewCommand,
  extractReviewFilter,
  filesBelow,
  LEGACY_REVIEW_FILTER,
  readRepositoryFile,
  REVIEW_SKILL_SURFACES,
  SOURCE_REVIEW_SKILL,
} from "../../helpers/latest-review-reducer-harness.js";

describe("closed stable-reviewer generated parity", () => {
  it("discovers exactly the six registered merge-driving surfaces", () => {
    const discovered = filesBelow("plugins").filter(file =>
      file.endsWith("/skills/lisa-drive-pr-to-merge/SKILL.md")
    );

    expect(discovered).toEqual(
      [...REVIEW_SKILL_SURFACES].toSorted((left, right) =>
        left.localeCompare(right)
      )
    );
  });

  it.each(REVIEW_SKILL_SURFACES)(
    "pins stable reviewer handling in %s",
    surface => {
      const sourceCommand = extractReviewCommand(
        readRepositoryFile(SOURCE_REVIEW_SKILL)
      );
      const body = readRepositoryFile(surface);
      const command = extractReviewCommand(body);
      const filter = extractReviewFilter(command);
      const ordering = filter.indexOf("sort_by(");
      const reduction = filter.indexOf("reduce ");
      const preOrdering = filter.slice(0, ordering);
      const identityGuard = preOrdering.search(
        /select\(\s*\.user\.login\?\s*\|\s*strings\s*\|\s*test\("\\\\S"\)\s*\)/u
      );

      expect(command).toBe(sourceCommand);
      expect(identityGuard).toBeGreaterThanOrEqual(0);
      expect(identityGuard).toBeLessThan(ordering);
      expect(ordering).toBeLessThan(reduction);
      expect(filter).not.toBe(LEGACY_REVIEW_FILTER);
      expect(body).toMatch(/stable non-empty reviewer (?:identity|login)/iu);
      expect(body).toMatch(/identity-less review/iu);
      expect(body).toMatch(/raw review payload/iu);
      expect(body).toMatch(/account (?:data|detail)/iu);
    }
  );
});
