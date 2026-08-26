/**
 * A gate names the property it certifies, never the tool that certifies it.
 *
 * The registry says why in its own doc comment: `label` is the CI job name,
 * and a repository ruleset names required checks by exact string, so a label
 * is what a branch-protection context is built from. A vendor name in a label
 * is therefore a vendor name compiled into branch protection, and "swap Snyk
 * for something else" stops being a config edit and becomes a ruleset edit in
 * every consumer repository — coordinated with the workflow change, or merges
 * block on a context nothing will ever post again.
 *
 * The ids have obeyed this from the start. These assertions are about the two
 * layers downstream of the id — the label, and the job name derived from it —
 * where three labels and seven job names had drifted onto the vendor.
 * @module tests/integration/gate-labels-name-properties
 */

import { describe, expect, it } from "vitest";

import {
  REGISTRY,
  contextsFor,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** One registry entry, as this suite reads it. */
interface Entry {
  label: string;
  task?: string;
  previousLabels?: readonly string[];
}

/** The registry, typed for the two fields these assertions touch. */
const GATES = REGISTRY as Record<string, Entry>;

/** The moment `quality.yml` runs at, and the one a ruleset is derived for. */
const PULL_REQUEST = "pull-request";

/** The prefix `contextsFor` puts in front of a run gate's label. */
const PREFIX = "🔍 Quality Checks / ";

/**
 * Third-party product names that must not appear in a label.
 *
 * A denylist, and the weaker of the two possible designs — it cannot catch a
 * vendor nobody has thought of. It is still the right one here: an allowlist
 * of permitted words would have to enumerate English, and the failure it would
 * produce ("`Journeys` is not an approved word") teaches nothing. This catches
 * the regression that actually happens, which is a new gate added by copying
 * an existing job's name.
 *
 * Deliberately includes tools Lisa ships and tools it does not, because the
 * rule is about the SHAPE of the name and not about which vendor is current.
 */
const VENDORS: readonly string[] = [
  "aikido",
  "ast-grep",
  "ast grep",
  "chromatic",
  "codeclimate",
  "coderabbit",
  "codecov",
  "cypress",
  "datadog",
  "dependabot",
  "detox",
  "eslint",
  "fossa",
  "gitguardian",
  "gitleaks",
  "jest",
  "knip",
  "lighthouse",
  "maestro",
  "mocha",
  "oxlint",
  "playwright",
  "prettier",
  "renovate",
  "semgrep",
  "snyk",
  "sonarcloud",
  "sonarqube",
  "stryker",
  "trufflehog",
  "trivy",
  "veracode",
  "vitest",
  "whitesource",
  "zap",
];

/**
 * Vendor mentions inside one string.
 * @param value The label under test.
 * @returns Every denied word it contains, lowercased.
 */
const vendorsIn = (value: string): string[] =>
  VENDORS.filter(vendor => value.toLowerCase().includes(vendor));

describe("gate labels name properties, not vendors", () => {
  it.each(Object.entries(GATES))(
    "%s's label carries no third-party product name",
    (id, entry) => {
      expect(
        vendorsIn(entry.label),
        `REGISTRY.${id}.label is ${JSON.stringify(entry.label)}. A label is ` +
          "the branch-protection context, so a vendor here means replacing " +
          "that vendor later requires a ruleset migration in every consumer."
      ).toEqual([]);
    }
  );

  it("covers the whole registry rather than a sample", () => {
    // The count is not the assertion — the enumeration above is. This exists
    // so a registry that somehow exported nothing cannot pass by generating
    // zero cases, which is the same vacuous-green shape the gates themselves
    // are built to refuse.
    expect(Object.keys(GATES).length).toBeGreaterThan(30);
  });
});

describe("swapping the vendor behind a gate changes no check name", () => {
  it.each([
    ["static-security", "sonar-scanner", "aikido scan"],
    [
      "credential-leakage",
      "ggshield secret scan ci",
      "trufflehog filesystem .",
    ],
    ["e2e-browser", "playwright test", "cypress run"],
  ])(
    "%s derives the same context whether it runs %s or %s",
    (id, oneVendor, otherVendor) => {
      const moment = PULL_REQUEST;
      const derive = (task: string): string[] =>
        contextsFor(
          { [id]: { [moment]: { level: "required", run: task } } },
          { moment }
        );
      expect(derive(oneVendor)).toEqual(derive(otherVendor));
      expect(derive(oneVendor)).toContain(`${PREFIX}${GATES[id]?.label ?? ""}`);
    }
  );
});

describe("a rename records retirement without reviving the old context", () => {
  /** Every gate that records a former label. */
  const RENAMED = Object.entries(GATES).filter(
    ([, entry]) => (entry.previousLabels ?? []).length > 0
  );

  it("has at least one rename in flight to assert about", () => {
    // Guards the `it.each` below against silently generating no cases once the
    // current migration finishes. When that day comes this fails, and whoever
    // drops the last `previousLabels` entry has to decide deliberately whether
    // the mechanism is still covered.
    expect(RENAMED.length).toBeGreaterThan(0);
  });

  it.each(RENAMED)(
    "%s emits only the current context unless overlap is explicit",
    (id, entry) => {
      const moment = (
        (entry as { moments?: string[] }).moments ?? [PULL_REQUEST]
      ).includes(PULL_REQUEST)
        ? PULL_REQUEST
        : ((entry as { moments?: string[] }).moments?.[0] ?? PULL_REQUEST);
      const derived = contextsFor(
        { [id]: { [moment]: "required" } },
        { moment }
      );
      expect(derived).toContain(`${PREFIX}${entry.label}`);
      for (const former of entry.previousLabels ?? []) {
        expect(
          derived,
          `${id} records ${JSON.stringify(former)} as a former label, so a ` +
            "newly derived ruleset must not require a context no workflow " +
            "posts any more."
        ).not.toContain(`${PREFIX}${former}`);
      }

      const overlap = contextsFor(
        { [id]: { [moment]: "required" } },
        { moment, previousLabels: [...(entry.previousLabels ?? [])] }
      );
      for (const former of entry.previousLabels ?? []) {
        expect(overlap).toContain(`${PREFIX}${former}`);
      }
    }
  );

  it("does not leak a former label into a gate that was never renamed", () => {
    const derived = contextsFor(
      { "code-style": { [PULL_REQUEST]: "required" } },
      { moment: PULL_REQUEST }
    );
    expect(derived).toEqual([`${PREFIX}🧹 Lint`]);
  });
});

describe("an awaited context keeps the vendor's own name", () => {
  it("emits the string the app posts, unprefixed and unchanged", () => {
    // The scope boundary of the whole ruling, asserted so nobody "fixes" it.
    // An awaited signal is posted by a third-party app under a name the vendor
    // chooses; renaming it here would simply stop matching. The vendor-neutral
    // name lives in the gate id — `code-review` — which is where it can.
    expect(
      contextsFor(
        {
          "code-review": {
            [PULL_REQUEST]: { level: "required", await: "CodeRabbit" },
          },
        },
        { moment: PULL_REQUEST }
      )
    ).toEqual(["CodeRabbit"]);
  });

  it("does not prefix an awaited context with the workflow name", () => {
    const derived = contextsFor(
      {
        "credential-leakage": {
          [PULL_REQUEST]: {
            level: "required",
            await: "GitGuardian Security Checks",
          },
        },
      },
      { moment: PULL_REQUEST }
    );
    expect(derived).toEqual(["GitGuardian Security Checks"]);
    expect(derived.join("")).not.toContain("Quality Checks /");
  });
});
