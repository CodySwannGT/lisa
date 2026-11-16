/**
 * CodySwannGT/lisa#4923: the source authority the hermetic helper owner relies
 * on still refuses. Suites pin owner discovery to a committed private owner so
 * they never depend on the run being a Git checkout or on the live registry;
 * this proves the redirect only chooses the owner and grants nothing — the
 * signed commit, byte equality and the import still decide.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs",
  async original =>
    (
      await import("../../support/npm-update-helper-owner.js")
    ).withHermeticOwner(await original())
);

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalClassifier } from "../../../all/copy-overwrite/scripts/lib/npm-update-helper.mjs";
import { CLASSIFIER_MEMBERS } from "../../../all/copy-overwrite/scripts/lib/npm-update-helper-inventory.mjs";
import { hermeticOwner } from "../../support/npm-update-helper-owner.js";

/**
 * A fresh config signed by one commit.
 * @param signerDigest - The approved commit.
 * @returns The config.
 */
const signedBy = (signerDigest: string) => ({
  automationProvenance: { signerDigest },
});

describe("source authority behind the hermetic helper owner", () => {
  const member = join(hermeticOwner().root, CLASSIFIER_MEMBERS[1]!);
  const committed = readFileSync(member);
  afterEach(() => writeFileSync(member, committed));

  it("authenticates the committed members signed by the owner's commit", async () => {
    expect(
      typeof (await canonicalClassifier(signedBy(hermeticOwner().head)))
    ).toBe("function");
  });

  it("refuses a member whose bytes differ from the signed commit", async () => {
    writeFileSync(member, Buffer.concat([committed, Buffer.from("\n")]));
    await expect(
      canonicalClassifier(signedBy(hermeticOwner().head))
    ).rejects.toThrow("canonical helper differs from approved Git blob");
  });

  it("refuses a signer commit the owner does not hold", async () => {
    await expect(canonicalClassifier(signedBy("f".repeat(40)))).rejects.toThrow(
      "approved helper Git member unavailable"
    );
  });
});
