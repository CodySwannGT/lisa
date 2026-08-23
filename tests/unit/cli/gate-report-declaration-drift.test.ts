/**
 * The declaration-versus-ruleset comparison, end to end through the report.
 *
 * The offline half is the one with no excuse for being unreachable: it needs
 * the Lisa package and the settings file, and nothing else. So these tests hold
 * the whole path — settings file in, verdict out — rather than only the pure
 * classifier, and they assert the unreachable cases as loudly as the reachable
 * ones. A comparison that silently passed when it could not read a surface
 * would be the defect this check exists to catch, sited on the check itself.
 * @module tests/unit/cli/gate-report-declaration-drift
 */
import { describe, expect, it } from "vitest";

import type { EnforcedContext } from "../../../src/core/gate-declaration-drift.js";
import { readTemplateEnforcement } from "../../../src/cli/gate-report-templates.js";
import {
  makeProject,
  reportFor,
  PULL_REQUEST,
} from "./gate-report-fixtures.js";

const WORKFLOW = "🔍 Quality Checks";
const SECURITY = `${WORKFLOW} / 🔒 Security Scan`;
const TYPE_CHECK = `${WORKFLOW} / 🔍 Type Check`;
const TEMPLATE = "typescript/github-rulesets/quality-checks.json";

/**
 * A template reader that requires exactly the given contexts.
 * @param contexts - Contexts the template requires
 * @returns An injectable reader
 */
function templateRequiring(
  contexts: readonly string[]
): () => Promise<readonly EnforcedContext[]> {
  return async () =>
    contexts.map(context => ({
      context,
      ruleset: "quality checks",
      source: TEMPLATE,
    }));
}

describe("the gate report's declaration-versus-template comparison", () => {
  it("reports a required context the settings file never asks for", async () => {
    const report = await reportFor(
      { config: { gates: {} } },
      { readTemplateContexts: templateRequiring([SECURITY]) }
    );
    const drift = report.declarationDrift.templates;
    if (drift.state !== "verified") throw new Error(drift.reason);

    const entry = drift.value.entries.find(one => one.context === SECURITY);
    expect(entry?.verdict).toBe("enforced-undeclared");
    expect(entry?.gateId).toBe("dependency-vulnerability");
    expect(entry?.sources).toEqual([TEMPLATE]);
  });

  it("reports a declared requirement the template omits as drift", async () => {
    const report = await reportFor(
      {
        config: {
          gates: { "structural-rules": { [PULL_REQUEST]: "required" } },
        },
      },
      { readTemplateContexts: templateRequiring([SECURITY]) }
    );
    const drift = report.declarationDrift.templates;
    if (drift.state !== "verified") throw new Error(drift.reason);

    expect(
      drift.value.entries.find(
        one => one.context === `${WORKFLOW} / 🔎 Structural Rules`
      )?.verdict
    ).toBe("declared-not-enforced");
  });

  it("distinguishes an off declaration contradicted by the template", async () => {
    const report = await reportFor(
      {
        config: {
          gates: {
            "type-correctness": { [PULL_REQUEST]: "off" },
          },
        },
      },
      { readTemplateContexts: templateRequiring([TYPE_CHECK, SECURITY]) }
    );
    const drift = report.declarationDrift.templates;
    if (drift.state !== "verified") throw new Error(drift.reason);
    const verdicts = new Map(
      drift.value.entries.map(entry => [entry.context, entry.verdict])
    );

    expect(verdicts.get(TYPE_CHECK)).toBe("enforced-declared-off");
    expect(verdicts.get(SECURITY)).toBe("enforced-undeclared");
    expect(drift.value.contradictions).toBe(1);
  });

  it("never proposes removing a context an undeclared gate produces", async () => {
    const report = await reportFor(
      { config: { gates: {} } },
      { readTemplateContexts: templateRequiring([SECURITY]) }
    );
    const drift = report.declarationDrift.templates;
    if (drift.state !== "verified") throw new Error(drift.reason);

    expect(
      drift.value.entries.find(one => one.context === SECURITY)?.remedy
    ).toBe("declare-the-gate");
  });

  it("reports the live half as unknown when the run did not read protection", async () => {
    const report = await reportFor(
      { config: { gates: {} } },
      { readTemplateContexts: templateRequiring([SECURITY]) }
    );

    expect(report.declarationDrift.live.state).toBe("unknown");
    if (report.declarationDrift.live.state === "unknown") {
      expect(report.declarationDrift.live.reason).toBe("offline");
    }
  });

  it("compares against the live ruleset when the run did read protection", async () => {
    const report = await reportFor(
      { config: { gates: { "type-correctness": { [PULL_REQUEST]: "off" } } } },
      {
        offline: false,
        readRequiredContexts: async () => [TYPE_CHECK],
        readTemplateContexts: templateRequiring([TYPE_CHECK]),
      }
    );
    const live = report.declarationDrift.live;
    if (live.state !== "verified") throw new Error(live.reason);

    expect(live.value.surface).toBe("live-ruleset");
    expect(live.value.entries[0]?.verdict).toBe("enforced-declared-off");
  });

  it("keeps a template that could not be read out of the verified state", async () => {
    const report = await reportFor(
      { config: { gates: {} } },
      {
        readTemplateContexts: () => {
          throw new Error("disk on fire");
        },
      }
    );

    expect(report.declarationDrift.templates.state).toBe("unknown");
  });
});

describe("readTemplateEnforcement", () => {
  it("reports an empty template set as unread rather than as nothing required", async () => {
    const finding = await readTemplateEnforcement({
      projectRoot: await makeProject({ config: {} }),
      read: async () => [],
    });

    expect(finding.state).toBe("unknown");
    if (finding.state === "unknown") {
      expect(finding.reason).toBe("templates-not-found");
    }
  });

  it("names an unreadable settings file as its own reason", async () => {
    const finding = await readTemplateEnforcement({
      projectRoot: await makeProject({ config: {} }),
      read: () => {
        throw new Error("CONFIG_UNREADABLE");
      },
    });

    expect(finding.state).toBe("unknown");
    if (finding.state === "unknown") {
      expect(finding.reason).toBe("config-unreadable");
    }
  });

  it("names a missing Lisa package as its own reason", async () => {
    const finding = await readTemplateEnforcement({
      projectRoot: await makeProject({ config: {} }),
      read: () => {
        throw new Error("LISA_PACKAGE_NOT_FOUND");
      },
    });

    expect(finding.state).toBe("unknown");
    if (finding.state === "unknown") {
      expect(finding.reason).toBe("lisa-package-not-found");
    }
  });

  it("reads the shipped templates for a project that holds none of its own", async () => {
    const finding = await readTemplateEnforcement({
      projectRoot: await makeProject({ config: {} }),
    });

    expect(finding.state).toBe("verified");
    if (finding.state === "verified") {
      expect(finding.value.map(entry => entry.context)).toContain("CodeRabbit");
      expect(finding.value.every(entry => !entry.source.startsWith("/"))).toBe(
        true
      );
    }
  });
});
