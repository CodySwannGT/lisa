import { describe, expect, it, vi } from "vitest";
import { runVersion } from "../../../src/cli/version-cmd.js";

describe("runVersion", () => {
  it("prints local version, latest version, install path, and default harness", async () => {
    const write = vi.fn();

    await runVersion({
      getPackageVersion: () => "2.63.2",
      runUpdateCheck: vi.fn(async () => ({
        current: "2.63.2",
        latest: "2.64.0",
        isOutdated: true,
      })),
      write,
    });

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("local: 2.63.2")
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("latest: 2.64.0")
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("installPath: ")
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("defaultHarness: claude")
    );
  });
});
