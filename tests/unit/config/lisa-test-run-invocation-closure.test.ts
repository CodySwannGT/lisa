/** Cross-platform process-snapshot parsing regression coverage. */
import { describe, expect, it } from "vitest";

import { parseCompleteProcessSnapshot } from "../../helpers/lisa-test-run-invocation-closure.js";

const LINUX_KERNEL_ROW =
  "    2     0     0     0 Sun Aug 23 05:19:31 2026 [kthreadd]";

describe("complete process snapshot parsing", () => {
  it("retains a valid Linux kernel row with no process group or session", () => {
    expect(parseCompleteProcessSnapshot(`${LINUX_KERNEL_ROW}\n`)).toEqual([
      {
        pid: 2,
        ppid: 0,
        pgid: 0,
        sid: 0,
        lstart: "Sun Aug 23 05:19:31 2026",
        command: "[kthreadd]",
      },
    ]);
  });

  it.each([
    ["zero PID", "0 0 0 0 Sun Aug 23 05:19:31 2026 [kthreadd]"],
    ["negative parent", "2 -1 0 0 Sun Aug 23 05:19:31 2026 [kthreadd]"],
    ["negative group", "2 0 -1 0 Sun Aug 23 05:19:31 2026 [kthreadd]"],
    ["negative session", "2 0 0 -1 Sun Aug 23 05:19:31 2026 [kthreadd]"],
    ["nonnumeric PID", "two 0 0 0 Sun Aug 23 05:19:31 2026 [kthreadd]"],
    ["missing command", "2 0 0 0 Sun Aug 23 05:19:31 2026"],
  ])("rejects a malformed row with %s", (_description, row) => {
    expect(() => parseCompleteProcessSnapshot(`${row}\n`)).toThrow(
      "Process snapshot contains a malformed row"
    );
  });
});
