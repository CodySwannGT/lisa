/**
 * `block-direct-issue-create.sh` must not read a payload held as TEST DATA as
 * a payload about to be SUBMITTED.
 *
 * The guard follows a command into the file it executes — correctly — and then
 * classifies on a coarse conjunction: a tracker endpoint and a creation verb
 * in the same file. That conjunction cannot tell the two apart, so a helper
 * that assembles test fixtures and holds a mutation body as a string constant
 * it writes to a fixture file was refused as "a tracker creation inside
 * <path>" (CodySwannGT/lisa#3943). It submits nothing.
 *
 * The discriminator was the LITERAL, not the behaviour: the same helper
 * rewritten to slice the payload out of an existing file was allowed. So the
 * behaviour is what is asked about now — EGRESS. A file can only file an issue
 * if it can hand its bytes to another host or another process.
 *
 * ## The controls are the ticket
 *
 * Permitting data-shaped payloads by weakening the conjunction would reopen
 * the fail-open that following-into-files was added to close, so every
 * acceptance case here is paired with a rejection control, and "assembled at
 * runtime" gets its own — that is the obvious way to dress a submission as
 * data. The exemption also demands POSITIVE evidence of a local write, so a
 * submitter that happens to write a log file alongside its request is still
 * refused; that pairing is asserted rather than assumed.
 * @module tests/unit/hooks/block-direct-issue-create-inert-payload
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A Linear-tracked project, whose build-ready role is a workflow state. */
const LINEAR_CONFIG = {
  tracker: "linear",
  linear: { workflow: { ready: "Ready" } },
};

/** The endpoint a hand-rolled Linear creation is addressed at. */
const ENDPOINT = "https://api.linear.app/graphql";
/** The GraphQL body such a creation submits, as a fixture would hold it. */
const MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

/**
 * Write a file into a throwaway project directory.
 * @param cwd - The project directory.
 * @param name - The file name.
 * @param lines - The contents, one entry per line.
 * @returns The absolute path written.
 */
const fixture = (
  cwd: string,
  name: string,
  lines: readonly string[]
): string => {
  const target = path.join(cwd, name);
  writeFileSync(target, `${lines.join("\n")}\n`, "utf-8");
  return target;
};

describe("block-direct-issue-create.sh inert payloads", () => {
  describe("permits a payload the file writes rather than sends", () => {
    it("allows a Python helper that writes the payload into a fixture", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const helper = fixture(cwd, "make_fixture.py", [
        `ENDPOINT = "${ENDPOINT}"`,
        `MUTATION = '${MUTATION}'`,
        "",
        'with open("fixture.json", "w") as handle:',
        "    handle.write(MUTATION)",
      ]);

      const { status } = runHook(bash(`python3 ${helper}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows the same helper written in JavaScript", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const helper = fixture(cwd, "make-fixture.mjs", [
        'import { writeFileSync } from "node:fs";',
        "",
        `const endpoint = "${ENDPOINT}";`,
        `const mutation = '${MUTATION}';`,
        "",
        'writeFileSync("fixture.json", JSON.stringify({ endpoint, mutation }));',
      ]);

      const { status } = runHook(bash(`node ${helper}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    // The shell spelling of the same helper. Its local write is a redirect
    // rather than a named call, which is a separate arm of the recogniser.
    it("allows a shell helper that redirects the payload into a fixture", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const helper = fixture(cwd, "make-fixture.sh", [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `ENDPOINT='${ENDPOINT}'`,
        `MUTATION='${MUTATION}'`,
        'printf \'{"endpoint":"%s","body":%s}\' "$ENDPOINT" "$MUTATION" > fixture.json',
      ]);

      const { status } = runHook(bash(`bash ${helper}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("still refuses a file that can submit what it spells", () => {
    it("refuses a file that sends the payload over HTTP", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, "wrapper.mjs", [
        `await fetch("${ENDPOINT}", {`,
        '  method: "POST",',
        `  body: '${MUTATION}',`,
        "});",
      ]);

      const { status } = runHook(bash(`node ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The rejection control the ticket names: assembling the body at runtime
    // is the obvious way to dress a submission up as data.
    it("refuses a submitter whose payload is assembled at runtime", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, "submit.py", [
        "import json",
        "import sys",
        "import urllib.request",
        "",
        'template = "mutation{issueCreate(input:{title:%s}){success}}"',
        'body = json.dumps({"query": template % json.dumps(sys.argv[1])})',
        `request = urllib.request.Request("${ENDPOINT}", data=body.encode())`,
        "urllib.request.urlopen(request)",
      ]);

      const { status } = runHook(bash(`python3 ${script} title`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // A local write is necessary for the exemption, never sufficient. A
    // submitter that also writes a log must not buy its way out with it.
    it("refuses a submitter that also writes a local file", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, "submit-and-log.py", [
        "import urllib.request",
        "",
        `MUTATION = '${MUTATION}'`,
        `request = urllib.request.Request("${ENDPOINT}", data=MUTATION.encode())`,
        "response = urllib.request.urlopen(request)",
        'with open("audit.log", "w") as handle:',
        "    handle.write(str(response.status))",
      ]);

      const { status } = runHook(bash(`python3 ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // Egress is not only HTTP. Handing the payload to another process carries
    // it just as far, and the file below writes a fixture as well.
    it("refuses a file that hands the payload to another process", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, "delegate.py", [
        "import subprocess",
        "",
        `MUTATION = '${MUTATION}'`,
        'with open("fixture.json", "w") as handle:',
        "    handle.write(MUTATION)",
        "subprocess.run(",
        `    ["curl", "-X", "POST", "${ENDPOINT}", "-d", MUTATION], check=True`,
        ")",
      ]);

      const { status } = runHook(bash(`python3 ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The shell arm is a different recogniser and must be untouched: this
    // script writes a fixture, so the local-write half is satisfied, and it
    // still files an issue.
    it("refuses a shell script that writes a fixture and then submits it", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, "write-then-send.sh", [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s' '${MUTATION}' > payload.json`,
        `curl -sS -X POST ${ENDPOINT} --data-binary @payload.json`,
      ]);

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });
});
