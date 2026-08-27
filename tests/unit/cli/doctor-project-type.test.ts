import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProjectType } from "../../../src/cli/doctor-project-type.js";

const LISA_CONFIG = ".lisa.config.json";
const PROJECT_TYPE_CHECK = "Project type detection";
let testRoot: string | undefined;

/**
 * Create one isolated project with the supplied Lisa config.
 * @param config - Lisa config fixture
 * @returns Temporary project root
 */
async function makeProject(config: unknown): Promise<string> {
  testRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-project-type-"));
  await writeFile(
    path.join(testRoot, LISA_CONFIG),
    `${JSON.stringify(config)}\n`
  );
  return testRoot;
}

afterEach(async () => {
  if (testRoot !== undefined) {
    await rm(testRoot, { force: true, recursive: true });
    testRoot = undefined;
  }
});

describe("checkProjectType", () => {
  it("recognizes a configured local wiki", async () => {
    const project = await makeProject({ wiki: { source: { path: "wiki" } } });

    await expect(checkProjectType(project)).resolves.toEqual({
      name: PROJECT_TYPE_CHECK,
      status: "ok",
      detail: "wiki (local source)",
    });
  });

  it("recognizes a configured remote wiki", async () => {
    const project = await makeProject({
      wiki: { source: { url: "git@github.com:example/wiki.git" } },
    });

    await expect(checkProjectType(project)).resolves.toEqual({
      name: PROJECT_TYPE_CHECK,
      status: "ok",
      detail: "wiki (remote source)",
    });
  });

  it("keeps warning when the wiki source is empty", async () => {
    const project = await makeProject({ wiki: { source: { path: " " } } });

    await expect(checkProjectType(project)).resolves.toEqual({
      name: PROJECT_TYPE_CHECK,
      status: "warn",
      detail: "No Lisa project type detected",
    });
  });
});
