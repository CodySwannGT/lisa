/**
 * The room the prd-backlink fitting program holds for the coverage
 * comment's URL (CodySwannGT/lisa#4994).
 *
 * When the requirement-coverage list moves to a comment, the body names that
 * comment by its URL. The URL is not known until the comment is posted, so
 * the first run of the program has to hold room for it. It held a flat 150
 * characters. A repository with a long owner and name has a longer URL than
 * that, so the first run said `comment`, the comment was posted, and the
 * second run, now holding the real URL, said `too-large`: a comment on the
 * PRD and no body that names it.
 *
 * The program is lifted out of the shipped skill and run, as the rest of the
 * body-limit suite does.
 * @module tests/unit/controls/prd-backlink-github-comment-url-room
 */
import { describe, expect, it } from "vitest";

import {
  BODY_LIMIT,
  SOURCE_COPY,
  buildPrd,
  chars,
  liftProgram,
  runFit,
} from "../strategies/prd-backlink-github-body-limit-helpers.js";

/** An owner and a repository name as long as GitHub allows. */
const LONG_REPO = `${"o".repeat(39)}/${"r".repeat(100)}`;

/** The longest number an issue or a comment can be given. */
const LONGEST_NUMBER = "9".repeat(20);

/** A comment URL that repository really gives today. */
const REAL_URL = `https://github.com/${LONG_REPO}/issues/123456#issuecomment-4100200300`;

/** The longest comment URL that repository can ever give. */
const LONGEST_URL = `https://github.com/${LONG_REPO}/issues/${LONGEST_NUMBER}#issuecomment-${LONGEST_NUMBER}`;

/** A PRD size at which the coverage list is known to move to a comment. */
const KNOWN_SIZE = 48_000;

const PROGRAM = liftProgram(SOURCE_COPY);

/**
 * How long the body that names the comment is before the URL is written
 * into it, for the PRD of {@link KNOWN_SIZE}.
 */
const WITHOUT_URL =
  chars(
    runFit(PROGRAM, buildPrd(KNOWN_SIZE).standardBody, REAL_URL, LONG_REPO)
      .body ?? ""
  ) - chars(REAL_URL);

/**
 * Build the PRD whose comment-form body leaves exactly some room under
 * GitHub's limit before the URL is written into it.
 * @param room How many characters are left for the URL.
 * @returns The PRD body, standard section in place.
 */
const bodyWithRoom = (room: number): string =>
  buildPrd(KNOWN_SIZE + (BODY_LIMIT - room - WITHOUT_URL)).standardBody;

describe("the room held for the coverage comment's URL", () => {
  it("is measured on a PRD whose coverage list moves to a comment", () => {
    expect(WITHOUT_URL).toBeGreaterThan(0);
    expect(WITHOUT_URL).toBeLessThan(BODY_LIMIT);
  });

  it("is more than 150 characters for a repository with a long owner and name", () => {
    const body = bodyWithRoom(150);

    const first = runFit(PROGRAM, body, undefined, LONG_REPO);

    expect(chars(REAL_URL)).toBeGreaterThan(150);
    expect(first.form).toBe("too-large");
    expect(first.comment).toBeNull();
  });

  it("never lets a second run find no room after a first run had the comment posted", () => {
    const body = bodyWithRoom(150);

    const first = runFit(PROGRAM, body, undefined, LONG_REPO);
    const second = runFit(PROGRAM, body, REAL_URL, LONG_REPO);

    expect([first.form, second.form]).not.toEqual(["comment", "too-large"]);
  });

  it("is enough for the longest URL the repository can give", () => {
    const body = bodyWithRoom(chars(LONGEST_URL));

    const first = runFit(PROGRAM, body, undefined, LONG_REPO);
    const second = runFit(PROGRAM, body, LONGEST_URL, LONG_REPO);

    expect(first.form).toBe("comment");
    expect(second.form).toBe("comment");
    expect(chars(second.body ?? "")).toBe(BODY_LIMIT);
    expect(second.body).toContain(`(${LONGEST_URL})`);
  });

  it("is not held any longer once the URL is known", () => {
    const body = bodyWithRoom(chars(REAL_URL));

    expect(runFit(PROGRAM, body, REAL_URL, LONG_REPO).form).toBe("comment");
  });
});
