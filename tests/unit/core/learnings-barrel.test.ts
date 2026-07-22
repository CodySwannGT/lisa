/**
 * Guards the `@codyswann/lisa/learnings` public surface against doc/code
 * drift: the lisa-persist-learning skill documents runnable snippets that
 * call these symbols off the barrel (e.g. `m.readProjectConfig(...)` then
 * `m.resolveProjectLearningsFile(...)`), so a symbol missing from
 * src/core/learnings.ts is a runtime TypeError in every host project even
 * though each function exists on its own module.
 */
import { describe, expect, it } from "vitest";
import {
  buildUpstreamAttributionIssueBody,
  confirmLearningEntry,
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
  projectLearnings,
  readProjectConfig,
  resolveProjectLearningsFile,
} from "../../../src/core/learnings.js";

/** Every symbol the skill's documented snippets invoke on the barrel. */
const REQUIRED_BARREL_FUNCTIONS = [
  ["readProjectConfig", readProjectConfig],
  ["resolveProjectLearningsFile", resolveProjectLearningsFile],
  ["parseLearningsFile", parseLearningsFile],
  ["persistLearningEntry", persistLearningEntry],
  ["persistConsolidatedLearning", persistConsolidatedLearning],
  ["confirmLearningEntry", confirmLearningEntry],
  ["projectLearnings", projectLearnings],
  ["buildUpstreamAttributionIssueBody", buildUpstreamAttributionIssueBody],
] as const;

describe("learnings barrel surface", () => {
  it.each(REQUIRED_BARREL_FUNCTIONS)(
    "exposes %s as a callable export",
    (_name, fn) => {
      expect(typeof fn).toBe("function");
    }
  );
});
