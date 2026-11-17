/**
 * The release raises Lisa's own self-pin, so no person has to
 * (CodySwannGT/lisa#4951).
 *
 * 6.0.0 left `^5.0.1` unable to resolve the newest release, and the required
 * self-pin check then failed every open pull request until somebody raised the
 * floor by hand. These cases drive the real script the release runs and pin the
 * three properties that make it safe to run unattended:
 *
 * 1. **It raises exactly when the check would fail** — the same `compareSpec`
 *    predicate — so the red check and its fix can never disagree.
 * 2. **It does nothing for a release the pin already admits**, which is what
 *    stops the raise commit's own patch release from triggering another raise.
 * 3. **It changes one value**, keeping key order and the repository's JSON
 *    format, so the pushed commit is a one-line manifest diff.
 * @module tests/unit/scripts/raise-self-dependency-pin
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  main as checkMain,
  SELF_PACKAGE,
} from "../../../scripts/check-self-dependency-pin.mjs";
import {
  main,
  raiseSelfPin,
} from "../../../scripts/raise-self-dependency-pin.mjs";

/** The floor 6.0.0 left behind. */
const STALE_FLOOR = "^5.0.1";

/** The release that left it behind. */
const MAJOR_RELEASE = "6.0.0";

/** The pin the raise writes for that release. */
const RAISED = "^6.0.0";

/** The CLI option naming the manifest to rewrite. */
const MANIFEST_FLAG = "--manifest";

/** A manifest shaped like the repository's: the pin among other devDependencies. */
const MANIFEST = {
  name: SELF_PACKAGE,
  version: MAJOR_RELEASE,
  devDependencies: {
    "prettier-compat-3-9": "npm:prettier@3.9.10",
    [SELF_PACKAGE]: STALE_FLOOR,
    zod: "^4.6.7",
  },
};

/**
 * Write a manifest to a fresh temp directory.
 * @param manifest - The manifest to write.
 * @returns The manifest's path.
 */
function writeManifest(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "raise-self-pin-"));
  const file = path.join(dir, "package.json");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

/**
 * Run the CLI entry point and capture stdout.
 * @param argv - Arguments after the script path.
 * @returns The exit code and captured output.
 */
function run(argv: string[]): { code: number; stdout: string } {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const code = main(argv);
  const text = stdout.mock.calls.map(call => String(call[0])).join("");
  stdout.mockRestore();
  stderr.mockRestore();
  return { code, stdout: text };
}

describe("the release raises a self-pin it left behind (#4951)", () => {
  it("raises ^5.0.1 to ^6.0.0 when 6.0.0 is published", () => {
    const outcome = raiseSelfPin(MANIFEST, MAJOR_RELEASE);

    expect(outcome.verdict).toBe("raised");
    expect(outcome.manifest).toEqual({
      ...MANIFEST,
      devDependencies: {
        ...MANIFEST.devDependencies,
        [SELF_PACKAGE]: RAISED,
      },
    });
  });

  it("leaves a pin that already admits the release untouched", () => {
    const current = {
      ...MANIFEST,
      devDependencies: {
        ...MANIFEST.devDependencies,
        [SELF_PACKAGE]: RAISED,
      },
    };

    const outcome = raiseSelfPin(current, "6.0.1");

    expect(outcome.verdict).toBe("current");
    expect(outcome.manifest).toBe(current);
  });

  it("does not touch a pin that names a location rather than a release", () => {
    const linked = {
      ...MANIFEST,
      devDependencies: { [SELF_PACKAGE]: "link:../lisa" },
    };

    expect(raiseSelfPin(linked, MAJOR_RELEASE).verdict).toBe("local-checkout");
  });

  it("reports a manifest with no self-pin instead of inventing one", () => {
    const outcome = raiseSelfPin({ name: SELF_PACKAGE }, MAJOR_RELEASE);

    expect(outcome.verdict).toBe("no-pin");
    expect(outcome.manifest).toEqual({ name: SELF_PACKAGE });
  });

  it("refuses a prerelease or malformed version rather than pinning to it", () => {
    expect(() => raiseSelfPin(MANIFEST, "6.1.0-staging.1")).toThrow(
      /not a published release version/
    );
    expect(() => raiseSelfPin(MANIFEST, "latest")).toThrow(
      /not a published release version/
    );
  });

  it("rewrites only the pin line, keeping key order and format", () => {
    const file = writeManifest(MANIFEST);
    const before = readFileSync(file, "utf8");

    const result = run(["--version", MAJOR_RELEASE, MANIFEST_FLAG, file]);
    const after = readFileSync(file, "utf8");

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^raise-self-dependency-pin: raised /);
    expect(after).toBe(before.replace(`"${STALE_FLOOR}"`, `"${RAISED}"`));
  });

  it("writes nothing for a release the pin admits", () => {
    const file = writeManifest({
      ...MANIFEST,
      devDependencies: { [SELF_PACKAGE]: RAISED },
    });
    const before = readFileSync(file, "utf8");

    const result = run(["--version", "6.0.1", MANIFEST_FLAG, file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^raise-self-dependency-pin: current /);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("fails on a spec it cannot reason about, as the check does", () => {
    const file = writeManifest({
      devDependencies: { [SELF_PACKAGE]: "not a range" },
    });

    const result = run(["--version", MAJOR_RELEASE, MANIFEST_FLAG, file]);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^raise-self-dependency-pin: unprovable /);
  });

  it("requires the published version", () => {
    expect(run([]).code).toBe(1);
  });

  it("leaves the check green after a raise, so the two can never disagree", async () => {
    const file = writeManifest(MANIFEST);
    run(["--version", MAJOR_RELEASE, MANIFEST_FLAG, file]);
    const packument = { versions: { [MAJOR_RELEASE]: {} } };
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith(`/${MAJOR_RELEASE}`)
          ? { version: MAJOR_RELEASE }
          : packument,
    }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const code = await checkMain(
      ["--registry", "https://registry.example.test", MANIFEST_FLAG, file],
      { fetchImpl, sleep: async () => undefined }
    );
    stdout.mockRestore();

    expect(code).toBe(0);
  });
});
