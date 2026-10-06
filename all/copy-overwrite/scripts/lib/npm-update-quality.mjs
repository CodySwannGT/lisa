// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Twenty-five fixed writer checks retain semantic quality independently of storage. */
import { required } from "./npm-update-contract.mjs";
import { environment, buildDraft } from "./npm-update-leaf-contract.mjs";

/** Core Task fields are validated independently of provider storage. */
function coreChecks(draft, body, policy) {
  return [
    [
      "S1",
      Boolean(draft.title && body && policy.repository),
      "complete Task core",
    ],
    [
      "S2",
      draft.title.startsWith("Update ") &&
        draft.title.length <= 100 &&
        !draft.title.includes("\n"),
      "imperative bounded title",
    ],
    [
      "S3",
      [
        "Context / Business Value",
        "Technical Approach",
        "Acceptance Criteria",
        "Out of Scope",
      ].every(name => body.includes(`## ${name}\n`)),
      "three audiences and scope",
    ],
    [
      "S4",
      /Scenario:.*\n {2}Given .*\n {2}When .*\n {2}Then /.test(body),
      "Gherkin concrete proposal",
    ],
  ];
}

/** Runtime and repository scope retain the actual configured main mapping. */
function runtimeChecks(body, config, policy, evidence) {
  return [
    [
      "S8",
      body.includes(
        `Assumption: ${environment(config)} — remote default branch main`
      ),
      "runtime target derived",
    ],
    [
      "S9",
      body.includes(`Trusted maintainer: ${policy.maintainer}.`),
      "role and runtime credential source",
    ],
    [
      "S10",
      body.includes(`## Repository\n\n${policy.repository}\n`),
      "single configured repository",
    ],
    ["S11", body.includes("## Validation Journey\n"), "terminal journey"],
    [
      "S12",
      ["Business rules:", "Visual:", "Flow:", "API/data:"].every(axis =>
        body.includes(axis)
      ),
      "four authority axes",
    ],
    [
      "S13",
      Boolean(
        evidence.history.command &&
        evidence.history.result &&
        evidence.search.query &&
        Number.isInteger(evidence.search.total)
      ),
      "actual history and all-state search",
    ],
  ];
}

/** Declared evidence and fixed proposal fields must match actual prerequisite reads. */
function evidenceChecks(draft, body, proposal, expected, config, evidence) {
  return [
    [
      "S14",
      body.includes("[EVIDENCE: cli-output: npm-ci]") &&
        body.includes("[EVIDENCE: cli-output: rejected-publication]"),
      "typed success and error manifest",
    ],
    ["S15", draft.build_ready === true, "standalone Task without child work"],
    [
      "S18",
      body === expected.body && draft.title === expected.title,
      "complete fixed proposal and stateless recipe",
    ],
    [
      "S19",
      body.includes(
        `Derived from: Target Backend Environment ${environment(config)} via .lisa.config.json deploy.branches`
      ),
      "actual main mapping",
    ],
    ["F1", evidence.labels.includes("type:Task"), "Task label exists"],
    [
      "F4",
      expected.labels.every(label => evidence.labels.includes(label)),
      "priority and configured readiness exist",
    ],
    [
      "F5",
      evidence.main === proposal.parent &&
        proposal.updates.every(update =>
          evidence.registry.some(
            item => item.name === update.name && item.version === update.to
          )
        ),
      "actual base and selected registry versions",
    ],
  ];
}

/** These gates validate the bounded Task semantics, independently of API storage. */
export function qualityGates(draft, proposal, policy, config, evidence) {
  const expected = buildDraft(proposal, policy, config, evidence);
  const body = draft.body ?? "";
  const checks = [
    ...coreChecks(draft, body, policy),
    ...runtimeChecks(body, config, policy, evidence),
    ...evidenceChecks(draft, body, proposal, expected, config, evidence),
  ];
  required(
    checks.every(([, passed]) => passed),
    "fixed Task quality gate failed"
  );
  const gates = checks.map(([id, , reason]) => ({
    id,
    verdict: "PASS",
    reason,
  }));
  for (const [id, reason] of [
    ["S5", "not Bug"],
    ["S6", "not Spike"],
    ["S7", "standalone build-ready Task"],
    ["S16", "no PRD lineage"],
    ["S17", "not Improvement"],
    ["S20", "no existing red-before-green control"],
    ["F2", "no parent declared"],
    ["F3", "no linked issue declared"],
  ])
    gates.push({ id, verdict: "N/A", reason });
  return gates;
}
