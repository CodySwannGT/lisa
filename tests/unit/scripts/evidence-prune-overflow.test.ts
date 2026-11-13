/**
 * The prune re-reads the overflow releases the publisher rolls over to
 * (CodySwannGT/lisa#4838), so a record published into `<release>-2` mid-run
 * still protects the files it depends on. Nothing pinned is ever deleted.
 * @module tests/unit/scripts/evidence-prune-overflow
 */
import { afterEach, describe, expect, it } from "vitest";

import { resolveEvidenceRelease } from "../../../all/copy-overwrite/scripts/lib/completion-proof-github.mjs";
import { fakeGitHub } from "../../support/evidence-prune-fake-gh.js";
import {
  APPLY,
  cleanupProjects,
  OLD,
  project,
  prune,
  RECORD_AT,
  recordBody,
  RELEASE,
  ROTATING,
  seed,
  STALE,
} from "../../support/evidence-prune-harness.js";

const ROTATED = { verification: { completion: { evidenceRelease: ROTATING } } };
const LATE_RECORD = `completion-99-r1-${"9".repeat(64)}.json`;

afterEach(cleanupProjects);

describe("evidence prune and overflow releases", () => {
  it("keeps a file that a record published mid-run into an overflow release depends on", async () => {
    // The rescan resolves the publisher's release on the real clock.
    const current = resolveEvidenceRelease(
      ROTATED.verification.completion,
      new Date()
    );
    const gh = fakeGitHub({
      onUpload: () =>
        gh.addAsset(
          `${current}-2`,
          LATE_RECORD,
          RECORD_AT,
          recordBody([stale.id])
        ),
    });
    const { stale } = seed(gh);
    gh.addAsset(current, "full-month.txt", OLD);
    const { code, output } = await prune(
      gh,
      [APPLY, "--release", RELEASE],
      project(ROTATED)
    );
    expect(code).toBe(0);
    expect(gh.names(RELEASE)).toContain(STALE);
    expect(output).toMatch(/stale\.txt.*now depends on it/);
  });
});
