/**
 * The destructive guard must scan the copy of a script the shell will actually
 * run, not a same-named file in the directory the hook happens to sit in.
 *
 * ## What was broken
 *
 * `parity-safety-net.sh` follows execution into the script an invocation runs —
 * the right design, and the reason a destructive line inside a file is refused
 * exactly as the inline form is. But it resolved a RELATIVE script path against
 * the hook process's own `$PWD`, which is the session's working directory, not
 * the working directory the command will have once it runs its own leading
 * `cd`. A literal `cd` target was recorded only as an ADDITIONAL base, appended
 * after `$PWD`, so `$PWD` always won.
 *
 * The failure is not that resolution fails. It succeeds, against a real and
 * readable file, and the hook reports its verdict with full confidence.
 *
 * ## Why it is wrong in the expensive direction
 *
 * Two checkouts of one repository hold their own copy of every script at the
 * same relative path, differing by whatever each is working on — which is the
 * entire point of a second checkout. So the verdict is about text nobody was
 * about to run, and it is wrong both ways:
 *
 * - **False block** — the copy read holds a destructive pattern the copy that
 *   would run does not. Annoying, visible, self-correcting.
 * - **False allow** — the copy that WOULD run holds the destructive pattern and
 *   the copy read does not. Silent, and the direction this guard exists to
 *   prevent. A second checkout can hold an edited script whose dangerous line
 *   was added minutes ago; the guard scans the pristine copy, sees nothing, and
 *   allows it.
 *
 * A fix that passes only the false-block control has made the guard quieter
 * without making it right, which is the more attractive of the two mistakes and
 * the more expensive. Both controls are here, and the false-allow one is the
 * load-bearing half.
 *
 * ## The floor when the effective directory cannot be known
 *
 * A `cd` whose target is not literal text — `cd "$SOMEWHERE"` — leaves the
 * guard unable to say which copy a later relative token names. It refuses
 * rather than guessing, through the refusal this hook already prints for a file
 * it cannot classify. A confident scan of the wrong file is strictly worse than
 * an honest "I could not tell", which is the doctrine the rest of the hook
 * already follows.
 * @module tests/unit/hooks/parity-safety-net-cd-resolution
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

/** Every shipped spelling of the same guard. All of them govern somewhere. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/**
 * The recursive-delete syntax, assembled rather than written out, for the same
 * reason its sibling suites assemble it: spelling it literally would make this
 * file an instance of the class it describes.
 */
const RM = `${"r"}${"m"}`;
const DELETE = `${RM} -${"r"}${"f"}`;

/** A directory no test creates, outside the project and outside every tmp allowance. */
const OUTSIDE = "/Users/probe/outside-the-project/scratch";

/** The verdict the inline form reaches, which the followed form must match. */
const SAME_REASON =
  "recursive forced delete of an absolute path outside the project";

/** The refusal the hook prints when it cannot say which file would run. */
const UNCLASSIFIABLE = "cannot classify the file this command executes";

/** The relative name both copies share — the whole premise of the defect. */
const SCRIPT = "run.sh";

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  /** Exit status: 0 permitted, 2 refused. */
  readonly status: number | null;
  /** Everything the hook printed to stderr, which is what the model sees. */
  readonly stderr: string;
}

/** Where the session sits, and where the command will be by the time it runs. */
interface Checkouts {
  /** The hook process's own working directory. */
  readonly session: string;
  /** The directory the command `cd`s into before running the script. */
  readonly target: string;
}

let fixtures = "";
let checkouts: Checkouts = { session: "", target: "" };

/**
 * Write one script at a path, executable, with a single meaningful line.
 * @param file Absolute path to write.
 * @param body The one line the script runs.
 */
const emit = (file: string, body: string): void => {
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
};

/**
 * Classify one proposed command as if the session sat in a given directory.
 *
 * The hook reads its own `$PWD`, so the session directory is expressed as the
 * spawned process's cwd rather than as a field in the JSON — which is exactly
 * the distinction the defect turned on.
 * @param command The proposed shell command.
 * @param cwd The session working directory to classify from.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status and refusal text.
 */
const classify = (
  command: string,
  cwd: string,
  hook: string = HOOK_PATH
): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    cwd,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd,
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

