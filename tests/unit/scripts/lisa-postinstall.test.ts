/** Dependency installation must not run Lisa apply or change its evidence. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const script = fileURLToPath(
  new URL(
    "../../../all/copy-overwrite/scripts/lisa-postinstall.mjs",
    import.meta.url
  )
);

describe("postinstall leaves template application to the operator", () => {
  it.each([false, true])(
    "does not invoke apply or replace existing evidence (prior failure: %s)",
    priorFailure => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-postinstall-"));
      try {
        const dist = path.join(
          root,
          "node_modules",
          "@codyswann",
          "lisa",
          "dist"
        );
        mkdirSync(dist, { recursive: true });
        writeFileSync(
          path.join(dist, "index.js"),
          'require("node:fs").writeFileSync("unwanted-template.txt", "changed");\n'
        );
        const marker = path.join(
          root,
          "node_modules",
          ".lisa",
          "apply-failed.json"
        );
        if (priorFailure) {
          mkdirSync(path.dirname(marker), { recursive: true });
          writeFileSync(marker, '{"exitCode":1}\n');
        }
        const result = boundedSpawnSync({
          label: "postinstall notice",
          command: process.execPath,
          args: [script],
          cwd: root,
          env: {
            ...process.env,
            CI: "",
            LISA_BOOTSTRAP: "1",
            npm_lifecycle_event: "postinstall",
          },
        });
        expect(result.status).toBe(0);
        expect(existsSync(path.join(root, "unwanted-template.txt"))).toBe(
          false
        );
        expect(existsSync(path.join(root, ".lisa", "apply-receipt.json"))).toBe(
          false
        );
        expect(existsSync(marker)).toBe(priorFailure);
        if (priorFailure)
          expect(readFileSync(marker, "utf8")).toBe('{"exitCode":1}\n');
        expect(result.stdout).toContain("lisa apply");
        expect(result.stdout).toContain("lisa doctor");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
