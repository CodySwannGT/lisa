import { describe, expect, it, vi } from "vitest";
import { runSetupWiki } from "../../../src/cli/setup-wiki.js";

describe("runSetupWiki", () => {
  it("applies Lisa to the current directory when no path is supplied", async () => {
    const runApply = vi.fn(async () => undefined);

    await runSetupWiki(undefined, { yes: true }, { runApply });

    expect(runApply).toHaveBeenCalledWith(
      ".",
      expect.objectContaining({ yes: true })
    );
  });

  it("applies Lisa to the requested project path", async () => {
    const runApply = vi.fn(async () => undefined);

    await runSetupWiki("my-app", { dryRun: true }, { runApply });

    expect(runApply).toHaveBeenCalledWith(
      "my-app",
      expect.objectContaining({ dryRun: true })
    );
  });
});
