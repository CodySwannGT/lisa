/**
 * Every shipped create-only caller must pass secrets only to a reusable that
 * declares some (issue #3065).
 *
 * `all/create-only/.github/workflows/continuous-gates.yml` shipped
 * `secrets: inherit` against `.github/workflows/gates.yml`, which declares no
 * secrets in its `workflow_call` and contains zero occurrences of the string
 * `secret` anywhere in the file. The callee therefore read nothing, and the
 * caller handed it every secret in the consumer's repository to do it with.
 *
 * That is not a latent tidiness problem. SonarCloud raises "Only pass required
 * secrets to this workflow" as a VULNERABILITY, which degrades
 * `new_security_rating` and blocks the merge on any consumer whose Sonar
 * analysis covers `.github/**` — measured at `actual=3, threshold=1`. Because
 * these templates are create-only, no later apply corrects a consumer that has
 * already received one.
 *
 * `lisa-update-projects/SKILL.md` step 8 already tells operators not to migrate
 * callers to `secrets: inherit`, citing this exact SonarCloud behaviour. The
 * rule existed; the shipped template broke it.
 *
 * The invariant is stated over the WHOLE set of shipped callers rather than
 * against `continuous-gates.yml` by name, deliberately. Pinning the one known
 * file would say nothing about the next template that acquires an `inherit`,
 * and `deploy.yml` across four lanes legitimately passes secrets to
 * `release.yml` — so the discriminator has to be "does the callee declare any",
 * not "does the caller pass any".
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/config/create-only-caller-secrets
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** Prefix identifying a call into a reusable workflow in THIS repository. */
const LISA_USES = "CodySwannGT/lisa/.github/workflows/";

/** Shape of the parts of a workflow file this test reads. */
interface WorkflowDoc {
  readonly on?: { readonly workflow_call?: { readonly secrets?: unknown } };
  readonly jobs?: Record<
    string,
    { readonly uses?: unknown; readonly secrets?: unknown }
  >;
}

/**
 * Parses a workflow file into the subset of its structure this test reads.
 *
 * @param absolute - Absolute path to the workflow file.
 * @returns The parsed document, or an empty object when it is not a mapping.
 */
function readWorkflow(absolute: string): WorkflowDoc {
  const parsed = loadYaml(readFileSync(absolute, "utf8"));
  return typeof parsed === "object" && parsed !== null
    ? (parsed as WorkflowDoc)
    : {};
}

/**
 * How many secrets a reusable workflow declares in its `workflow_call`.
 *
 * Read from the callee's own declaration rather than from usage, because that
 * declaration is the contract a caller is entitled to satisfy. A callee that
 * declares none can receive none.
 *
 * @param calleeName - Basename of the reusable, e.g. `gates.yml`.
 * @returns The count of declared secrets, or 0 when the file or block is absent.
 */
function declaredSecretCount(calleeName: string): number {
  const absolute = path.join(ROOT, ".github/workflows", calleeName);
  let doc: WorkflowDoc;
  try {
    doc = readWorkflow(absolute);
  } catch {
    return 0;
  }
  const declared = doc.on?.workflow_call?.secrets;
  return typeof declared === "object" && declared !== null
    ? Object.keys(declared as Record<string, unknown>).length
    : 0;
}

/** One shipped create-only job that calls a reusable in this repository. */
interface CallSite {
  readonly template: string;
  readonly job: string;
  readonly callee: string;
  readonly passesSecrets: boolean;
}

/**
 * Every job in every shipped create-only workflow that calls a Lisa reusable.
 *
 * @returns The call sites, one per job, in glob order.
 */
function collectCallSites(): CallSite[] {
  const templates = globSync("*/create-only/.github/workflows/*.yml", {
    cwd: ROOT,
  }).sort((a, b) => a.localeCompare(b));
  const sites: CallSite[] = [];
  for (const template of templates) {
    const doc = readWorkflow(path.join(ROOT, template));
    for (const [job, body] of Object.entries(doc.jobs ?? {})) {
      const uses = body?.uses;
      if (typeof uses !== "string" || !uses.startsWith(LISA_USES)) continue;
      const callee = uses.slice(LISA_USES.length).split("@")[0];
      sites.push({
        template,
        job,
        callee,
        passesSecrets: body?.secrets !== undefined,
      });
    }
  }
  return sites;
}

describe("shipped create-only callers", () => {
  it("finds call sites at all, so a silent zero cannot pass this file", () => {
    // A glob that matched nothing would make every assertion below vacuous —
    // the failure mode this whole file exists to catch, reproduced in its own
    // harness. 15 is a floor, not a pin: templates may be added.
    expect(collectCallSites().length).toBeGreaterThanOrEqual(15);
  });

  it("passes secrets only to a reusable that declares some", () => {
    const offenders = collectCallSites()
      .filter(
        site => site.passesSecrets && declaredSecretCount(site.callee) === 0
      )
      .map(site => `${site.template} job "${site.job}" -> ${site.callee}`);

    // Stated over the whole set: a caller handing secrets to a callee that
    // declares none grants everything to something that reads nothing.
    expect(offenders).toEqual([]);
  });

  it("still allows a caller whose callee does declare secrets", () => {
    // The positive control. Without it, deleting every `secrets:` key in every
    // template would also make the assertion above pass, and this file would be
    // pressure to strip credentials the release path genuinely needs.
    const withSecrets = collectCallSites().filter(
      site => site.passesSecrets && declaredSecretCount(site.callee) > 0
    );
    expect(withSecrets.length).toBeGreaterThan(0);
  });

  it("reads gates.yml as declaring no secrets", () => {
    // Pins the specific measurement the fix rests on. If gates.yml ever grows a
    // `workflow_call.secrets` block, this fails and the reasoning in
    // continuous-gates.yml's comment has to be revisited rather than silently
    // outliving its premise.
    expect(declaredSecretCount("gates.yml")).toBe(0);
  });
});
