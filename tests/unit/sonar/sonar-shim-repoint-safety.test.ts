/**
 * Write-safety and recognition-precision cases for the Sonar shim repoint.
 *
 * CodySwannGT/lisa#4502, from the PR's CodeRabbit review: a comment naming
 * the wrapper must not count as repointed, an early `exit 0` before the hook
 * must not be re-enabled, a symlinked ancestor must not route the write out of
 * the project, a failed write must not truncate the shim, and apply's backup
 * hook must run before each replacement.
 * @module tests/unit/sonar/sonar-shim-repoint-safety
 */
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { replaceFileAtomically } from "../../../src/sonar/sonar-shim-fs.js";
import {
  parseVendorShimEvent,
  repointSonarShims,
} from "../../../src/sonar/sonar-shim-repoint.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  CLAUDE_PROMPT,
  CLAUDE_PROMPT_EXEC,
  checkout,
  GUARD_IF,
  PROMPT_EVENT,
  SHEBANG,
  scratchDir,
  vendorShim,
  writeShim,
} from "./support/sonar-shim-fixtures.js";

useIoLatencyBudget();

const PROMPT_BASENAME = path.basename(CLAUDE_PROMPT);

describe("repointSonarShims write safety", () => {
  it("still repoints a vendor shim whose comment names the wrapper", async () => {
    const root = await checkout();
    const body = vendorShim(PROMPT_EVENT).replace(
      `${SHEBANG}\n`,
      `${SHEBANG}\n# TODO: point at scripts/lisa-hooks/sonar-secrets.sh\n`
    );
    const shim = await writeShim(root, CLAUDE_PROMPT, body);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([CLAUDE_PROMPT]);
    expect(await readFile(shim, "utf8")).toContain(CLAUDE_PROMPT_EXEC);
  });

  it("reports a shim whose hook is disabled by an early exit", async () => {
    const root = await checkout();
    const body = [
      SHEBANG,
      "exit 0",
      GUARD_IF,
      "  exit 0",
      "fi",
      `sonar hook ${PROMPT_EVENT}`,
      "",
    ].join("\n");
    const shim = await writeShim(root, CLAUDE_PROMPT, body);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([]);
    expect(result.unrecognized).toEqual([CLAUDE_PROMPT]);
    expect(await readFile(shim, "utf8")).toBe(body);
  });

  it("refuses a shim reached through a symlinked folder outside the project", async () => {
    const root = await checkout();
    const outside = await scratchDir("lisa-sonar-out-");
    const body = vendorShim(PROMPT_EVENT);
    const target = path.join(outside, "sonar-secrets/build-scripts");
    const outsideShim = path.join(target, PROMPT_BASENAME);
    await mkdir(target, { recursive: true });
    await writeFile(outsideShim, body);
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await symlink(outside, path.join(root, ".claude/hooks"));

    const result = await repointSonarShims(root);

    expect(result.failed).toEqual([CLAUDE_PROMPT]);
    expect(result.repointed).toEqual([]);
    expect(await readFile(outsideShim, "utf8")).toBe(body);
  });

  it("replaces the shim without leaving a temporary file behind", async () => {
    const root = await checkout();
    const shim = await writeShim(root, CLAUDE_PROMPT, vendorShim(PROMPT_EVENT));

    await repointSonarShims(root);

    expect(await readdir(path.dirname(shim))).toEqual([PROMPT_BASENAME]);
  });

  it("passes each shim to the pre-write hook and fails it when that rejects", async () => {
    const root = await checkout();
    const body = vendorShim(PROMPT_EVENT);
    const shim = await writeShim(root, CLAUDE_PROMPT, body);
    const seen: string[] = [];

    const result = await repointSonarShims(root, {
      beforeWrite: async absolute => {
        seen.push(absolute);
        throw new Error("backup unavailable");
      },
    });

    expect(seen).toEqual([shim]);
    expect(result.failed).toEqual([CLAUDE_PROMPT]);
    expect(await readFile(shim, "utf8")).toBe(body);
  });
});

describe("parseVendorShimEvent line order", () => {
  it("rejects a body whose guard lines are out of order", () => {
    const body = [
      SHEBANG,
      "fi",
      "exit 0",
      GUARD_IF,
      `sonar hook ${PROMPT_EVENT}`,
      "",
    ].join("\n");

    expect(parseVendorShimEvent(body)).toBeUndefined();
  });
});

describe("replaceFileAtomically", () => {
  it("removes its temporary file when the final rename fails", async () => {
    const root = await checkout(false);
    const occupied = path.join(root, "occupied");
    await mkdir(occupied);
    await writeFile(path.join(occupied, "child"), "x");

    await expect(
      replaceFileAtomically(occupied, "new body", 0o755)
    ).rejects.toThrow();

    expect(await readdir(root)).toEqual(["occupied"]);
  });
});
