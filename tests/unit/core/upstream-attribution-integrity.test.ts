/** Prove packaged excerpt bytes must match the generated hash manifest. */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const SURFACE = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";
const BODY_MODULE_PATH = "src/core/upstream-attribution-body.ts";
const PUBLIC_SHA = "90549e6dae19aa5e53b86908d5050d303b724f55";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("upstream attribution evidence integrity", () => {
  it("fails closed when a manifest-listed file no longer matches its hash", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-upstream-integrity-"));
    temporaryDirectories.push(root);
    mkdirSync(path.join(root, "src/core"), { recursive: true });
    mkdirSync(path.join(root, path.dirname(SURFACE)), { recursive: true });
    copyFileSync("package.json", path.join(root, "package.json"));
    copyFileSync(BODY_MODULE_PATH, path.join(root, BODY_MODULE_PATH));
    copyFileSync(
      "src/core/upstream-evidence-manifest.ts",
      path.join(root, "src/core/upstream-evidence-manifest.ts")
    );
    const original = readFileSync(SURFACE, "utf8");
    writeFileSync(path.join(root, SURFACE), `${original}\nTAMPERED\n`, "utf8");
    const moduleUrl = `${
      pathToFileURL(path.join(root, BODY_MODULE_PATH)).href
    }?integrity=${Date.now()}`;
    const imported = (await import(moduleUrl)) as {
      readonly buildUpstreamAttributionIssueBody: (input: unknown) => string;
    };

    expect(() =>
      imported.buildUpstreamAttributionIssueBody({
        documentKind: "issue",
        failureClass: "data-integrity-failure",
        lisaOwnedExcerpts: [{ file: SURFACE, text: "Route ONE candidate" }],
        lisaSurface: SURFACE,
        redactedPlaceholders: ["<host-project>"],
        upstreamCommitRefs: [PUBLIC_SHA],
      })
    ).toThrow(/manifest hash/i);
  });
});
