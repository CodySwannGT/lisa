/**
 * Expo's shipped `jest.config.ts` loads through Node's own TypeScript support,
 * so it needs no loader package a host's dead-code gate cannot see
 * (CodySwannGT/lisa#4932).
 *
 * The template used to open with `@jest-config-loader esbuild-register`, chosen
 * when ts-node 10 could not read an array `extends`. Jest 30 tries Node's
 * native TypeScript support first and reaches a docblock loader only after a
 * syntax error, and every Node Lisa ships for a host strips types natively. The
 * pragma was a fallback nothing reached, and the dependency behind it was
 * invisible to knip: nothing imports a loader Jest names in a comment. Measured
 * on a greenfield Expo host: with `esbuild-register` removed from
 * `node_modules`, `jest --showConfig` still loads the shipped config.
 *
 * This suite holds both halves of that: the template names no loader, and the
 * Node version Lisa ships for hosts is one that strips types by default.
 * @module tests/unit/config/expo-jest-config-loader
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { gte, minVersion } from "semver";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** First Node 22 release that strips TypeScript types without a flag. */
const NATIVE_TYPESCRIPT_NODE = "22.18.0";

/**
 * Read a repository file.
 * @param relative - Path from the repository root
 * @returns Its contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("Expo's shipped Jest config needs no loader package", () => {
  it("names no docblock loader", () => {
    const source = read("expo/copy-overwrite/jest.config.ts");
    expect(source).not.toMatch(/@jest-config-loader\b/u);
  });

  it("ships hosts a Node that loads TypeScript natively", () => {
    const template = JSON.parse(
      read("typescript/package-lisa/package.lisa.json")
    ) as { defaults?: { engines?: { node?: string } } };
    const node = template.defaults?.engines?.node ?? "";
    const lowest = minVersion(node);
    expect(lowest, `engines.node ${node}`).not.toBeNull();
    expect(gte(lowest!, NATIVE_TYPESCRIPT_NODE), `engines.node ${node}`).toBe(
      true
    );
  });
});
