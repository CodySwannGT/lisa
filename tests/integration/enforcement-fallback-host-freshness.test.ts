/**
 * Regression at the reported CLI boundary: real Bash, real guards, actual
 * current template bytes and historical receipt. The proposed command is
 * supplied to enforcement as data and is never executed.
 * @module tests/integration/enforcement-fallback-host-freshness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  scratchTmpdir,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  hostState,
  SELECTED_GUARDS,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

describe("install-only upgrade host guard freshness", () => {
  it("keeps the real refusal without false STALE or apply repair for current bytes and an old receipt", () => {
    const root = currentHost();
    const before = hostState(root);
    for (const guard of SELECTED_GUARDS) {
      expect(
        readFileSync(path.join(root, "scripts/lisa-hooks", `${guard}.sh`))
      ).toEqual(readFileSync(template(root, guard)));
    }
    const result = driveFreshness(root);
    expect(result.status).toBe(2);
    expect(result.output).toContain("Refused by");
    expect(result.output).toContain("block-no-verify.sh");
    expect(result.output).not.toContain("STALE");
    expect(result.output).not.toContain("npx @codyswann/lisa apply");
    expect(result.output).toContain("matches installed template");
    expect(result.output).toContain("installed lisa 4.72.7");
    expect(result.output).toContain("last applied lisa 4.33.1");
    expect(hostState(root)).toEqual(before);
  });

  it("attributes the same real refusal accurately after the session notice has been suppressed", () => {
    const root = currentHost();
    const tmp = scratchTmpdir();
    const first = driveFreshness(root, undefined, {
      tmp,
      session: "freshness-regression",
    });
    const second = driveFreshness(root, undefined, {
      tmp,
      session: "freshness-regression",
    });
    expect(first.status).toBe(2);
    expect(second.status).toBe(2);
    expect(first.output).toContain("Lisa enforcement is running");
    expect(second.output).not.toContain("Lisa enforcement is running");
    expect(second.output).toContain("matches installed template");
    expect(second.output).not.toContain("STALE");
    expect(second.output).not.toContain("npx @codyswann/lisa apply");
  });
});
