import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  parseLearningsFile,
  renderLearningsFile,
} from "../../../src/core/learnings-writer.js";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "all",
  "create-only",
  ".claude",
  "rules",
  "PROJECT_LEARNINGS.md"
);

describe("project learnings create-only template", () => {
  it("is the canonical executable empty learnings document", async () => {
    const template = await readFile(TEMPLATE_PATH, "utf8");

    expect(template).toBe(renderLearningsFile([]));
    expect(parseLearningsFile(template)).toEqual([]);
  });
});
