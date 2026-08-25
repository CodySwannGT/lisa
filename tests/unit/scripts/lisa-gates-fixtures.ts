/**
 * Fixtures shared by the gate registry test files.
 *
 * Extracted so each file stays inside the project's own max-lines gate — which
 * caught this suite at 420 lines, which is the gate working.
 * @module tests/unit/scripts/lisa-gates-fixtures
 */

export const QUALITY = "🔍 Quality Checks";
export const LINT_TASK = "lint";
export const REVIEW_BOT = "CodeRabbit";
export const LINT_LABEL = `${QUALITY} / 🧹 Lint`;
export const PULL_REQUEST = "pull-request";
export const PRE_DEPLOY_PROD = "pre-deploy:production";
export const LOCAL_REVIEW = "review:local";
export const NATIVE_E2E_TASK = "test:e2e:native";
/** The label 4.x renamed away, and the one that job posts now. */
export const RETIRED_LABEL = "🔎 AST Grep Scan";
export const RETIRED_REPLACEMENT_LABEL = "🔎 Structural Rules";
