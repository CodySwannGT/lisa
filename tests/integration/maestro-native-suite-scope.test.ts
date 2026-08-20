/**
 * Behavioral tests for the suite-scope marker — these EXECUTE the workflow's
 * own shell, pulled verbatim out of the YAML, rather than asserting that
 * certain strings appear in it.
 *
 * This marker is why the test has to run rather than read. It used to be an
 * inline `${{ }}` expression on the artifact name, and it was WRONG ON EVERY
 * RUN this workflow has ever produced: the predicate was `exclude_tags != ''`
 * while the file's own defaults are `ios-only` / `android-only`, so nothing
 * short of a caller passing `''` could reach `scope-full`. Row 36 of
 * `check-nightly-e2e-health.mjs` disqualifies a `filtered` run
 * unconditionally, which made the nightly gate's Maestro arm unable to reach
 * `pass` for any consumer. The check and its publisher shipped in the same
 * commit (`c46b1b5ca`) and never worked — and nothing caught it because an
 * expression is not runnable, so no test could have executed the decision.
 *
 * Both directions are asserted, because a marker stuck on `full` is exactly as
 * broken as one stuck on `filtered` — just less noticeably, and in the
 * direction that lets a four-flow dispatch clear a merge gate for an
 * eighty-flow suite. Delete the baseline comparison and the `full` cases die;
 * delete the include-tags arm or the inequality arm and the `filtered` cases
 * die.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The scope step's name, matched on rather than repeated at each call site. */
const SCOPE_STEP = "Record the suite scope";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  shell?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, WorkflowJob>;
}

/** The two platform arms this workflow fans out into. */
type Platform = "android" | "ios";

/** The tag inputs a run is given, as the caller would set them. */
interface ScopeInputs {
  include?: string;
  exclude?: string;
  baseline?: string;
}

describe("maestro-native-e2e suite-scope marker (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  /**
   * The verbatim `run:` text of the scope step — never a copy of it.
   * @param platform - Which platform job to read the step from
   * @returns The step's shell script exactly as CI will run it
   */
  const scopeScript = (platform: Platform): string => {
    const step = (workflow.jobs[platform].steps ?? []).find(candidate =>
      candidate.name?.includes(SCOPE_STEP)
    );
    if (!step?.run) {
      throw new Error(`no scope step in job ${platform}`);
    }
    return step.run;
  };

  /**
   * The declared default of one of this workflow's inputs.
   * @param name - The input name
   * @returns The default as a string
   */
  const inputDefault = (name: string): string =>
    String(workflow.on.workflow_call?.inputs?.[name]?.default ?? "");

  /**
   * Runs the real scope step against a set of tag inputs and reports what it
   * decided — read from `$GITHUB_OUTPUT`, which is the value the artifact name
   * interpolates, rather than from the human-readable text file beside it.
   * @param platform - Which arm's step to execute
   * @param inputs - The tag inputs for this run
   * @returns The recorded scope and the step's file output
   */
  const record = async (
    platform: Platform,
    inputs: ScopeInputs
  ): Promise<{ scope: string; file: string }> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-scope-"));
    try {
      const outputs = path.join(dir, "outputs");
      await fs.writeFile(outputs, "");
      execFileSync(BASH, ["-eo", "pipefail", "-c", scopeScript(platform)], {
        cwd: dir,
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputs,
          INCLUDE_TAGS: inputs.include ?? "",
          EXCLUDE_TAGS:
            inputs.exclude ?? inputDefault(`${platform}_exclude_tags`),
          FULL_SUITE_EXCLUDE_TAGS:
            inputs.baseline ??
            inputDefault(`${platform}_full_suite_exclude_tags`),
        },
      });
      const parsed = Object.fromEntries(
        (await fs.readFile(outputs, "utf-8"))
          .split("\n")
          .filter(Boolean)
          .map(line => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)] as [
              string,
              string,
            ];
          })
      );
      return {
        scope: parsed.scope,
        file: await fs.readFile(
          path.join(dir, `maestro-${platform}-scope.txt`),
          "utf-8"
        ),
      };
    } finally {
      await fs.remove(dir);
    }
  };

  /** The two platform partitions this file ships as its own defaults. */
  const PARTITION: Record<Platform, string> = {
    android: "ios-only",
    ios: "android-only",
  };

  for (const platform of ["android", "ios"] as const) {
    // ---------------------------------------------------------- full suite

    it(`${platform}: DEFAULT inputs record a FULL suite — the regression this file exists for`, async () => {
      // The bug in one line: before the fix this recorded `filtered`, because
      // the workflow's own default exclude tag is non-empty. A reusable
      // workflow cannot ship a default that permanently disqualifies every run
      // made with it.
      const result = await record(platform, {});
      expect(result.scope).toBe("full");
    });

    it(`${platform}: exclude tags EQUAL to the declared baseline record FULL`, async () => {
      const declared = `${PARTITION[platform]},blocked,playground`;
      const result = await record(platform, {
        exclude: declared,
        baseline: declared,
      });
      expect(result.scope).toBe("full");
    });

    it(`${platform}: the comparison is ORDER-INSENSITIVE`, async () => {
      // `a,b` and `b,a` are the same declaration. String comparison would let a
      // caller tidying its own tag list silently flip the marker to `filtered`
      // — the same defect again, in a form that is harder to see.
      const result = await record(platform, {
        exclude: `${PARTITION[platform]},blocked,playground`,
        baseline: `playground,blocked,${PARTITION[platform]}`,
      });
      expect(result.scope).toBe("full");
    });

    it(`${platform}: whitespace and duplicates do not change the declaration`, async () => {
      const result = await record(platform, {
        exclude: `  ${PARTITION[platform]} , blocked ,blocked,  playground `,
        baseline: `playground,${PARTITION[platform]},blocked`,
      });
      expect(result.scope).toBe("full");
    });

    it(`${platform}: an empty baseline matches empty exclude tags`, async () => {
      // The genuinely unfiltered case must still be reachable, and the empty
      // tag list must not abort the step (`grep -v` would have, under
      // `bash -eo pipefail`).
      const result = await record(platform, { exclude: "", baseline: "" });
      expect(result.scope).toBe("full");
    });

    // ------------------------------------------------------------- filtered

    it(`${platform}: an INCLUDE list records FILTERED even when it matches the baseline`, async () => {
      // An include list names what to run rather than what to leave out, so
      // there is no baseline it could equal. This is the AcmeOrgB shape: four
      // flows of eighty under `ios_include_tags: smoke`, green, and worthless.
      const result = await record(platform, { include: "smoke" });
      expect(result.scope).toBe("filtered");
    });

    it(`${platform}: excluding MORE than the baseline records FILTERED`, async () => {
      const result = await record(platform, {
        exclude: `${PARTITION[platform]},blocked,playground,contracts`,
        baseline: `${PARTITION[platform]},blocked,playground`,
      });
      expect(result.scope).toBe("filtered");
    });

    it(`${platform}: excluding FEWER than the baseline records FILTERED`, async () => {
      const result = await record(platform, {
        exclude: PARTITION[platform],
        baseline: `${PARTITION[platform]},blocked,playground`,
      });
      expect(result.scope).toBe("filtered");
    });

    it(`${platform}: a DIFFERENT tag of the same count records FILTERED`, async () => {
      // Guards a normalisation that compared lengths rather than members.
      const result = await record(platform, {
        exclude: `${PARTITION[platform]},squad`,
        baseline: `${PARTITION[platform]},blocked`,
      });
      expect(result.scope).toBe("filtered");
    });

    // -------------------------------------------------------------- record

    it(`${platform}: writes the decision AND its inputs into the scope file`, async () => {
      const result = await record(platform, {});
      expect(result.file).toContain(`platform=${platform}`);
      expect(result.file).toContain("scope=full");
      expect(result.file).toContain(
        `full_suite_exclude_tags=${PARTITION[platform]}`
      );
    });
  }
});

