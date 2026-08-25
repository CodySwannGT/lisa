/**
 * @file postinstall-trampoline-report-source.ts
 * @description The two reporting fragments inlined into the detached
 * reconciliation child.
 *
 * These exist because the child is detached and `stdio: "ignore"`: anything it
 * says to a stream is said to nobody, so the only evidence that survives the
 * package manager exiting is a file. Before them, a trampoline that never
 * spawned, one that died on arrival, and one that ran and correctly did nothing
 * were indistinguishable — which is what made CodySwannGT/lisa#2750 invisible
 * for as long as it existed.
 * @module utils
 */

/**
 * The report writer inlined into the trampoline child.
 *
 * This is the deliverable half of CodySwannGT/lisa#2750. The child is detached
 * and `stdio: "ignore"`, so anything it says to a stream is said to nobody; the
 * only place it can leave evidence is the filesystem, and the only evidence that
 * survives the parent exiting is a file. Every write is atomic (temp + rename)
 * so `lisa doctor` never reads a half-written document, and every write is
 * wrapped so a read-only or full disk degrades to the old silence rather than
 * killing a reconciliation that would otherwise have worked.
 *
 * `scheduled_at` and `lisa_version` are inherited from the report the parent
 * apply wrote, so the age doctor reports is the age of the WHOLE reconciliation
 * rather than of its last heartbeat.
 * @param literals - Inlined JSON-safe literals
 * @param literals.reportPath - Absolute path of the report file
 * @param literals.reportSchemaVersion - Schema version stamped into each write
 * @param literals.lisaVersion - Fallback Lisa version when no prior report exists
 * @returns JS source fragment
 */
export function buildTrampolineReporter(literals: {
  readonly reportPath: string;
  readonly reportSchemaVersion: string;
  readonly lisaVersion: string;
}): string {
  return `
    const REPORT_PATH = ${literals.reportPath};

    function readReport() {
      try { return JSON.parse(readFileSync(REPORT_PATH, "utf8")); }
      catch { return null; }
    }

    function report(outcome, detail, packageManagers) {
      try {
        const prior = readReport();
        const now = new Date().toISOString();
        const doc = {
          schema_version: ${literals.reportSchemaVersion},
          lisa_version:
            prior && typeof prior.lisa_version === "string"
              ? prior.lisa_version
              : ${literals.lisaVersion},
          outcome: outcome,
          scheduled_at:
            prior && typeof prior.scheduled_at === "string"
              ? prior.scheduled_at
              : now,
          updated_at: now,
          package_managers: packageManagers || [],
          detail: detail,
        };
        mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        const tempPath = REPORT_PATH + ".tmp";
        writeFileSync(tempPath, JSON.stringify(doc, null, 2) + "\\n");
        renameSync(tempPath, REPORT_PATH);
      } catch {
        // A report that cannot be written must never break an install.
      }
    }
  `;
}

/**
 * The regen-outcome reporter inlined into the trampoline child.
 *
 * Split from the main IIFE only so each stays under the repo's function-length
 * cap; it is the terminal half of one decision. Three outcomes, deliberately
 * distinct: a regen that failed, a package.json change with no lockfile to
 * repair, and a regen that landed. Collapsing any pair of them would restore
 * exactly the ambiguity CodySwannGT/lisa#2750 was filed about.
 * @returns JS source fragment
 */
export function buildTrampolineRegenReporter(): string {
  return `
    function reportRegen(regen, reapplyNote) {
      if (regen.failed.length > 0) {
        report(
          "failed",
          "Lockfile regeneration failed for: " + regen.failed.join(", ") +
            ". Lockfiles are still out of sync with package.json, so a " +
            "frozen-lockfile install will fail." + reapplyNote,
          regen.attempted
        );
        return;
      }
      if (regen.attempted.length === 0) {
        report(
          "not-needed",
          "package.json changed but no lockfile was found to regenerate." +
            reapplyNote,
          []
        );
        return;
      }
      report(
        "regenerated",
        "Regenerated lockfiles for: " + regen.attempted.join(", ") + "." +
          reapplyNote,
        regen.attempted
      );
    }
  `;
}
