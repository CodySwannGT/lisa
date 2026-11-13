/**
 * Contract coverage for the tool-access-gate's credential-recovery routing.
 *
 * The gate's AWS probe used to be only `aws sts get-caller-identity`, and its
 * credential-source list stopped before the configured secret provider. A
 * preflight that followed it literally marked AWS as failed on a workstation
 * with no default credentials, even when `LISA_AWS_BOOTSTRAP_JSON` was in the
 * provider — contradicting `lisa-secrets-access`, which says to run the
 * bootstrap recovery in exactly that case (CodySwannGT/lisa#4469). These
 * assertions pin the routing in both the source tree and the built plugin.
 * @module tests/unit/strategies/tool-access-gate-aws-recovery
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Returns the markdown table row whose first cell names the tool.
 * @param doc - Rule body.
 * @param tool - Text of the first cell.
 * @returns The row, or an empty string when absent.
 */
const tableRow = (doc: string, tool: string): string =>
  doc.split("\n").find(line => line.startsWith(`| ${tool} |`)) ?? "";

/**
 * Returns the paragraph that opens with the given text.
 * @param doc - Rule body.
 * @param opening - Text the paragraph starts with.
 * @returns The paragraph, or an empty string when absent.
 */
const paragraph = (doc: string, opening: string): string =>
  doc.split(/\n\s*\n/).find(block => block.trimStart().startsWith(opening)) ??
  "";

describe("tool-access-gate credential recovery routing (#4469)", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/tool-access-gate.md");
    const eager = read(root, "rules/eager/when-to-stop.md");

    it("probes AWS through the bootstrap recovery before the caller-identity check", () => {
      const row = tableRow(reference, "AWS CLI");
      const recovery = row.search(/LISA_AWS_BOOTSTRAP_JSON/);
      const setup = row.search(/remote-agent-aws-setup\.sh/);
      const identity = row.search(/aws sts get-caller-identity/);

      expect(row).toMatch(/lisa-secrets-access/);
      expect(recovery).toBeGreaterThanOrEqual(0);
      expect(setup).toBeGreaterThan(recovery);
      expect(identity).toBeGreaterThan(setup);
    });

    it("requires the caller account to match the project's expected account", () => {
      expect(tableRow(reference, "AWS CLI")).toMatch(/expected account/i);
    });

    it("still reports and stops when the bundle is unresolvable or the account mismatches", () => {
      const row = tableRow(reference, "AWS CLI");

      expect(row).toMatch(
        /unresolvable bundle or an account mismatch is the failure to report/i
      );
      expect(row).toMatch(/different AWS access method keeps that method/i);
    });

    it("lets a recovery run without human permission, for every vendor", () => {
      expect(reference).toMatch(/needs no human permission/i);
      expect(reference).toMatch(
        /every vendor whose access skill documents a\s+recovery step/i
      );
    });

    it("lists lisa-secrets-access among the access skills a probe must route through", () => {
      const list = paragraph(reference, "- Vendors with an access layer");

      expect(list).toMatch(/`lisa-secrets-access`/);
    });

    it("resolves credentials through the configured secret provider before declaring a gap", () => {
      const sources = paragraph(
        reference,
        "Resolve credentials through the documented sources"
      );
      const provider = sources.search(/lisa-secrets-access/);
      const stop = sources.search(/report the gap and stop/);

      expect(provider).toBeGreaterThanOrEqual(0);
      expect(stop).toBeGreaterThan(provider);
    });

    it("states that a documented recovery step is not a forbidden write", () => {
      expect(reference).toMatch(
        /documented recovery[^\n]*(?:\n[^\n]+)*?not a forbidden write/i
      );
    });

    it("points the eager summary at lisa-secrets-access", () => {
      expect(eager).toMatch(/lisa-secrets-access/);
    });
  });
});
