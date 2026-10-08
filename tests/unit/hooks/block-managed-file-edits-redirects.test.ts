/** Managed writes through combined streams retain ordinary read and fd controls. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  sourceGuard,
} from "./support/executed-script-reach.js";

const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
const UNMANAGED = "src/app.ts";
const host = scratchDir("managed-redirect-host");
const redirects = [
  ">",
  ">>",
  ">|",
  "1>",
  "2>",
  "10>>",
  "2>|",
  "&>",
  "&>>",
  ">&",
];
const guards = [
  sourceGuard("block-managed-file-edits.sh"),
  path.resolve(
    "all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh"
  ),
];

beforeAll(() => {
  const shipped = path.join(
    host,
    "node_modules/@codyswann/lisa/all/copy-overwrite"
  );
  writeFileSync(
    path.join(host, "package.json"),
    JSON.stringify({ name: "a-host-project" })
  );
  mkdirSync(path.join(shipped, "scripts/lisa-hooks"), { recursive: true });
  writeFileSync(path.join(shipped, MANAGED), "shipped\n");
  // A numeric filename is a real template path, but >&1 duplicates a descriptor.
  writeFileSync(path.join(shipped, "1"), "numeric template\n");
  mkdirSync(path.join(host, "scripts/lisa-hooks"), { recursive: true });
  writeFileSync(path.join(host, MANAGED), "local\n");
  writeFileSync(path.join(host, "1"), "local numeric template\n");
  mkdirSync(path.join(host, "src"), { recursive: true });
  writeFileSync(path.join(host, UNMANAGED), "app\n");
});

describe.each(guards)("managed output redirections: %s", guard => {
  /**
   * Classify the command in the synthetic host, without executing its write.
   * @param command - Native shell command requested by the tool.
   * @returns Guard exit code.
   */
  const run = (command: string) =>
    runGuard(guard, bash(command), {
      cwd: host,
      env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
    }).status;

  it.each(redirects)("refuses %s into a managed file", redirect => {
    expect(run(`printf x ${redirect} "${MANAGED}"`)).toBe(EXIT_BLOCKED);
  });

  it.each(redirects)("allows %s into a project-owned file", redirect => {
    expect(run(`printf x ${redirect} "${UNMANAGED}"`)).toBe(EXIT_ALLOWED);
  });

  it.each([">&1", "2>&1", "2>&1-", ">&-", "2>&-"])(
    "allows descriptor duplication or closure %s",
    redirect => {
      expect(run(`printf x ${redirect}`)).toBe(EXIT_ALLOWED);
    }
  );

  it("still refuses a pathname named like a descriptor when directly redirected", () => {
    expect(run("printf x > 1")).toBe(EXIT_BLOCKED);
    expect(run("printf x &> 1")).toBe(EXIT_BLOCKED);
  });

  it("allows a read of the same managed file", () => {
    expect(run(`cat "${MANAGED}"`)).toBe(EXIT_ALLOWED);
  });

  it("refuses a redirect operator joined across a shell continuation", () => {
    expect(run(`printf x >\\\n& "${MANAGED}"`)).toBe(EXIT_BLOCKED);
    expect(run(`printf x &\\\n> "${MANAGED}"`)).toBe(EXIT_BLOCKED);
    expect(run(`printf x > "scripts/lisa-hooks/block-\\\nno-verify.sh"`)).toBe(
      EXIT_BLOCKED
    );
  });

  it.each([";", "&&", "||", "|"])(
    "refuses redirects adjacent to %s",
    separator => {
      expect(run(`true${separator}>& "${MANAGED}"`)).toBe(EXIT_BLOCKED);
      expect(run(`true${separator}>& "${UNMANAGED}"`)).toBe(EXIT_ALLOWED);
      expect(run(`printf '%s' '${separator}>&' "${MANAGED}"`)).toBe(
        EXIT_ALLOWED
      );
    }
  );

  it("preserves single-quoted continuation text as data", () => {
    expect(run(`printf '%s' '>\\\n&' "${MANAGED}"`)).toBe(EXIT_ALLOWED);
    expect(run(`printf '%s' '>\\\n&' &> "${MANAGED}"`)).toBe(EXIT_BLOCKED);
  });

  it.each(["&>", "&>>", ">&"])(
    "allows quoted operator text %s as data",
    redirect => {
      const escaped = [...redirect].map(character => `\\${character}`).join("");
      expect(run(`printf '%s' '${redirect}' "${MANAGED}"`)).toBe(EXIT_ALLOWED);
      expect(run(`printf '%s' "${redirect}" "${MANAGED}"`)).toBe(EXIT_ALLOWED);
      expect(run(`printf '%s' ${escaped} "${MANAGED}"`)).toBe(EXIT_ALLOWED);
    }
  );

  it.each(["&>", "&>>", ">&"])(
    "refuses %s inside a quoted shell -c payload",
    redirect => {
      expect(run(`bash -c 'printf x ${redirect} "${MANAGED}"'`)).toBe(
        EXIT_BLOCKED
      );
    }
  );

  // `|&` pipes stdout and stderr. It was in no statement-separator set, so
  // `printf x |& tee <managed>` stayed one statement whose command word was
  // `printf` and the `tee` write target was never examined.
  it.each([
    `printf x |& tee "${MANAGED}"`,
    `(printf x)|&tee "${MANAGED}"`,
    `printf x |& tee -a "${MANAGED}"`,
  ])("refuses a tee write after |&: %s", command => {
    expect(run(command)).toBe(EXIT_BLOCKED);
  });

  it("allows a tee write after |& into a project-owned file", () => {
    expect(run(`printf x |& tee "${UNMANAGED}"`)).toBe(EXIT_ALLOWED);
  });

  it.each([";;", ";&", ";;&"])(
    "ends a statement at the case terminator %s",
    terminator => {
      expect(
        run(`case x in x) true${terminator} *) tee "${MANAGED}"; esac`)
      ).toBe(EXIT_BLOCKED);
    }
  );

  it("still refuses a real redirect after a quoted operator argument", () => {
    expect(run(`printf '%s' '&>' &> "${MANAGED}"`)).toBe(EXIT_BLOCKED);
  });
});
