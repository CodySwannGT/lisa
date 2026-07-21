import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ADVISORY_ID = "GHSA-8r6m-32jq-jx6q";
const AUDIT_IGNORE_FILES = [
  "audit.ignore.config.json",
  "audit.ignore.local.json",
] as const;

/** Shape of the audit exclusion files consumed by Lisa security checks. */
interface AuditIgnoreConfig {
  readonly exclusions: readonly { readonly id: string }[];
}

describe("fast-xml-parser security floor", () => {
  it.each(AUDIT_IGNORE_FILES)("does not suppress the advisory in %s", file => {
    const absolutePath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absolutePath)) return;
    const config = JSON.parse(
      fs.readFileSync(absolutePath, "utf8")
    ) as AuditIgnoreConfig;

    expect(config.exclusions.map(exclusion => exclusion.id)).not.toContain(
      ADVISORY_ID
    );
  });
});
