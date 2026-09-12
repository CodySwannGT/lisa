/**
 * Exercise ownership reporting with real consumer files, stack detection, and
 * shipped templates. A managed banner is stale only for a create-only workflow;
 * managed and unknown template lanes must never receive ownership reassurance.
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
const UNSAFE_REASSURANCE = "edits to these files are safe";
const HARPER_APP = "harper-app";
const TSCONFIG = "tsconfig.json";

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
 * @param header - The ownership banner to seed the workflow with
 * @param name - Workflow filename
 * @returns The temp directory acting as the consumer root
 */
async function consumerWith(header: string, name = "ci.yml"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "t3582-"));
  roots.push(root);
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, TSCONFIG), "{}");
  await writeFile(
    path.join(root, ".github", "workflows", name),
    `${header}\n\nname: CI\non: push\n`,
    "utf8"
  );
  return root;
}

describe("a seeded caller still wearing the managed banner is reported", () => {
  it.each([
    ["typescript", TSCONFIG],
    ["cdk", "cdk.json"],
    ["expo", "app.json"],
    ["nestjs", "nest-cli.json"],
    ["rails", "config/application.rb"],
  ])("warns for the stale create-only %s workflow", async (_stack, marker) => {
    const root = await consumerWith(MANAGED);
    await mkdir(path.dirname(path.join(root, marker)), { recursive: true });
    await writeFile(path.join(root, marker), "{}");
    const result = await checkOwnershipBannerDrift(root);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("create-only");
  });

  it("names the file without rewriting the consumer's workflow", async () => {
    const root = await consumerWith(MANAGED);
    const workflow = path.join(root, ".github", "workflows", "ci.yml");
    const original = await readFile(workflow, "utf8");
    const result = await checkOwnershipBannerDrift(root);

    expect(result.detail).toContain("ci.yml");
    expect(await readFile(workflow, "utf8")).toBe(original);
  });

  it("explains current ownership without promising every future upgrade", async () => {
    // The measured harm was a reader declining an edit they were entitled to
    // make. A finding that only says "drift" leaves that belief in place.
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.detail).toContain("create-only");
    expect(result.detail).not.toContain("survive every upgrade");
  });

  it("does not tell the operator to run an apply to fix it", async () => {
    // An apply cannot fix it: the file is create-only, so apply skips it
    // entirely. Advice that cannot be followed is the defect one square over.
    const result = await checkOwnershipBannerDrift(await consumerWith(MANAGED));

    expect(result.detail).not.toContain("lisa apply");
  });
});

describe("the detected template lane governs the warning", () => {
  it("does not flag the managed Phaser workflow", async () => {
    const root = await consumerWith(MANAGED);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { phaser: "1" } })
    );
    const result = await checkOwnershipBannerDrift(root);
    expect(result.status).toBe("ok");
    expect(result.detail).not.toContain(UNSAFE_REASSURANCE);
  });

  it("does not flag the managed Harper workflow", async () => {
    const root = await consumerWith(MANAGED);
    await mkdir(path.join(root, HARPER_APP));
    await writeFile(
      path.join(root, HARPER_APP, "config.yaml"),
      "graphqlSchema: schema.graphql\njsResource: resources.js\nstatic: web\n"
    );
    await writeFile(
      path.join(root, HARPER_APP, "schema.graphql"),
      "type Query { hello: String }"
    );
    const result = await checkOwnershipBannerDrift(root);
    expect(result.status).toBe("ok");
    expect(result.detail).not.toContain(UNSAFE_REASSURANCE);
  });

  it("does not declare ownership when no stack is detected", async () => {
    const root = await consumerWith(MANAGED);
    await rm(path.join(root, TSCONFIG));
    const result = await checkOwnershipBannerDrift(root);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("could not determine");
    expect(result.detail).not.toContain(UNSAFE_REASSURANCE);
    expect(result.detail).not.toContain("banner is stale");
  });

  it("does not call an unshipped workflow create-only", async () => {
    const result = await checkOwnershipBannerDrift(
      await consumerWith(MANAGED, "custom.yml")
    );
    expect(result.detail).toContain("could not determine");
    expect(result.detail).not.toContain(UNSAFE_REASSURANCE);
  });
});

describe("rejection controls: what must NOT be reported", () => {
  it("passes a create-only workflow carrying the correct banner", async () => {
    // Without this the check could warn on everything and satisfy every
    // assertion above.
    //
    // The inverse mismatch (a managed template wearing a seeded banner)
    // remains outside this check's scope; it only classifies managed claims.
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
