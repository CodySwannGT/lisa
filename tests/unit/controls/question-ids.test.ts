/**
 * The ids of the questions an audit asks.
 *
 * A later step cites an answered question by its id, and a re-run must find
 * the question it asked before. Neither works unless the id is derived rather
 * than chosen, so these pin the two ways an id is formed and that nothing else
 * reads as one (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import {
  HOSTING_PLATFORM_QUESTION_ID,
  REPOSITORY_ADMINISTRATOR_QUESTION_ID,
  SETUP_QUESTIONS,
  SETUP_QUESTION_IDS,
  parseQuestionId,
  requirementQuestionId,
} from "../../../src/controls/question-ids.js";
import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import { FIRST, PART_FIRST } from "./audit-report-facts.js";

describe("a question about a requirement", () => {
  it("has an id made of the requirement and the scope of its finding", () => {
    expect(requirementQuestionId("AC1.7", ".")).toBe("AC1.7@.");
    expect(requirementQuestionId("SI7", "services/api")).toBe(
      "SI7@services/api"
    );
  });

  it("gets the same id every time it is formed", () => {
    expect(requirementQuestionId(PART_FIRST, "api")).toBe(
      requirementQuestionId(PART_FIRST, "api")
    );
  });

  it("reads back as the requirement and the scope it was formed from", () => {
    expect(parseQuestionId(requirementQuestionId(FIRST, "."))).toEqual({
      kind: "requirement",
      criterion: FIRST,
      scope: ".",
    });
  });

  it.each(["packages/@scoped/tool", "my folder", "données"])(
    "keeps the folder %s whole",
    scope => {
      expect(parseQuestionId(requirementQuestionId("SI7", scope))).toEqual({
        kind: "requirement",
        criterion: "SI7",
        scope,
      });
    }
  );
});

describe("a question about how the repository is set up", () => {
  it("is one of a short closed list that starts with the tracker", () => {
    expect(SETUP_QUESTION_IDS).toEqual([
      TRACKER_QUESTION_ID,
      HOSTING_PLATFORM_QUESTION_ID,
      REPOSITORY_ADMINISTRATOR_QUESTION_ID,
    ]);
  });

  it("says in words what each one asks", () => {
    expect(
      SETUP_QUESTIONS.filter(question => question.asks.trim() === "")
    ).toEqual([]);
  });

  it.each(SETUP_QUESTION_IDS)("reads %s as a setup question", id => {
    expect(parseQuestionId(id)).toEqual({ kind: "setup", id });
  });
});

describe("anything else", () => {
  it.each([
    { name: "a name an agent made up", id: "which-tracker" },
    { name: "a requirement with no scope", id: "AC1.7" },
    { name: "a requirement with an empty scope", id: "AC1.7@" },
    { name: "a scope with no requirement", id: "@api" },
    { name: "something that is not a requirement id", id: "tracker@." },
    { name: "a lower-case requirement id", id: "ac1.7@." },
    { name: "a scope padded with spaces", id: "AC1.7@ api" },
    { name: "a scope that runs over two lines", id: "AC1.7@api\nweb" },
    { name: "an empty id", id: "" },
    { name: "a setup id in another case", id: "Tracker" },
  ])("does not read $name as a question id", ({ id }) => {
    expect(parseQuestionId(id)).toBeNull();
  });
});
