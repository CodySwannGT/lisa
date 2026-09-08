/**
 * A seeded file whose ownership banner contradicts its lane (#3582).
 *
 * Lisa ships two ownership headers and they are opposite contracts:
 * `copy-overwrite` says "managed by Lisa and IS replaced on each run";
 * `create-only` says "this file is YOURS — Lisa will not overwrite it". Which
 * header a TEMPLATE carries is already enforced repo-wide. Nothing checks the
 * copy sitting in an already-seeded consumer.
 *
 * The CDK caller templates moved from the copy-overwrite lane to create-only —
 * verified on `origin/main`, where `cdk/create-only/.github/workflows/` holds
 * `ci.yml` and `deploy.yml` while `cdk/copy-overwrite/.github/workflows/` holds
 * only a `.keep`. A consumer seeded before that move still carries the old
 * banner, which now states the opposite of the truth.
 *
 * ## Why the stale direction is the harmful one
 *
 * MEASURED in the report: a repository had pinned its reusable-workflow refs to
 * immutable SHAs. On the strength of the stale banner a reviewer concluded the
 * pins would be erased on every apply, and nearly reverted them to a moving
 * `@main` ref AND excluded those files from the guard that enforces pinning.
 * The reasoning was sound; the premise was false. It survived five rounds of
 * review by two parties, because the banner is the natural place to look for
 * the ownership contract and nothing contradicts it locally.
 *
 * ## Why this reports and does not rewrite
 *
 * A migration that corrected the banner would have Lisa write into the very
 * file whose new banner promises Lisa will not write into it — self-refuting in
 * the most literal way available, and the consumer who diffs that apply has
 * been handed evidence not to believe the new sentence either. The harm here is
 * a false BELIEF, and a doctor line corrects a belief without touching bytes a
 * consumer owns and may have edited. That asymmetry is the argument: a stale
 * banner makes a reader too conservative, while a banner-rewriting migration
 * can clobber a header a consumer customised.
 *
 * It also catches the drift in BOTH directions, which a one-way rewrite cannot:
 * a copy-overwrite file wearing a create-only banner is the inverse defect, and
 * the same comparison reports it.
 * @module tests/unit/cli/doctor-ownership-banner-drift
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkOwnershipBannerDrift } from "../../../src/cli/doctor-ownership-banner-drift.js";

/** The banner a create-only seed carries. */
const SEEDED = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
].join("\n");

/** The banner a copy-overwrite asset carries. */
const MANAGED = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
].join("\n");

const roots: string[] = [];

afterEach(async () => {
  // Removed, not merely forgotten. The suite's own scratch-leak guard fails a
  // file that leaves fixture directories behind, and it caught this exact
  // omission — clearing the array is not cleaning up.
  await Promise.all(
    roots.map(root => rm(root, { force: true, recursive: true }))
  );
  roots.length = 0;
});

/**
 * Build a throwaway consumer tree with one workflow carrying `header`.
 *
 * @param header - The ownership banner to seed the workflow with
 * @param name - Workflow filename
 * @returns The temp directory acting as the consumer root
 */
async function consumerWith(header: string, name = "ci.yml"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "t3582-"));
  roots.push(root);
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".github", "workflows", name),
    `${header}\n\nname: CI\non: push\n`,
    "utf8"
  );
  return root;
}

describe("a seeded caller still wearing the managed banner is reported", () => {
  it("warns when a create-only workflow carries the copy-overwrite banner", async () => {
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.status).toBe("warn");
  });

  it("names the file, so the operator does not have to hunt for it", async () => {
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.detail).toContain("ci.yml");
  });

  it("says the edits are safe, which is the belief that needs correcting", async () => {
    // The measured harm was a reader declining an edit they were entitled to
    // make. A finding that only says "drift" leaves that belief in place.
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.detail).toContain("edits to these files are safe");
  });

  it("does not tell the operator to run an apply to fix it", async () => {
    // An apply cannot fix it: the file is create-only, so apply skips it
    // entirely. Advice that cannot be followed is the defect one square over.
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.detail).not.toContain("lisa apply");
  });
});

describe("rejection controls: what must NOT be reported", () => {
  it("passes a create-only workflow carrying the correct banner", async () => {
    // Without this the check could warn on everything and satisfy every
    // assertion above.
    //
    // It is also the scope boundary, deliberately: the inverse defect — a
    // copy-overwrite asset wearing a create-only banner — is NOT reported.
    // Deciding that needs the consumer's lane, and the lane is a property of
    // their stack, not of the file. `ci.yml` ships create-only on five stacks
    // and copy-overwrite on two, so this exact input is correct in one
    // consumer and stale in the next. Passing it is the honest answer from a
    // check that reads banners; flagging it would be a guess in the direction
    // that costs a consumer their edits.
    const result = await checkOwnershipBannerDrift(await consumerWith(SEEDED));

    expect(result.status).toBe("ok");
  });

  it("passes a workflow carrying no Lisa banner at all", async () => {
    // A consumer's own workflow is not Lisa's to classify, and warning on one
    // would put a permanent finding in front of an operator who cannot clear it.
    const result = await checkOwnershipBannerDrift(
      await consumerWith("# our own workflow", "internal.yml")
    );

    expect(result.status).toBe("ok");
  });

  it("passes a tree with no workflows directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "t3582-"));
    roots.push(root);

    expect((await checkOwnershipBannerDrift(root)).status).toBe("ok");
  });

  it("does not read a banner mentioned far below the header", async () => {
    // Bounded to the header window, exactly as the deletion-ownership module
    // bounds its own read: a step name or a comment mentioning Lisa anywhere in
    // a long workflow must not classify the file.
    const buried = `${SEEDED}\n\n${"# filler\n".repeat(20)}# managed by Lisa\n`;
    const result = await checkOwnershipBannerDrift(await consumerWith(buried));

    expect(result.status).toBe("ok");
  });
});

describe("the check is actually wired into doctor", () => {
  it("is imported and invoked by doctor.ts", async () => {
    // A check nothing calls is the defect this batch keeps finding: detection
    // that exists, reports correctly in isolation, and never runs. Asserted
    // against the source rather than by driving the CLI, because the property
    // that matters is REGISTRATION, not argument parsing.
    const source = await readFile(
      new URL("../../../src/cli/doctor.ts", import.meta.url),
      "utf8"
    );

    expect(source).toContain("doctor-ownership-banner-drift.js");
    expect(source).toContain("await checkOwnershipBannerDrift(resolvedTarget)");
  });
});
