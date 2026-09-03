/**
 * A reusable workflow must READ every secret its `workflow_call` DECLARES, and
 * must not feed an identically named env var from `vars.*` instead (issue
 * #3502).
 *
 * `release.yml` declared `SENTRY_ORG` and `SENTRY_PROJECT` as `workflow_call`
 * secrets and then bound `SENTRY_ORG: ${{ vars.SENTRY_ORG }}`. A caller passing
 * them as secrets — which the declaration invites, and which the shipped
 * create-only `deploy.yml` templates actually do — had no effect on the job.
 *
 * This is worse than an ordinary mismatch because the masking is asymmetric.
 * Deleting the repository VARIABLES silently returns the sourcemap upload to
 * skipping: the guard sees empty strings, the release still succeeds, and the
 * only symptom is unsymbolicated stack traces surfacing days later in a
 * different tool. Deleting the SECRETS — which look authoritative, because they
 * are what the workflow interface declares — changes nothing at all. An
 * operator tidying up duplicated configuration would reasonably keep the
 * secrets and drop the variables, which is exactly the wrong choice.
 *
 * The invariant is stated over EVERY reusable workflow rather than against
 * `release.yml` by name, deliberately. Pinning the one known file would say
 * nothing about the next workflow that acquires the same split, and the issue
 * describes this as an unfixed instance of a recurring class.
 *
 * Reading `vars.NAME` into a DIFFERENTLY named env var is allowed and is not
 * the defect: `release.yml` reads `SENTRY_ORG_VAR: ${{ vars.SENTRY_ORG }}`
 * purely to detect a consumer still configured through the legacy channel and
 * fail loudly instead of skipping. What this test forbids is the value that
 * flows into env var `NAME` coming from the channel the declaration does not
 * advertise.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/config/reusable-workflow-secret-channel
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** Shape of the parts of a workflow file this test reads. */
interface WorkflowDoc {
  readonly on?: { readonly workflow_call?: { readonly secrets?: unknown } };
}

/**
 * Marker in a declaration's own `description` that opts it out of the
 * must-be-read rule.
 *
 * A secret kept solely so legacy callers do not fail with "secret is not
 * defined in the referenced workflow" is deliberately inert, and says so in the
 * declaration. That is the opposite of the #3502 defect: the operator reading
 * the interface is told the value does nothing, rather than being invited to
 * configure a channel nothing reads.
 */
const INTENTIONALLY_INERT = "deprecated";

/** One `workflow_call` secret declared by one reusable workflow. */
interface DeclaredSecret {
  readonly workflow: string;
  readonly name: string;
  /** True when the file reads the value through `secrets.NAME` at least once. */
  readonly readsSecretChannel: boolean;
  /** True when the file binds `NAME: ${{ vars.NAME }}`. */
  readonly aliasesVariableChannel: boolean;
}

/**
 * Escapes a string for literal use inside a regular expression.
 *
 * @param value - The raw string to escape.
 * @returns The escaped string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Whether a declaration's own description opts it out of the must-be-read rule.
 *
 * @param body - The YAML value under the secret's name.
 * @returns True when the declaration documents itself as deliberately inert.
 */
function documentsItselfAsInert(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { description } = body as { readonly description?: unknown };
  return (
    typeof description === "string" &&
    description.toLowerCase().includes(INTENTIONALLY_INERT)
  );
}

/**
 * Reads the `workflow_call` secret declarations out of one workflow file.
 *
 * @param raw - The file's full text.
 * @returns Name/body pairs, or an empty array when the block is absent.
 */
function declarationsIn(raw: string): [string, unknown][] {
  let doc: WorkflowDoc;
  try {
    const parsed = loadYaml(raw);
    doc = typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return [];
  }
  const secrets = doc.on?.workflow_call?.secrets;
  if (typeof secrets !== "object" || secrets === null) return [];
  return Object.entries(secrets as Record<string, unknown>);
}

/**
 * Records how one declared secret is used in the file that declares it.
 *
 * @param workflow - Repo-relative path of the workflow file.
 * @param raw - The file's full text.
 * @param name - The declared secret's name.
 * @returns The usage record for that secret.
 */
function inspectUsage(
  workflow: string,
  raw: string,
  name: string
): DeclaredSecret {
  const escaped = escapeRegExp(name);
  return {
    workflow,
    name,
    // `secrets.NAME` anywhere in an expression counts, including the
    // `${{ secrets.NAME || fallback }}` form several workflows use.
    readsSecretChannel: new RegExp(`secrets\\.${escaped}(?![\\w-])`, "u").test(
      raw
    ),
    aliasesVariableChannel: new RegExp(
      `(?<![\\w-])${escaped}:\\s*\\$\\{\\{\\s*vars\\.${escaped}\\s*\\}\\}`,
      "u"
    ).test(raw),
  };
}

/**
 * Collects every `workflow_call` secret declared by a reusable in this repo.
 *
 * Declarations are read from YAML, but the two usage checks run against the raw
 * text: `${{ }}` expressions appear in `env:` maps, `run:` bodies, and
 * `$GITHUB_OUTPUT` writes alike, and no structural walk covers all three.
 *
 * @returns One entry per declared secret, in glob order.
 */
function collectDeclaredSecrets(): DeclaredSecret[] {
  const workflows = globSync(".github/workflows/*.yml", { cwd: ROOT }).sort(
    (a, b) => a.localeCompare(b)
  );
  const declared: DeclaredSecret[] = [];
  for (const workflow of workflows) {
    const raw = readFileSync(path.join(ROOT, workflow), "utf8");
    for (const [name, body] of declarationsIn(raw)) {
      if (documentsItselfAsInert(body)) continue;
      declared.push(inspectUsage(workflow, raw, name));
    }
  }
  return declared;
}

describe("reusable workflow secret declarations", () => {
  it("finds declared secrets at all, so a silent zero cannot pass this file", () => {
    // A glob or a parse that matched nothing would make every assertion below
    // vacuous — the failure mode this file exists to catch, reproduced in its
    // own harness. 10 is a floor, not a pin: reusables may declare more.
    expect(collectDeclaredSecrets().length).toBeGreaterThanOrEqual(10);
  });

  it("reads every secret it declares, so no declaration is inert", () => {
    const offenders = collectDeclaredSecrets()
      .filter(entry => !entry.readsSecretChannel)
      .map(entry => `${entry.workflow} declares ${entry.name}, never reads it`);
    expect(offenders).toEqual([]);
  });

  it("never feeds a declared secret's env var from the variable channel", () => {
    const offenders = collectDeclaredSecrets()
      .filter(entry => entry.aliasesVariableChannel)
      .map(
        entry =>
          `${entry.workflow} declares ${entry.name} as a secret but binds ${entry.name}: \${{ vars.${entry.name} }}`
      );
    expect(offenders).toEqual([]);
  });
});