describe("maestro-native-e2e suite-scope contract", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("defaults each full-suite baseline to its own exclude-tag default", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    // THE regression guard. If these ever drift apart, a caller that passes
    // nothing is once again recorded as having run a slice, and the nightly
    // gate's Maestro arm becomes unsatisfiable for every consumer at once.
    for (const platform of ["android", "ios"] as const) {
      expect(inputs[`${platform}_full_suite_exclude_tags`]?.default).toBe(
        inputs[`${platform}_exclude_tags`]?.default
      );
    }
  });

  it("takes the artifact name from the executed step, not from an inline expression", () => {
    for (const platform of ["android", "ios"] as const) {
      const publish = (workflow.jobs[platform].steps ?? []).find(step =>
        String(step.with?.name ?? "").startsWith(`maestro-${platform}-scope-`)
      );
      // The decision must be the shell step's output. An inline `${{ }}`
      // predicate here is unrunnable, and therefore untestable, which is how
      // the original defect survived from `c46b1b5ca` to production.
      expect(publish?.with?.name).toBe(
        `maestro-${platform}-scope-\${{ steps.scope.outputs.scope }}`
      );
      expect(publish?.with?.["if-no-files-found"]).toBe("error");
    }
  });

  it("gives the scope step the id the artifact name references", () => {
    for (const platform of ["android", "ios"] as const) {
      const step = (workflow.jobs[platform].steps ?? []).find(candidate =>
        candidate.name?.includes(SCOPE_STEP)
      );
      expect(step?.id).toBe("scope");
      // Known before a flow starts, and most needed when a run dies mid-suite.
      expect(step?.if).toBe("${{ !cancelled() }}");
      expect(step?.shell).toBe("bash");
      expect(step?.env?.FULL_SUITE_EXCLUDE_TAGS).toBe(
        `\${{ inputs.${platform}_full_suite_exclude_tags }}`
      );
    }
  });

  it("keeps every caller-controlled tag input out of the scope step's shell", () => {
    for (const platform of ["android", "ios"] as const) {
      const step = (workflow.jobs[platform].steps ?? []).find(candidate =>
        candidate.name?.includes(SCOPE_STEP)
      );
      // Each tag list arrives through `env:`, so the shell reads it as a
      // variable rather than having a caller's string pasted into the script
      // text. Reintroducing a `${{ }}` expansion here would reopen the
      // injection seam AND make the decision unrunnable again — the same
      // property whose absence let the original marker bug survive review.
      // Asserting the script needs no substitution to run is that proof.
      for (const input of [
        `${platform}_include_tags`,
        `${platform}_exclude_tags`,
        `${platform}_full_suite_exclude_tags`,
      ]) {
        expect(step?.run).not.toContain(`\${{ inputs.${input} }}`);
      }
      expect(step?.run).not.toContain("${{");
    }
  });
});
