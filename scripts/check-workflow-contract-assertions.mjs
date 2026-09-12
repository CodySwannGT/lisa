#!/usr/bin/env node
/**
 * Deterministic gate that every Lisa reusable workflow carries a staleness
 * assertion, and that every shipped caller template is seeded with it
 * (CodySwannGT/lisa#3698).
 *
 * ## The defect
 *
 * Every consumer reference to a Lisa reusable workflow tracks `@main` by owner
 * ruling. One push here changes what gates — and what ships — in every
 * downstream repository simultaneously, with no pull request, no review and no
 * record in those repositories. That is intended, and it removed pinning as a
 * mitigation without putting anything in its place:
 *
 *   **a consumer silently receives a behaviour change, or silently receives
 *   nothing, and has no signal either way.**
 *
 * An unchanged workflow and a rewritten one produce identical silence. It is
 * also why an audit cannot reproduce itself: an investigation that fetches
 * `@main` afterwards is reading a different artifact than the run it is
 * investigating, and cannot tell.
 *
 * ## What is asserted, and what deliberately is not
 *
 * Not the ref. A staleness check that pins a tag, a SHA or a tree hash goes red
 * on every legitimate upstream change, and a check that is red for good reasons
 * is disabled within a week — the staleness check becomes the staleness
 * problem. What a caller depends on is the CONTRACT: the inputs it passes and
 * the behaviour it relies on. So each reusable declares a contract MAJOR, each
 * caller is seeded with the major it was written against, and the workflow
 * compares the two at run time. A compatible change stays green, because
 * receiving compatible changes is the whole point of tracking `@main`; only a
 * declared break speaks up, naming both numbers.
 *
 * ## Why this gate exists on top of the run-time assertion
 *
 * The assertion and the `uses:` line are one unit. A template that takes the
 * reference and drops the assertion is back to silent staleness and looks
 * perfectly healthy doing it, so the two must not be separable by copy-paste.
 * This gate is the thing that refuses that separation, and it is the reason the
 * run-time half can afford to be non-fatal when a caller declares nothing.
 *
 * Local `./.github/workflows/...` callers inside this repository are
 * deliberately exempt: a local reference resolves at the same commit as its
 * caller and so cannot be stale. Requiring the assertion there would be a check
 * that could not fail.
 *
 * Determinism: no network, no clock, no randomness. The template list comes
 * from `git ls-files`, so the gate sees exactly what a release would carry.
 *
 * CLI:
 *   node scripts/check-workflow-contract-assertions.mjs [--root <dir>] [--json]
 *
 * Exit codes:
 *   0 — every reusable is registered and asserts, every caller template is
 *       seeded with the current major.
 *   1 — ≥1 finding.
 *   2 — NOT DETERMINED: the registry or the canonical assertion body could not
 *       be read, or the scan discovered zero reusable workflows or zero caller
 *       templates. A gate that could not look must not report that it looked.
 *
 * @module scripts/check-workflow-contract-assertions
 */
import yaml from "js-yaml";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Where the declared majors live. */
export const REGISTRY_REL = ".github/reusable-workflow-contracts.json";

/** The single source of truth for the inlined assertion body. */
export const CANONICAL_REL = "scripts/workflow-contract-assertion.sh";

/** The input a caller passes and the workflow compares. */
export const INPUT_NAME = "expected_workflow_contract_major";

/** The job every covered reusable carries. */
export const JOB_ID = "workflow_contract";

/** `<lane>/<mode>/.github/workflows/<name>.yml` — a SHIPPED caller template. */
const TEMPLATE_RE = /^[^/]+\/[^/]+\/\.github\/workflows\/[^/]+\.ya?ml$/;

/** `CodySwannGT/lisa/.github/workflows/<file>@<ref>`. */
const REMOTE_USES_RE =
  /^CodySwannGT\/lisa\/\.github\/workflows\/([\w.-]+\.ya?ml)@\S+$/;

