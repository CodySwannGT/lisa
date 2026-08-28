/** RED parity contract for an omitted nightly tracking destination. */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateNightlyE2EConfig } from "../../../src/core/project-config-nightly-e2e.js";
import { validateProjectConfig } from "../../../src/core/project-config.js";
import { loadTrackingModule } from "../../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const CONFIG_PATH = "/project/.lisa.config.json";
const OMITTED = Object.freeze({ nightlyE2E: { tracking: {} } });
const EXPECTED = Object.freeze({
  nightlyE2E: { tracking: { destination: "none" } },
});

describe("omitted nightly tracking destination", () => {
  it("defaults to none in core and installed validators", async () => {
    expect(validateNightlyE2EConfig(OMITTED.nightlyE2E, CONFIG_PATH)).toEqual(
      EXPECTED.nightlyE2E
    );
    expect(validateProjectConfig(OMITTED, CONFIG_PATH)).toEqual(EXPECTED);

    const installed = await loadTrackingModule(REPO_ROOT);
    expect(installed.resolveNightlyTrackingConfig(OMITTED)).toEqual({
      destination: "none",
      provider: null,
    });
  });
});
