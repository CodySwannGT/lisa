/** Real token-free Node consumption checks finite browser env; synthetic tool bytes are not vendor qualification. */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { railsBrowserEnvironment } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-downloads.mjs";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

describe("finite native browser environment", () => {
  it("supplies CHROME_BIN consumers with the same actual selected bytes as CHROME_BINARY", async () => {
    const owned = createSupervisedUnixFixture(
      "hook-reader.sock",
      process.env[SCRATCH_SUPERVISION_LEASE_ENV]
    );
    const chrome = join(owned.root, "chrome");
    try {
      writeFileSync(chrome, "synthetic-owned-browser", {
        flag: "wx",
        mode: 0o700,
      });
      const env = railsBrowserEnvironment(
        chrome,
        join(owned.root, "driver"),
        join(owned.root, "sandbox")
      );
      const result = await runProcess(
        process.execPath,
        [
          "-e",
          'if (!process.env.CHROME_BIN) process.exit(17); if (process.env.CHROME_BIN !== process.env.CHROME_BINARY) process.exit(18); process.stdout.write(require("node:fs").readFileSync(process.env.CHROME_BIN));',
        ],
        {
          cwd: owned.root,
          env,
          timeout: 2000,
          maximum: 4096,
        }
      );
      expect(result.stdout.toString()).toBe("synthetic-owned-browser");
      expect(
        Object.keys(env).sort((left, right) => left.localeCompare(right))
      ).toEqual(
        [
          "CHROMEDRIVER",
          "CHROME_BINARY",
          "CHROME_BIN",
          "CHROME_DEVEL_SANDBOX",
        ].sort((left, right) => left.localeCompare(right))
      );
    } finally {
      owned.close();
    }
  });
});