/** Max bytes of `git ls-files` output. */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Raised for an invalid invocation or a state the gate cannot judge. */
export class UsageError extends Error {}

/**
 * Parse a workflow file, returning `null` when it is not a mapping.
 *
 * @param {string} file - absolute path.
 * @returns {Record<string, unknown> | null} the parsed document.
 */
function loadWorkflow(file) {
  const document = yaml.load(fs.readFileSync(file, "utf8"));
  return document !== null && typeof document === "object" ? document : null;
}

/**
 * The `workflow_call` block of a parsed workflow, or `null` when the workflow
 * is not reusable.
 *
 * @param {Record<string, unknown> | null} document - a parsed workflow.
 * @returns {Record<string, unknown> | null} the `workflow_call` mapping.
 */
export function workflowCallOf(document) {
  const triggers = document?.on;
  if (triggers === null || typeof triggers !== "object") return null;
  const call = triggers.workflow_call;
  if (call === undefined) return null;
  return call !== null && typeof call === "object" ? call : {};
}

/**
 * Validate one registry entry's shape.
 *
 * @param {unknown} entry - the value stored for a workflow.
 * @returns {string | null} a complaint, or `null` when the entry is well formed.
 */
export function describeEntryProblem(entry) {
  if (entry === null || typeof entry !== "object") {
    return "entry is not an object";
  }
  const hasMajor = Object.hasOwn(entry, "major");
  const hasUncovered = Object.hasOwn(entry, "uncovered");
  if (hasMajor === hasUncovered) {
    return "entry must carry exactly one of `major` or `uncovered`";
  }
  if (hasUncovered) {
    return typeof entry.uncovered === "string" && entry.uncovered.trim() !== ""
      ? null
      : "`uncovered` must be a non-empty reason, so a gap is recorded rather than inherited";
  }
  return Number.isInteger(entry.major) && entry.major >= 1
    ? null
    : "`major` must be an integer >= 1";
}

/**
 * Findings about ONE covered reusable workflow: does it declare the input, and
 * does it carry the assertion job with the canonical body?
 *
 * @param {{ file: string, major: number, document: Record<string, unknown>, canonical: string }} subject
 *   the workflow under inspection.
 * @returns {string[]} complaints, empty when the workflow is conformant.
 */
export function auditReusable(subject) {
  const { canonical, document, file, major } = subject;
  const problems = [];
  const declared = workflowCallOf(document)?.inputs?.[INPUT_NAME];
  if (declared === undefined) {
    problems.push(`does not declare the \`${INPUT_NAME}\` input`);
  } else if (declared.type !== "string" || declared.default !== "") {
    problems.push(
      `\`${INPUT_NAME}\` must be \`type: string\` with \`default: ''\` so an absent value is distinguishable from a declared one`
    );
  }
  const job = document?.jobs?.[JOB_ID];
  if (job === undefined) {
    problems.push(
      `has no \`${JOB_ID}\` job, so a caller is never told anything`
    );
    return problems;
  }
  const step = (job.steps ?? []).find(
    candidate => candidate?.env?.DECLARED_MAJOR !== undefined
  );
  if (step === undefined) {
    problems.push(`\`${JOB_ID}\` has no step declaring \`DECLARED_MAJOR\``);
    return problems;
  }
  if (String(step.env.DECLARED_MAJOR) !== String(major)) {
    problems.push(
      `declares major ${step.env.DECLARED_MAJOR} but ${REGISTRY_REL} records ${major} — bump both in one commit`
    );
  }
  if (step.env.WORKFLOW_FILE !== file) {
    problems.push(
      `names \`${step.env.WORKFLOW_FILE}\` in WORKFLOW_FILE; a mismatch sends a reader to the wrong file`
    );
  }
  if (step.env.EXPECTED_MAJOR !== `\${{ inputs.${INPUT_NAME} }}`) {
    problems.push(
      `EXPECTED_MAJOR must read \`\${{ inputs.${INPUT_NAME} }}\`, otherwise the comparison is against something the caller never passed`
    );
  }
  if (String(step.run ?? "").trimEnd() !== canonical.trimEnd()) {
    problems.push(
      `the inlined assertion has drifted from ${CANONICAL_REL}; copy it back verbatim`
    );
  }
  return problems;
}