beforeAll(() => {
  fixtures = mkdtempSync(path.join(tmpdir(), "cd-resolution-"));
  checkouts = {
    session: path.join(fixtures, "session-checkout"),
    target: path.join(fixtures, "other-checkout"),
  };
  mkdirSync(checkouts.session, { recursive: true });
  mkdirSync(checkouts.target, { recursive: true });
  mkdirSync(path.join(checkouts.session, "nested"), { recursive: true });
});

afterAll(() => {
  if (fixtures) {
    rmSync(fixtures, { recursive: true, force: true });
  }
});

describe("parity-safety-net.sh — resolving an executed script across a leading cd", () => {
  describe("the two rejection controls, one on each side of the verdict", () => {
    it("BLOCKS when the destructive copy is the one the command would run", () => {
      emit(path.join(checkouts.session, SCRIPT), "echo ok");
      emit(path.join(checkouts.target, SCRIPT), `${DELETE} ${OUTSIDE}`);

      const verdict = classify(
        `cd ${checkouts.target} && bash ${SCRIPT}`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("ALLOWS when the destructive copy only sits at the session directory", () => {
      emit(path.join(checkouts.session, SCRIPT), `${DELETE} ${OUTSIDE}`);
      emit(path.join(checkouts.target, SCRIPT), "echo ok");

      const verdict = classify(
        `cd ${checkouts.target} && bash ${SCRIPT}`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });
  });

  describe("the verdict names the file it actually read", () => {
    it("prints the absolute path inside the directory the command cds to", () => {
      emit(path.join(checkouts.session, SCRIPT), "echo ok");
      emit(path.join(checkouts.target, SCRIPT), `${DELETE} ${OUTSIDE}`);

      const verdict = classify(
        `cd ${checkouts.target} && bash ${SCRIPT}`,
        checkouts.session
      );

      expect(verdict.stderr).toContain(path.join(checkouts.target, SCRIPT));
      expect(verdict.stderr).not.toContain(
        path.join(checkouts.session, SCRIPT)
      );
    });
  });

  describe("a cd target that is not literal text refuses rather than guessing", () => {
    it("refuses a relative script after a cd it cannot resolve", () => {
      emit(path.join(checkouts.session, SCRIPT), "echo ok");

      const verdict = classify(
        `cd "$SOMEWHERE" && bash ${SCRIPT}`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(UNCLASSIFIABLE);
    });
  });

  describe("a relative cd target follows the same shell semantics", () => {
    it("resolves the script under the nested directory, not the session one", () => {
      emit(path.join(checkouts.session, SCRIPT), "echo ok");
      emit(
        path.join(checkouts.session, "nested", SCRIPT),
        `${DELETE} ${OUTSIDE}`
      );

      const verdict = classify(
        `cd nested && bash ${SCRIPT}`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });
  });

  describe("behaviour with no cd, and for absolute paths, is unchanged", () => {
    it("still resolves a relative script against the session directory", () => {
      emit(path.join(checkouts.session, SCRIPT), `${DELETE} ${OUTSIDE}`);

      const verdict = classify(`bash ${SCRIPT}`, checkouts.session);

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("still classifies an absolute script named after a cd", () => {
      emit(path.join(checkouts.session, SCRIPT), `${DELETE} ${OUTSIDE}`);
      emit(path.join(checkouts.target, SCRIPT), "echo ok");

      const verdict = classify(
        `cd ${checkouts.target} && bash ${path.join(checkouts.session, SCRIPT)}`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });

    it("leaves a cd with no executed file alone", () => {
      const verdict = classify(
        `cd ${checkouts.target} && ls -la`,
        checkouts.session
      );

      expect(verdict.status).toBe(EXIT_ALLOWED);
      expect(verdict.stderr).toBe("");
    });
  });

  describe("every shipped copy of the guard reaches the same verdict", () => {
    it.each(SHIPPED_COPIES)("blocks the false-allow control in %s", copy => {
      emit(path.join(checkouts.session, SCRIPT), "echo ok");
      emit(path.join(checkouts.target, SCRIPT), `${DELETE} ${OUTSIDE}`);

      const verdict = classify(
        `cd ${checkouts.target} && bash ${SCRIPT}`,
        checkouts.session,
        copy
      );

      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(SAME_REASON);
    });
  });
});
