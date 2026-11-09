/**
 * Who the CI-failure scripts trust beyond the workflow's own identity.
 *
 * A later non-failure Lisa marker supersedes an uncleared `[lisa-ci-failed]`
 * marker only from a trusted author (CodySwannGT/lisa#4707); the configured
 * part of that set is `sessionManager.trustedAuthorIds`. A missing or broken
 * config must fail safe — trusting nobody extra — rather than crash a run.
 * @module tests/unit/scripts/lisa-ci-marker-trust-config
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  readTrustedAuthorIds,
  withTrustedAuthors,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

describe("readTrustedAuthorIds", () => {
  /**
   * A temporary project root holding the given config files.
   * @param files - File name to contents.
   * @returns The root.
   */
  function root(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "lisa-ci-trust-"));
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(dir, name), text);
    return dir;
  }

  it("reads sessionManager.trustedAuthorIds", () => {
    const config = {
      sessionManager: { trustedAuthorIds: ["login:a", "id:1"] },
    };
    expect(
      readTrustedAuthorIds(
        root({ ".lisa.config.json": JSON.stringify(config) })
      )
    ).toEqual(["login:a", "id:1"]);
  });

  // The producer runs in CI on a fresh checkout, where no local override
  // exists, so the helper must not read one either or the two paths would
  // trust different people (#4707 review).
  it("ignores .lisa.config.local.json so the producer and helper trust the same list", () => {
    const shared = { sessionManager: { trustedAuthorIds: ["login:a"] } };
    const local = { sessionManager: { trustedAuthorIds: ["login:b"] } };
    expect(
      readTrustedAuthorIds(
        root({
          ".lisa.config.json": JSON.stringify(shared),
          ".lisa.config.local.json": JSON.stringify(local),
        })
      )
    ).toEqual(["login:a"]);
    expect(
      readTrustedAuthorIds(
        root({ ".lisa.config.local.json": JSON.stringify(local) })
      )
    ).toEqual([]);
  });

  it.each([
    ["missing config", {}],
    ["malformed JSON", { ".lisa.config.json": "{not json" }],
    ["no sessionManager block", { ".lisa.config.json": "{}" }],
    [
      "a non-array list",
      {
        ".lisa.config.json": JSON.stringify({
          sessionManager: { trustedAuthorIds: "login:a" },
        }),
      },
    ],
  ])("fails safe to no configured authors on %s", (_case, files) => {
    expect(readTrustedAuthorIds(root(files))).toEqual([]);
  });
});

describe("withTrustedAuthors", () => {
  it("keeps a contract that already carries trustedAuthorIds", () => {
    const contract = { provider: "github", trustedAuthorIds: ["login:a"] };
    expect(withTrustedAuthors(contract)).toBe(contract);
  });

  it("attaches the configured list otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "lisa-ci-trust-"));
    const config = { sessionManager: { trustedAuthorIds: ["id:9"] } };
    writeFileSync(join(dir, ".lisa.config.json"), JSON.stringify(config));
    expect(withTrustedAuthors({ provider: "github" }, dir)).toEqual({
      provider: "github",
      trustedAuthorIds: ["id:9"],
    });
  });
});
