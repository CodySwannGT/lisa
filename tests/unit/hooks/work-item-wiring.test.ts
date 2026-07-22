import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(path.resolve(file), "utf8");

describe("work-item Git enforcement wiring", () => {
  it.each([".husky", "typescript/copy-contents/.husky"])(
    "%s prepares, validates, and checks pushes through the shared validator",
    directory => {
      const prepare = path.join(directory, "prepare-commit-msg");
      expect(statSync(prepare).mode & 0o111).not.toBe(0);
      expect(read(prepare)).toContain(
        'node "$WORK_ITEM_SCRIPT" prepare-commit-msg "$@"'
      );
      expect(read(path.join(directory, "commit-msg"))).toContain(
        'node "$WORK_ITEM_SCRIPT" validate-commit "$COMMIT_MSG_FILE"'
      );
      expect(read(path.join(directory, "pre-push"))).toContain(
        'node "$WORK_ITEM_SCRIPT" validate-push "${1:-origin}"'
      );
      expect(read(path.join(directory, "commit-msg"))).not.toContain(
        "Auto-appended Jira key"
      );
    }
  );

  it("ships the validator to Lisa itself and downstream projects", () => {
    expect(read("scripts/lisa-work-item.mjs")).toContain(
      "../all/copy-overwrite/scripts/lisa-work-item.mjs"
    );
    const installed = read("all/copy-overwrite/scripts/lisa-work-item.mjs");
    for (const command of [
      "bind",
      "current",
      "attach-branch",
      "clear",
      "prepare-commit-msg",
      "validate-commit",
      "validate-push",
      "validate-pr",
    ]) {
      expect(installed).toContain(`command === "${command}"`);
    }
    expect(installed).toContain("WORK_ITEM_TRACKING_OK");
    expect(installed).not.toContain("await main()");
  });

  it("gives Rails the same gates and a single stdin consumer", () => {
    const lefthook = read("rails/copy-overwrite/lefthook.yml");
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs prepare-commit-msg {1} {2} {3}"
    );
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs validate-commit {1}"
    );
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs validate-push {1}"
    );
    expect(lefthook.match(/use_stdin: true/g)).toHaveLength(1);
  });
});