/**
 * Every remote Lisa reference in one caller template, with the value seeded
 * beside it.
 *
 * @param {Record<string, unknown> | null} document - a parsed caller template.
 * @returns {{ job: string, target: string, seeded: unknown }[]} one per reference.
 */
export function callerReferences(document) {
  const jobs = document?.jobs;
  if (jobs === null || typeof jobs !== "object") return [];
  const references = [];
  for (const [job, definition] of Object.entries(jobs)) {
    const uses = definition?.uses;
    if (typeof uses !== "string") continue;
    const match = REMOTE_USES_RE.exec(uses.trim());
    if (match === null) continue;
    references.push({
      job,
      seeded: definition?.with?.[INPUT_NAME],
      target: match[1],
    });
  }
  return references;
}

/**
 * List every tracked file in `root`, relative to it.
 *
 * @param {string} root - the repository root.
 * @returns {string[]} tracked paths.
 */
function listTrackedFiles(root) {
  let stdout;
  try {
    stdout = boundedExecFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(
      `could not list tracked files in ${root}: ${error.message}`
    );
  }
  return stdout.split("\0").filter(entry => entry !== "");
}

/**
 * Parse argv into resolved options.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ root: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  let root = null;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      index += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, root: path.resolve(root ?? REPO_ROOT) };
}

/**
 * Read the registry and the canonical assertion body, or refuse.
 *
 * @param {string} root - the repository root.
 * @returns {{ registry: Record<string, unknown>, canonical: string }} the inputs.
 */
function readContract(root) {
  let registry;
  try {
    registry = JSON.parse(
      fs.readFileSync(path.join(root, REGISTRY_REL), "utf8")
    );
  } catch (error) {
    throw new UsageError(`could not read ${REGISTRY_REL}: ${error.message}`);
  }
  if (registry?.workflows === null || typeof registry?.workflows !== "object") {
    throw new UsageError(`${REGISTRY_REL} has no \`workflows\` mapping`);
  }
  let canonical;
  try {
    canonical = fs.readFileSync(path.join(root, CANONICAL_REL), "utf8");
  } catch (error) {
    throw new UsageError(`could not read ${CANONICAL_REL}: ${error.message}`);
  }
  return { canonical, registry };
}

/**
 * Compare the registry against the reusable workflows on disk.
 *
 * @param {{ root: string, registry: Record<string, unknown>, canonical: string }} context
 *   the resolved inputs.
 * @returns {{ findings: { where: string, problem: string }[], reusables: string[] }}
 *   findings plus the discovered reusable filenames.
 */
function auditReusables(context) {
  const { canonical, registry, root } = context;
  const directory = path.join(root, ".github", "workflows");
  const findings = [];
  const reusables = [];
  const entries = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  for (const name of entries.filter(file => /\.ya?ml$/.test(file)).sort()) {
    const document = loadWorkflow(path.join(directory, name));
    if (workflowCallOf(document) === null) continue;
    reusables.push(name);
    const entry = registry.workflows[name];
    if (entry === undefined) {
      findings.push({
        problem: `reusable workflow is absent from ${REGISTRY_REL}; record a \`major\` for it, or an \`uncovered\` reason it cannot carry one`,
        where: name,
      });
      continue;
    }
    const problem = describeEntryProblem(entry);
    if (problem !== null) {
      findings.push({ problem: `${REGISTRY_REL}: ${problem}`, where: name });
      continue;
    }
    if (entry.uncovered !== undefined) continue;
    for (const complaint of auditReusable({
      canonical,
      document,
      file: name,
      major: entry.major,
    })) {
      findings.push({ problem: complaint, where: name });
    }
  }
  for (const name of Object.keys(registry.workflows)) {
    if (!reusables.includes(name)) {
      findings.push({
        problem: `${REGISTRY_REL} records this workflow, but no reusable workflow of that name exists — a registry entry for nothing hides the absence of a real one`,
        where: name,
      });
    }
  }
  return { findings, reusables };
}

