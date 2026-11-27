/**
 * `clear` removes the finished ticket's context, driven in-process
 * (CodySwannGT/lisa#5199).
 *
 * The subprocess suite in `tests/unit/secrets/work-item-clear-context.test.ts`
 * proves the whole route, from clear through the next prepare. These cases pin
 * each decision `clear` makes about the file, in-process, so the mutation gate
 * can see which assertion covers which line.
 * @module tests/unit/scripts/work-item-cli-clear-context
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  bindTo,
  cleanupFixtures,
  cleanupTemplates,
  cli,
  offlineFixture,
  OTHER_REF,
  REF,
  stateFile,
} from "../../support/work-item-cli.js";

const CONTEXT = ".lisa/work-item-context.md";
const HEADER = "<!-- lisa-required-access:v1\n";
const CLEARED = "work-item binding cleared";
const REMOVED = `${CLEARED}; removed ${CONTEXT}`;

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A fixture holding a context file with the given text.
 * @param text - The context file's full text.
 * @param bound - The ticket to bind, or null to leave it unbound.
 * @returns The fixture and the context file's path.
 */
function withContext(text: string, bound: string | null = REF) {
  const fixture = offlineFixture();
  const file = path.join(fixture.root, CONTEXT);
  if (bound !== null) bindTo(fixture, bound);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { fixture, file };
}

/**
 * A context whose requirements header names a ticket.
 * @param ref - The value of `work_item_ref`.
 * @returns The context text.
 */
const naming = (ref: unknown) =>
  `${HEADER}${JSON.stringify({ work_item_ref: ref, tracker: "github" })}\n-->\n# Body\n`;

describe("clear and the work-item context", () => {
  it("removes the bound ticket's context and names it", () => {
    const { fixture, file } = withContext(naming(REF));
    expect(cli(fixture, ["clear"]).stdout).toBe(`${REMOVED} (${REF})`);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(stateFile(fixture))).toBe(false);
  });

  it("keeps another ticket's context and says whose it is", () => {
    const { fixture, file } = withContext(naming(OTHER_REF));
    expect(cli(fixture, ["clear"]).stdout).toBe(
      `${CLEARED}; kept ${CONTEXT}, which holds the context of ${OTHER_REF}, not of ${REF}`
    );
    expect(existsSync(file)).toBe(true);
    expect(existsSync(stateFile(fixture))).toBe(false);
  });

  it("keeps a named context when nothing is bound", () => {
    const { fixture, file } = withContext(naming(REF), null);
    expect(cli(fixture, ["clear"]).stdout).toBe(
      `${CLEARED}; kept ${CONTEXT}, which holds the context of ${REF}, not of a bound ticket`
    );
    expect(existsSync(file)).toBe(true);
  });

  it("treats an unreadable binding as no binding, and still clears it", () => {
    const { fixture, file } = withContext(naming(REF));
    writeFileSync(stateFile(fixture), "{not json");
    expect(cli(fixture, ["clear"]).stdout).toContain("not of a bound ticket");
    expect(existsSync(stateFile(fixture))).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it("removes a context whose owner no header names", () => {
    for (const text of [
      "Notes with no header.\n",
      "Notes\n-->\nwith a terminator but no header.\n",
      `${HEADER}{"work_item_ref":"${OTHER_REF}"}`,
      `${HEADER}{not json\n-->\n`,
      naming(42),
      `${HEADER}null\n-->\n`,
    ]) {
      const { fixture, file } = withContext(text);
      expect(cli(fixture, ["clear"]).stdout, text).toBe(REMOVED);
      expect(existsSync(file), text).toBe(false);
    }
  });

  it("keeps the binding when the context cannot be removed, so a retry still knows whose it is", () => {
    const { fixture, file } = withContext(naming(REF));
    chmodSync(path.dirname(file), 0o500);
    try {
      const refused = cli(fixture, ["clear"]);
      expect(refused.exitCode).not.toBeUndefined();
      expect(existsSync(stateFile(fixture))).toBe(true);
      expect(existsSync(file)).toBe(true);
    } finally {
      chmodSync(path.dirname(file), 0o700);
    }
    expect(cli(fixture, ["clear"]).stdout).toBe(`${REMOVED} (${REF})`);
    expect(existsSync(stateFile(fixture))).toBe(false);
  });

  it("says only that the binding is cleared when there is no context", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    expect(cli(fixture, ["clear"]).stdout).toBe(CLEARED);
  });
});
