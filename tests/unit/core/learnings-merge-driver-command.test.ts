/**
 * Reading back a registered learnings merge-driver command (#4640).
 *
 * Doctor's verdict depends on recognising the pre-#4640 absolute form, so a
 * legacy registration written on Windows — `'C:\…\node.exe' 'C:\…\index.js'`
 * — must classify as absolute just like a POSIX one.
 */
import { describe, expect, it } from "vitest";
import {
  buildPortableLearningsMergeDriverCommand,
  classifyLearningsDriverCommand,
} from "../../../src/core/learnings-merge-driver-command.js";

const PLACEHOLDERS =
  "merge-learnings --base %O --ours %A --theirs %B --path %P";

describe("classifyLearningsDriverCommand", () => {
  it("recognises a POSIX absolute registration", () => {
    expect(
      classifyLearningsDriverCommand(
        `'/usr/bin/node' '/w/node_modules/@codyswann/lisa/dist/index.js' ${PLACEHOLDERS}`
      )
    ).toEqual({
      kind: "absolute",
      paths: ["/usr/bin/node", "/w/node_modules/@codyswann/lisa/dist/index.js"],
    });
  });

  it.each([
    ["backslash", "C:\\tools\\node.exe", "C:\\w\\lisa\\dist\\index.js"],
    ["forward slash", "D:/tools/node.exe", "D:/w/lisa/dist/index.js"],
  ])(
    "recognises a Windows drive-letter registration (%s)",
    (_, runtime, entry) => {
      expect(
        classifyLearningsDriverCommand(
          `'${runtime}' '${entry}' ${PLACEHOLDERS}`
        )
      ).toEqual({ kind: "absolute", paths: [runtime, entry] });
    }
  );

  it("reads the entry back from a portable command, undoing escapes", () => {
    const entry = "./100%A/it's/node_modules/@codyswann/lisa/dist/index.js";
    expect(
      classifyLearningsDriverCommand(
        buildPortableLearningsMergeDriverCommand(entry)
      )
    ).toEqual({ kind: "portable", entry });
  });

  it("does not judge a command Lisa did not write", () => {
    expect(classifyLearningsDriverCommand("lisa merge-learnings")).toEqual({
      kind: "other",
    });
  });
});
