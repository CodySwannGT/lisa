/**
 * Regression for CodySwannGT/lisa#4564 finding 1.
 *
 * `hookEntry` recognises the managed Rails pre-push hook by an EXACT match of
 * its `node -e` payload. The payload lives in rails/copy-overwrite/lefthook.yml;
 * when that command gained the `const rc = …` refusal diagnostic, the copy in
 * npm-update-hosted-hook.mjs was not updated and the managed Rails hook stopped
 * being recognised. This test reads the shipped lefthook file, so the two can
 * no longer drift silently.
 * @module tests/unit/scripts/npm-update-hosted-hook-rails-inline
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { hookEntry } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs";

const LEFTHOOK = resolve("rails/copy-overwrite/lefthook.yml");
const MODULE_FLAG = "--input-type=module";
const INLINE_RUN = /^node --input-type=module -e '([^']*)' \{1\}$/;
const CWD = "/host/repo";
const ENTRY = join(CWD, "scripts/lisa-rails-prepush.mjs");

/**
 * Reads the `-e` payload of the shipped Rails `rails-prepush` lefthook command.
 * @returns The inline module source exactly as lefthook passes it to node.
 */
function shippedRailsInline(): string {
  const config = parse(readFileSync(LEFTHOOK, "utf8")) as {
    "pre-push": { commands: { "rails-prepush": { run: string } } };
  };
  const run = config["pre-push"].commands["rails-prepush"].run;
  const match = INLINE_RUN.exec(run);
  if (!match) throw new Error(`unexpected rails-prepush command shape: ${run}`);
  return match[1];
}

describe("hookEntry recognises the shipped Rails pre-push hook (#4564)", () => {
  const context = { graph: { [ENTRY]: "sha256-fixture" } };

  it("maps the exact lefthook.yml payload to the managed prepush entry", () => {
    const args = [MODULE_FLAG, "-e", shippedRailsInline(), "origin"];
    expect(hookEntry(context, args, CWD)).toBe(ENTRY);
  });

  it("refuses the superseded payload that predates the refusal diagnostic", () => {
    const stale =
      'try { const { main } = await import("./scripts/lisa-rails-prepush.mjs"); process.exitCode = await main(process.argv.slice(1)); } catch { console.error("Managed Rails push tooling is unavailable or damaged. Run full Lisa apply and retry; raw bootstrap errors are withheld."); process.exitCode = 1; }';
    expect(hookEntry(context, [MODULE_FLAG, "-e", stale], CWD)).toBeNull();
  });

  it("refuses the shipped payload when the prepush entry is outside the graph", () => {
    const args = [MODULE_FLAG, "-e", shippedRailsInline()];
    expect(hookEntry({ graph: {} }, args, CWD)).toBeNull();
  });
});
