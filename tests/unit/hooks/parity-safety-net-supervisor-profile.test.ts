/** Exact authenticated supervisor entries retain every other destructive policy. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { createGuardHarness } from "../../helpers/safety-net-guard-harness.js";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const SUPERVISOR_NAME = "lisa-scratch-run.sh";
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const DELETE = `${"r"}${"m"} -${"r"}${"f"}`;
const OUTSIDE = "/Users/probe/outside-the-project/scratch";
const SAME_REASON =
  "recursive forced delete of an absolute path outside the project";
const harness = createGuardHarness(process.env);
let fixtures = "";
let payload = "";

beforeAll(() => {
  fixtures = mkdtempSync(path.join(tmpdir(), "supervisor-profile-"));
  payload = path.join(fixtures, "payload.sh");
  writeFileSync(payload, `#!/bin/sh\n${DELETE} ${OUTSIDE}\n`);
});
afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

/** Classify proposed text only; no payload or supervisor executes.
 * @param command - Original proposed command.
 * @param hook - Optional altered guard for the missing-profile refusal.
 * @returns Native guard verdict.
 */
const classify = (command: string, hook?: string) => {
  if (!hook) return harness.runHook(command, { cwd: process.cwd() });
  const result = boundedSpawnSync({
    label: "missing-profile guard",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });
  return { status: result.status, stderr: result.stderr };
};

