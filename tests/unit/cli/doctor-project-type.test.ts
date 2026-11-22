import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProjectType } from "../../../src/cli/doctor-project-type.js";

const PROJECT_TYPE_CHECK = "Project type detection";
let testRoot: string | undefined;

/**
 * Create one isolated project, optionally owning a wiki.
 * @param withWiki - Whether the project carries wiki/lisa-wiki.config.json
 * @returns Temporary project root
 */
async function makeProject(withWiki: boolean): Promise<string> {
  testRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-project-type-"));
  if (withWiki) {
    await mkdir(path.join(testRoot, "wiki"));
    await writeFile(
      path.join(testRoot, "wiki", "lisa-wiki.config.json"),
      "{}\n"
    );
  }
  return testRoot;
}

afterEach(async () => {
  if (testRoot !== undefined) {
    await rm(testRoot, { force: true, recursive: true });
    testRoot = undefined;
  }
});

describe("checkProjectType", () => {
  it("recognizes a wiki-only repository", async () => {
    await expect(checkProjectType(await makeProject(true))).resolves.toEqual({
      name: PROJECT_TYPE_CHECK,
      status: "ok",
      detail: "wiki (no software stack)",
    });
  });

  it("warns when there is neither a stack nor a wiki", async () => {
    await expect(checkProjectType(await makeProject(false))).resolves.toEqual({
      name: PROJECT_TYPE_CHECK,
      status: "warn",
      detail: "No Lisa project type detected",
    });
  });
});
