import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MANAGED_AUDIT_IGNORE =
  "typescript/copy-overwrite/audit.ignore.config.json";
const PATCHED_ADVISORIES = [
  "GHSA-q3j6-qgpj-74h6",
  "GHSA-v39h-62p7-jpjc",
] as const;

/** Shape of the managed audit exclusion file consumed by host security gates. */
interface AuditIgnoreConfig {
  readonly exclusions: readonly {
    readonly id: string;
    readonly package?: string;
  }[];
}

describe("fast-uri managed audit policy", () => {
  it.each(PATCHED_ADVISORIES)(
    "does not globally suppress %s after patched releases exist",
    advisory => {
      const config = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, MANAGED_AUDIT_IGNORE), "utf8")
      ) as AuditIgnoreConfig;

      expect(config.exclusions.map(exclusion => exclusion.id)).not.toContain(
        advisory
      );
    }
  );
});