/**
 * Check every shipped caller template is seeded beside its `uses:` line.
 *
 * @param {{ root: string, registry: Record<string, unknown>, templates: readonly string[] }} context
 *   the resolved inputs.
 * @returns {{ findings: { where: string, problem: string }[], checked: number }}
 *   findings plus the number of references examined.
 */
function auditTemplates(context) {
  const { registry, root, templates } = context;
  const findings = [];
  let checked = 0;
  for (const file of templates) {
    const document = loadWorkflow(path.join(root, file));
    for (const reference of callerReferences(document)) {
      const entry = registry.workflows[reference.target];
      if (entry === undefined || entry.major === undefined) continue;
      checked += 1;
      const expected = String(entry.major);
      if (reference.seeded === undefined) {
        findings.push({
          problem: `job \`${reference.job}\` calls ${reference.target} but seeds no \`${INPUT_NAME}\`. The reference and the assertion are one unit: without it the run cannot tell a behaviour change from silence. Add \`${INPUT_NAME}: '${expected}'\` to its \`with:\` block`,
          where: file,
        });
      } else if (String(reference.seeded) !== expected) {
        findings.push({
          problem: `job \`${reference.job}\` seeds ${reference.target} with major ${reference.seeded}, but the workflow now declares ${expected}. A shipped template must hand a NEW consumer the current major`,
          where: file,
        });
      }
    }
  }
  return { checked, findings };
}

/**
 * Render the human-readable report.
 *
 * @param {{ findings: readonly { where: string, problem: string }[], summary: Record<string, number> }} report
 *   the report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  const { summary } = report;
  if (report.findings.length === 0) {
    return `✓ ${summary.reusables} reusable workflow(s) declare a contract major; ${summary.checked} caller reference(s) across ${summary.templates} template(s) are seeded with it`;
  }
  return [
    ...report.findings.map(
      finding => `✗ ${finding.where}\n    ${finding.problem}`
    ),
    "",
    "A reusable workflow tracked at @main changes under every consumer with no",
    "pull request in their repository. The contract major is the only thing",
    "telling them a compatible change from a breaking one — and a caller that",
    "carries the reference without the assertion is back to silence while",
    "looking perfectly healthy.",
  ].join("\n");
}

/**
 * Run the gate. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams.
 * @returns {number} exit code (0 clean, 1 finding, 2 not determined).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let report;
  let json = false;
  try {
    const opts = parseArgs(argv);
    json = opts.json;
    if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
      throw new UsageError(`--root is not a directory: ${opts.root}`);
    }
    const { canonical, registry } = readContract(opts.root);
    const reusable = auditReusables({ canonical, registry, root: opts.root });
    if (reusable.reusables.length === 0) {
      throw new UsageError(
        `no reusable workflows found under ${opts.root}/.github/workflows — refusing to report a clean run for a scan that examined nothing`
      );
    }
    const templates = listTrackedFiles(opts.root).filter(file =>
      TEMPLATE_RE.test(file)
    );
    if (templates.length === 0) {
      throw new UsageError(
        `no caller templates found under ${opts.root} — expected paths like expo/create-only/.github/workflows/*.yml. Refusing to report a clean run for a scan that examined nothing`
      );
    }
    const caller = auditTemplates({ registry, root: opts.root, templates });
    report = {
      findings: [...reusable.findings, ...caller.findings],
      schemaVersion: 1,
      summary: {
        checked: caller.checked,
        findings: reusable.findings.length + caller.findings.length,
        reusables: reusable.reusables.length,
        templates: templates.length,
      },
    };
  } catch (error) {
    err.write(`NOT DETERMINED: ${error.message}\n`);
    return 2;
  }
  out.write(
    `${json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  return report.findings.length === 0 ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
