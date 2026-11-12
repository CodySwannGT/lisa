/** One-level literal launcher cases; submitted scripts are never executed. */
import assert from "node:assert/strict";
import { boundedExecFileSync } from "./bounded-spawn.mjs";

export function hostNameLauncherCases({
  hostCwd,
  lisaCwd,
  unknownCwd,
  relative,
  fixtureName,
  lisa,
  host,
}) {
  const cases = [];
  for (const launcher of ["sh", "bash"]) {
    const wrap = script => `${launcher} -c '${script}'`;
    const examples = [
      [
        "protected explicit target is inspected",
        hostCwd,
        `gh issue create --repo ${lisa} --body ${fixtureName}`,
        2,
      ],
      [
        "protected origin is inspected",
        lisaCwd,
        `gh issue create --body ${fixtureName}`,
        2,
      ],
      [
        "unknown target remains inspected",
        unknownCwd,
        `gh issue create --body ${fixtureName}`,
        2,
      ],
      [
        "unknown repository remains inspected",
        hostCwd,
        `gh issue create --repo "$UNKNOWN_REPOSITORY" --body ${fixtureName}`,
        2,
      ],
      [
        "explicit known host stays allowed",
        lisaCwd,
        `gh issue create --repo ${host} --body ${fixtureName}`,
        0,
      ],
      [
        "explicit known host from unknown origin stays allowed",
        unknownCwd,
        `gh issue create --repo ${host} --body ${fixtureName}`,
        0,
      ],
      [
        "literal host origin stays allowed",
        hostCwd,
        `gh issue create --body ${fixtureName}`,
        0,
      ],
      [
        "known read stays allowed",
        lisaCwd,
        `gh issue view 1 --repo ${lisa} --json body --jq "${fixtureName}"`,
        0,
      ],
      [
        "explicit API GET stays allowed",
        lisaCwd,
        `gh api repos/${lisa}/issues -X GET -f body=${fixtureName}`,
        0,
      ],
      [
        "API POST is inspected",
        hostCwd,
        `gh api repos/${lisa}/issues -f body=${fixtureName}`,
        2,
      ],
      [
        "clean protected prose stays allowed",
        lisaCwd,
        `gh issue create --repo ${lisa} --body "A clean report."`,
        0,
      ],
      [
        "quoted gh text in printf stays prose",
        lisaCwd,
        `printf "%s" "gh issue create --repo ${lisa} --body ${fixtureName}"`,
        0,
      ],
      [
        "inner literal cwd routes relative body file",
        lisaCwd,
        `cd "${relative}" && gh issue create --repo ${lisa} --body-file body.md`,
        2,
      ],
      [
        "inner literal host cwd stays allowed",
        lisaCwd,
        `cd "${hostCwd}" && gh issue create --body ${fixtureName}`,
        0,
      ],
      [
        "inner unknown cwd refuses unread relative body",
        lisaCwd,
        `cd "$UNKNOWN_DIRECTORY" && gh issue create --repo ${lisa} --body-file body.md`,
        2,
        {},
        "BLOCKED: the working directory",
      ],
    ];
    for (const [name, cwd, script, expected, overrides, refusal] of examples)
      cases.push([
        `${launcher} launcher ${name}`,
        cwd,
        wrap(script),
        expected,
        overrides ?? {},
        refusal,
      ]);
    cases.push(
      [
        `${launcher} launcher preserves outer literal cwd`,
        hostCwd,
        `cd '${lisaCwd}' && ${wrap(`gh issue create --body ${fixtureName}`)}`,
        2,
      ],
      [
        `${launcher} command text in non-executable argument stays prose`,
        lisaCwd,
        `printf "%s" "${launcher} -c gh issue create --repo ${lisa} --body ${fixtureName}"`,
        0,
      ],
      [
        `${launcher} double quoted literal script is inspected`,
        hostCwd,
        `${launcher} -c "gh issue create --repo ${lisa} --body ${fixtureName}"`,
        2,
      ]
    );
  }
  return cases;
}

