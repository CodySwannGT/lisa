/** Expected stack rosters, kept independent of the production plugin catalog. */
/** Plugin template basenames (de-duplicated for sonarjs/no-duplicate-string). */
export const SESS = "lisa-session-bootstrap.ts";
const PARITY = "lisa-parity-safety-net.ts";
export const LINT = "lisa-lint-on-edit.ts";
export const SUPPR = "lisa-block-suppress-directives.ts";
const SGSCAN = "lisa-sg-scan-on-edit.ts";
export const MIGRATION = "lisa-block-migration-edits.ts";
const RUBOCOP = "lisa-rubocop-on-edit.ts";
const INSTR = "lisa-block-instruction-file-edits.ts";
const MANAGED = "lisa-block-managed-file-edits.ts";
const ISSUE = "lisa-block-direct-issue-create.ts";
const NO_VERIFY = "lisa-block-no-verify.ts";
const DISCHARGE = "lisa-discharge-work-item-gates.ts";

/** Emit order per stack, named so the assertions stay one line each. */
/** Guards every project gets, in the order the installer lists them. */
const UNIVERSAL = [
  ISSUE,
  INSTR,
  MANAGED,
  NO_VERIFY,
  DISCHARGE,
  "lisa-task-readiness.ts",
];
/** The tail every roster shares. */
const TAIL = [SESS, SGSCAN];
const byName = (a: string, b: string): number => a.localeCompare(b);
export const TS_PLUGINS = [...UNIVERSAL, SUPPR, LINT, PARITY, ...TAIL].sort(
  byName
);
export const RAILS_PLUGINS = [...UNIVERSAL, PARITY, RUBOCOP, ...TAIL].sort(
  byName
);
