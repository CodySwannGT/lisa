import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
} from "../../../src/core/project-config.js";

describe("project Kane config", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-kane-config-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  /**
   * Write a provider block into the project config fixture.
   * @param kane - Provider block to serialize
   */
  async function writeKaneConfig(kane: unknown): Promise<void> {
    await writeFile(
      path.join(projectRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ verification: { browser: { kane } } }),
      "utf8"
    );
  }

  it("parses a valid empirical-browser configuration", async () => {
    await writeKaneConfig({
      enabled: true,
      version: "0.6.3",
      cloudUploadApproved: true,
      allowedEnvironments: ["staging", "preview"],
      projectId: "project-123",
      folderId: "folder-456",
      timeoutSeconds: 120,
    });

    await expect(readProjectConfig(projectRoot)).resolves.toMatchObject({
      verification: {
        browser: {
          kane: {
            enabled: true,
            version: "0.6.3",
            allowedEnvironments: ["staging", "preview"],
            projectId: "project-123",
          },
        },
      },
    });
  });

  it.each([
    [{ allowedEnvironments: ["production"] }, /production is never permitted/],
    [{ allowedEnvironments: ["staging", "staging"] }, /duplicate values/],
    [{ allowedEnvironments: [] }, /non-empty string array/],
    [{ version: "latest" }, /exact semantic version/],
    [{ timeoutSeconds: 0 }, /integer from 1 to 600/],
    [{ cloudUploadApproved: "yes" }, /expected a boolean/],
  ])("rejects invalid provider config %#", async (kane, message) => {
    await writeKaneConfig(kane);
    await expect(readProjectConfig(projectRoot)).rejects.toThrow(message);
  });
});
