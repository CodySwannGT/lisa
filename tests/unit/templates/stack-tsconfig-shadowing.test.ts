import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Child stacks that extend the typescript base and detect alongside it. */
const CHILD_STACKS = ["expo", "cdk", "nestjs", "phaser", "harper-fabric"];

/**
 * Read one stack's copy-overwrite tsconfig.json template.
 * @param stack - Stack template directory name.
 * @returns Parsed tsconfig template.
 */
function readStackTsconfig(stack: string): {
  extends: string[];
  compilerOptions?: Record<string, unknown>;
} {
  return fs.readJsonSync(
    path.join(ROOT, stack, "copy-overwrite", "tsconfig.json")
  );
}

describe("stack tsconfig.json copy-overwrite shadowing", () => {
  // Regression: copy-overwrite resolves same-path collisions child-over-
  // parent via per-type ordering, so every child stack MUST ship its own
  // copy-overwrite tsconfig.json. Expo didn't — the typescript parent's
  // template ran unopposed and stamped `extends .../typescript` over expo
  // projects on every apply/postinstall, dropping jsx and failing typecheck
  // (hit TunnlAI/frontend and expostarter).
  it.each(CHILD_STACKS)(
    "%s ships a copy-overwrite tsconfig extending its own base",
    stack => {
      const template = readStackTsconfig(stack);
      expect(template.extends[0]).toBe(`@codyswann/lisa/tsconfig/${stack}`);
    }
  );

  // TypeScript 7 (native preview) removed baseUrl entirely (TS5102); it has
  // been the effective default since TS 4.1. No template may reintroduce it.
  it.each([...CHILD_STACKS, "typescript"])(
    "%s copy-overwrite tsconfig carries no baseUrl",
    stack => {
      const template = readStackTsconfig(stack);
      expect(template.compilerOptions?.["baseUrl"]).toBeUndefined();
    }
  );
});
