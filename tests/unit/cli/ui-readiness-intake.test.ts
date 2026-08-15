import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const UI_PATH = path.resolve(import.meta.dirname, "../../../ui/index.html");
const SPEC_PATH = path.resolve(
  import.meta.dirname,
  "../../../spec/tasc-0.1-draft.md"
);
const MARKDOWN_PATH = path.resolve(
  import.meta.dirname,
  "../../../docs/agentic-readiness-questionnaire.md"
);

let html = "";
let readiness = "";
let renderer = "";
let spec = "";
let markdown = "";

beforeAll(async () => {
  html = await readFile(UI_PATH, "utf8");
  spec = await readFile(SPEC_PATH, "utf8");
  markdown = await readFile(MARKDOWN_PATH, "utf8");
  const readinessStart = html.indexOf("DATA.sections.readiness = {");
  const readinessEnd = html.indexOf(
    "/* ---------------------------------- General",
    readinessStart
  );
  const rendererStart = html.indexOf("const INTAKE_UNSET");
  const rendererEnd = html.indexOf("/* The staff picker:", rendererStart);

  expect(readinessStart).toBeGreaterThan(-1);
  expect(readinessEnd).toBeGreaterThan(readinessStart);
  expect(rendererStart).toBeGreaterThan(-1);
  expect(rendererEnd).toBeGreaterThan(rendererStart);
  readiness = html.slice(readinessStart, readinessEnd);
  renderer = html.slice(rendererStart, rendererEnd);
});

describe("Readiness intake control model", () => {
  it("keeps one conversational questionnaire with 122 control questions", () => {
    const questions = Array.from(readiness.matchAll(/\n[ \t]+q: /gu));

    expect(questions).toHaveLength(122);
    expect(html.match(/DATA\.sections\.readiness\s*=/gu)).toHaveLength(1);
  });

  it.each([
    "What durable scheduler keeps agents moving when nobody prompts them?",
    "How are model, effort, and tool configuration assigned by task class?",
    "Does every user-facing requirement and critical state map to an executable end-to-end journey?",
    "How is end-to-end proof tiered without weakening the release gate?",
    "When an agent crosses repositories, how are the destination repository's controls activated?",
    "Is every implemented screen mechanically compared with its source design?",
    "Which authoritative gates run before work reaches CI?",
    "When a deployment fails before reaching users, what heals it?",
  ])("adds the recommended conversational control: %s", question => {
    expect(readiness).toContain(`q: "${question}"`);
  });

  it("strengthens rejected-work handling into bounded automatic healing", () => {
    expect(readiness).toContain(
      'q: "When CI or another gate rejects agent output, what happens next?"'
    );
    expect(readiness).toContain(
      '"Bounded automatic repair, rerun, and independent verification"'
    );
    expect(readiness).toContain("decision-ready escalation");
  });

  it("renders conversational copy first and formal control detail on demand", () => {
    expect(renderer).toContain('el("div", "intake-q", esc(item.q))');
    expect(renderer).toContain('el("details", "intake-control-detail")');
    expect(renderer).toContain('el("summary", "", "Control detail")');
    expect(renderer).toContain("item.formal");
    expect(renderer).toContain("item.evidence");
    expect(renderer).toMatch(/item\.criteria\s*\|\|\s*group\.criteria/u);
    expect(renderer.indexOf("intake-q")).toBeLessThan(
      renderer.indexOf("intake-control-detail")
    );
  });

  it("carries formal requirement and evidence fields on every new control", () => {
    const newControls = readiness
      .split("\n")
      .filter(line => line.includes('introduced: "0.7.0"'));

    expect(newControls).toHaveLength(8);
    expect(readiness.match(/\n[ \t]+formal:/gu)).toHaveLength(10);
    expect(readiness.match(/\n[ \t]+evidence:/gu)).toHaveLength(10);
  });

  it("keeps the reader-friendly Markdown projection synchronized", () => {
    const canonicalQuestions = Array.from(
      readiness.matchAll(/\n[ \t]+q: "([^"]+)"/gu),
      match => match[1]
    );
    const projectedQuestions = Array.from(
      markdown.matchAll(/^\d+\. (.+\?)$/gmu),
      match => match[1]
    );
    const projectedGroups = Array.from(
      markdown.matchAll(/^## (.+)$/gmu),
      match => match[1]
    );

    expect(projectedQuestions).toEqual(canonicalQuestions);
    expect(projectedGroups).toEqual([
      "The bottom line",
      "Credentials & access",
      "Where agents run",
      "The agent's program",
      "Work intake",
      "Correctness gates",
      "Security gates",
      "Agent attack surface",
      "Code health",
      "Design & UI",
      "Review & merge",
      "Ship & rollback",
      "Verify & acceptance",
      "Observe",
      "Operate & recover",
      "Governance & accountability",
    ]);
  });
});

describe("TASC coverage for the readiness additions", () => {
  it("adds outcome-level UI and UX fidelity criteria", () => {
    expect(spec).toContain("**UX4 Visual conformance.**");
    expect(spec).toContain("**UX5 Interaction conformance.**");
  });

  it.each([
    "bounded repair",
    "destination repository",
    "missed runs",
    "task class",
    "failed deployment",
  ])("names the strengthened normative obligation: %s", obligation => {
    expect(spec).toContain(obligation);
  });
});
