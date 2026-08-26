/** Public package surface for the executable v2 learnings proof. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as learnings from "../../../src/core/learnings.js";

const VERIFY_COMMAND =
  "bun run build:dist && node scripts/verify-packed-learnings-contract.mjs";

describe("packed learnings contract", () => {
  it("exports every operation exercised by the tarball consumer", () => {
    expect(learnings.parseLearningsDocument).toBeTypeOf("function");
    expect(learnings.persistConsolidatedLearning).toBeTypeOf("function");
    expect(learnings.mergeLearningsDocuments).toBeTypeOf("function");
    expect(learnings.projectLearnings).toBeTypeOf("function");
  });

  it("keeps the source package and forced template on the same proof command", async () => {
    const source = JSON.parse(await readFile("package.json", "utf8"));
    const template = JSON.parse(await readFile("package.lisa.json", "utf8"));
    expect(source.scripts["verify:packed-learnings-contract"]).toBe(
      VERIFY_COMMAND
    );
    expect(template.force.scripts["verify:packed-learnings-contract"]).toBe(
      VERIFY_COMMAND
    );
  });

  it("packs and imports the public subpath in the empirical verifier", async () => {
    const proof = await readFile(
      "scripts/verify-packed-learnings-contract.mjs",
      "utf8"
    );
    expect(proof).toContain('"pm", "pack"');
    expect(proof).toContain('"dist", "core", "learnings.js"');
    expect(proof).toContain("afterRace.length, 9");
    expect(proof).toContain("duplicate learning fingerprint");
    expect(proof).toContain("id exceeds max stable token bytes 128");
    expect(proof).toContain("sameIdFork.fingerprint");
    expect(proof).toContain("mergeLearningsDocuments");
  });
});