/**
 * Additional isolation controls and explicit observations outside the contract.
 * Unsupported-form exit0 is a recognition limit, never a clean/safe verdict.
 * @param {object} context Isolated actual-wrapper fixtures.
 * @returns {Array[]} Named controls.
 */
export function hostNameLauncherBoundaryCases(context) {
  const { hostCwd, lisaCwd, lisa, host, fixtureName } = context;
  const cases = [];
  for (const launcher of ["sh", "bash"]) {
    const write = `gh issue create --body ${fixtureName}`;
    cases.push(
      [
        `${launcher} script argument after executable operand stays data`,
        lisaCwd,
        `${launcher} -c 'printf clean' '${write} --repo ${lisa}'`,
        0,
      ],
      [
        `${launcher} child cwd cannot grant parent a host exemption`,
        lisaCwd,
        `${launcher} -c 'cd "${hostCwd}"'; ${write}`,
        2,
      ],
      [
        `${launcher} child cwd cannot remove parent host routing`,
        hostCwd,
        `${launcher} -c 'cd "${lisaCwd}"'; ${write}`,
        0,
      ],
      [
        `${launcher} child export cannot grant parent a host exemption`,
        lisaCwd,
        `${launcher} -c 'export GH_REPO=${host}'; ${write}`,
        2,
      ],
      [
        `${launcher} child export cannot remove parent host routing`,
        hostCwd,
        `${launcher} -c 'export GH_REPO=${lisa}'; ${write}`,
        0,
      ],
      [
        `${launcher} inherits literal host environment`,
        lisaCwd,
        `GH_REPO=${host} ${launcher} -c '${write}'`,
        0,
      ],
      [
        `${launcher} inherits literal protected environment`,
        hostCwd,
        `GH_REPO=${lisa} ${launcher} -c '${write}'`,
        2,
      ],
      [
        `${launcher} inner literal export routes the child`,
        lisaCwd,
        `${launcher} -c 'export GH_REPO=${host}; ${write}'`,
        0,
      ],
      [
        `${launcher} explicit host remains proven with unknown outer cwd`,
        lisaCwd,
        `cd "$D"; ${launcher} -c '${write} --repo ${host}'`,
        0,
      ],
      [
        `${launcher} unresolved outer cwd retains unknown-target inspection`,
        lisaCwd,
        `cd "$D"; ${launcher} -c '${write}'`,
        2,
      ],
      [
        `${launcher} absolute executable path is recognized`,
        hostCwd,
        `/bin/${launcher} -c '${write} --repo ${lisa}'`,
        2,
      ],
      [
        `${launcher} dynamic script is outside the recognition contract`,
        lisaCwd,
        `${launcher} -c "$SCRIPT"`,
        0,
      ],
      [
        `${launcher} deeper script is outside the recognition contract`,
        lisaCwd,
        `${launcher} -c 'bash -c "${write} --repo ${lisa}"'`,
        0,
      ],
      [
        `${launcher} other option forms are outside the recognition contract`,
        lisaCwd,
        `${launcher} -lc '${write} --repo ${lisa}'`,
        0,
      ]
    );
  }
  return cases;
}

/**
 * Confirm the real launcher executable-script slot using only printf.
 * This executes no tracker command and never invokes a substitute gh binary.
 * @param {object} context Isolated fixtures.
 * @param {object} env Isolated environment.
 * @returns {void}
 */
export function verifyLauncherScriptSlot(context, env) {
  for (const launcher of ["/bin/sh", "/bin/bash"]) {
    const args = [
      "-c",
      'printf "%s\\0" "$0" "$1"',
      "script-argument-zero",
      "script-argument-one",
    ];
    const argv = boundedExecFileSync(launcher, args, {
      cwd: context.lisaCwd,
      env,
      encoding: "utf8",
    })
      .split("\0")
      .slice(0, -1);
    assert.deepEqual(argv, ["script-argument-zero", "script-argument-one"]);
    console.log(
      JSON.stringify({
        localLauncherArgvControl: {
          launcher,
          args,
          argv,
          inspectedTrackerWriteExecuted: false,
          executableScript: "printf only",
        },
      })
    );
  }
}
