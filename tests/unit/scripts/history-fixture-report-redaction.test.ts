/** Native JSON failures must not carry matched material into outward fixture errors. */
import { describe, expect, it } from "vitest";
import { nativeScannerReport } from "../../fixtures/git-history-secrets/package.mjs";

describe("native scanner fixture report boundary", () => {
  it("preserves the complete successful report", () => {
    const report = { version: "8.30.1", commits: 2, findings: [] };
    expect(nativeScannerReport(JSON.stringify(report))).toEqual(report);
  });

  it("withholds malformed output from the error and its cause", () => {
    const privateValue = "synthetic-private-scanner-material";
    const invocation = () => nativeScannerReport(`not-json ${privateValue}`);
    expect(invocation).toThrow(
      "Native scanner report malformed; raw proof withheld."
    );
    try {
      invocation();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(privateValue);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
