import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETUP_READINESS_CHECKS } from "../../../src/cli/ui-setup-readiness.js";

describe("Setup readiness renderer source", () => {
  it("maps every checklist row exactly once without hardcoded truth", async () => {
    const html = await readFile(
      path.resolve(import.meta.dirname, "../../../ui/index.html"),
      "utf8"
    );
    const start = html.indexOf("DATA.sections.setup = {");
    const end = html.indexOf("const AUTOMATION_COL", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const setup = html.slice(start, end);
    const checks = Array.from(
      setup.matchAll(/\bid: "(setup\.[^"]+)"/gu),
      match => match[1]
    );

    expect(checks).toEqual(SETUP_READINESS_CHECKS);
    expect(setup).not.toMatch(/\b(?:done|why):/u);
    expect(html).not.toContain(
      "read-only: setup checklist state has not shipped yet"
    );
  });
});