describe("authenticated scratch supervisor", () => {
  const supervisor = path.resolve(
    "all/copy-overwrite/scripts/lisa-scratch-run.sh"
  );
  const publicEntry = `LISA_SCRATCH_BASE=/tmp sh ${supervisor} --suite probe --`;

  it("permits exact reviewed supervisor bytes without permitting arbitrary variable cleanup", () => {
    expect(classify(`${publicEntry} ruby -e 'puts :probe'`).status).toBe(
      EXIT_ALLOWED
    );
    expect(classify(`${DELETE} "$UNPROVEN"`).status).toBe(EXIT_BLOCKED);
  });

  it.each([
    ["internal authority", `sh ${supervisor} --authority /tmp/unowned`],
    ["internal launcher", `sh ${supervisor} --launch /tmp/unowned token ruby`],
    [
      "dynamic base",
      `LISA_SCRATCH_BASE=$UNKNOWN sh ${supervisor} --suite probe -- ruby`,
    ],
    [
      "duplicate base",
      `LISA_SCRATCH_BASE=/tmp LISA_SCRATCH_BASE=/var/tmp sh ${supervisor} --suite probe -- ruby`,
    ],
    [
      "environment indirection",
      `env -S 'LISA_SCRATCH_BASE=/tmp sh ${supervisor} --suite probe -- ruby'`,
    ],
    ["interpreter option", `sh -e ${supervisor} --suite probe -- ruby`],
    [
      "outside base",
      `LISA_SCRATCH_BASE=/Users/probe sh ${supervisor} --suite probe -- ruby`,
    ],
    ["dynamic suite", `sh ${supervisor} --suite $UNKNOWN -- ruby`],
    [
      "duplicate suite",
      `sh ${supervisor} --suite first --suite second -- ruby`,
    ],
    ["inline payload", `${publicEntry} sh -c '${DELETE} ${OUTSIDE}'`],
  ])("refuses %s", (_name, command) => {
    expect(classify(command).status).toBe(EXIT_BLOCKED);
  });

  it("continues following an actual shell-file payload", () => {
    expect(classify(`${publicEntry} sh ${payload}`).stderr).toContain(
      SAME_REASON
    );
  });

  it("never transfers a public-entry decision to a cached direct internal entry", () => {
    expect(
      classify(`${publicEntry} ruby; ${supervisor} --authority /tmp/unowned`)
        .status
    ).toBe(EXIT_BLOCKED);
    expect(
      classify(
        `${publicEntry} ruby; sh ${supervisor} --launch /tmp/unowned token ruby`
      ).status
    ).toBe(EXIT_BLOCKED);
  });

  it("rechecks a second public entry's destructive payload after a safe entry", () => {
    const verdict = classify(
      `${publicEntry} ruby; ${publicEntry} sh ${payload}`
    );
    expect(verdict.status).toBe(EXIT_BLOCKED);
    expect(verdict.stderr).toContain(SAME_REASON);
  });

  it("keeps non-delete built-ins and custom rules active on original bytes", () => {
    expect(classify(`${publicEntry} find /Users/probe -delete`).status).toBe(
      EXIT_BLOCKED
    );
    const rules = path.join(fixtures, "supervisor.rules");
    writeFileSync(rules, "lisa_die\n");
    const verdict = harness.runHook(`${publicEntry} ruby -e 'puts :probe'`, {
      cwd: process.cwd(),
      env: { SAFETY_NET_RULES_FILE: rules },
    });
    expect(verdict.status).toBe(EXIT_BLOCKED);
    expect(verdict.stderr).toContain("project custom safety rule");
  });

  it("binds the supervisor's actual inherited and empty-value base precedence", () => {
    const entry = `sh ${supervisor} --suite probe -- ruby`;
    expect(
      harness.runHook(entry, {
        cwd: process.cwd(),
        env: { LISA_SCRATCH_BASE: "/Users/probe" },
      }).status
    ).toBe(EXIT_BLOCKED);
    expect(
      harness.runHook(`TMPDIR=/tmp ${entry}`, {
        cwd: process.cwd(),
        env: { LISA_SCRATCH_BASE: "/Users/probe" },
      }).status
    ).toBe(EXIT_BLOCKED);
    expect(
      harness.runHook(`TMPDIR=/Users/probe ${entry}`, {
        cwd: process.cwd(),
        env: { LISA_SCRATCH_BASE: "/tmp" },
      }).status
    ).toBe(EXIT_ALLOWED);
    expect(classify(`LISA_SCRATCH_BASE= TMPDIR=/tmp ${entry}`).status).toBe(
      EXIT_ALLOWED
    );
  });

  it.each(["\n# changed source\n", `\n${DELETE} ${OUTSIDE}\n`])(
    "refuses changed source %s",
    suffix => {
      writeFileSync(
        path.join(fixtures, SUPERVISOR_NAME),
        readFileSync(supervisor, "utf8") + suffix
      );
      expect(
        classify(
          `sh ${path.join(fixtures, SUPERVISOR_NAME)} --suite probe -- ruby`
        ).status
      ).toBe(EXIT_BLOCKED);
    }
  );

  it("refuses one-byte mutation and a fake supervisor ownership header", () => {
    const filename = path.join(fixtures, SUPERVISOR_NAME);
    const source = readFileSync(supervisor, "utf8");
    writeFileSync(filename, source.replace("#!/bin/sh", "#!/bin/SH"));
    expect(classify(`sh ${filename} --suite probe -- ruby`).status).toBe(
      EXIT_BLOCKED
    );
    writeFileSync(
      filename,
      '#!/bin/sh\n# Lisa-owned canonical supervisor\nrm -rf "$UNPROVEN"\n'
    );
    expect(classify(`sh ${filename} --suite probe -- ruby`).status).toBe(
      EXIT_BLOCKED
    );
  });

  it("refuses when the embedded source digest is missing", () => {
    const guard = path.join(fixtures, "missing-profile.sh");
    writeFileSync(
      guard,
      readFileSync(HOOK_PATH, "utf8").replace(
        /readonly SCRATCH_SUPERVISOR_SHA256='[^']*'/,
        "readonly SCRATCH_SUPERVISOR_SHA256=''"
      )
    );
    expect(classify(`${publicEntry} ruby -e 'puts :probe'`, guard).status).toBe(
      EXIT_BLOCKED
    );
  });
});
