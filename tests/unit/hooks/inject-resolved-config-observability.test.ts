/**
 * The resolved-config block renders the `observability` subtree.
 *
 * Stack guidance (the Expo ops skills) chooses between the Sentry path,
 * generic discovery, and "no tracker configured" from
 * `observability.errorTracking.provider` (CodySwannGT/lisa#4912). The agent
 * has to see that value without opening the config file, so the subtree must
 * render rather than fall into "other declared keys (not summarised here)".
 * @module tests/unit/hooks/inject-resolved-config-observability
 */
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

describe("inject-resolved-config: observability providers", () => {
  it("renders the declared providers", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      observability: {
        errorTracking: { provider: "none" },
        analytics: { provider: "other" },
      },
    });

    const context = contextFor(root);

    expect(context).toContain("observability.errorTracking: provider=none");
    expect(context).toContain("observability.analytics: provider=other");
    expect(context).not.toContain(
      "other declared keys (not summarised here): observability"
    );
  });
});
