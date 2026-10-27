/** Direct expanded command-name regressions; all identities are synthetic. */
import assert from "node:assert/strict";
import { boundedExecFileSync } from "./bounded-spawn.mjs";

/** @param {object} context Isolated actual-wrapper fixtures. @returns {Array[]} Named cases. */
export function hostNameExpandedCommandCases(context) {
  const { lisaCwd, unknownCwd, hostCwd, lisa, host, fixtureName, body } =
    context;
  const cases = [];
  for (const [target, cwd, repo] of [
    ["protected", lisaCwd, ` --repo ${lisa}`],
    ["unknown", unknownCwd, ""],
  ]) {
    for (const [name, noun] of [
      ["unquoted", "$N"],
      ["double quoted", '"$N"'],
      ["braced", '"${N}"'],
      ["concatenated", 'is"$SUFFIX"'],
    ]) {
      cases.push([
        `expanded noun ${name} ${target} write`,
        cwd,
        `gh ${noun} create${repo} --body '${fixtureName}'`,
        2,
      ]);
    }
    for (const [name, verb] of [
      ["unquoted", "$V"],
      ["double quoted", '"$V"'],
      ["braced", '"${V}"'],
      ["concatenated", 'cre"$TAIL"'],
    ]) {
      cases.push([
        `expanded verb ${name} ${target} write`,
        cwd,
        `gh issue ${verb}${repo} --body '${fixtureName}'`,
        2,
      ]);
    }
    for (const [name, prefix] of [
      ["multiple-word noun", "gh $N"],
      ["multiple-word verb", "gh issue $V"],
      ["noun before read-looking word", "gh $N view"],
      ["verb before read-looking word", "gh issue $V view"],
    ]) {
      cases.push([
        `expanded ${name} ${target} write`,
        cwd,
        `${prefix}${repo} --body '${fixtureName}'`,
        2,
      ]);
    }
    for (const [name, args] of [
      ["API field text", `-F body=${fixtureName}`],
      ["API field file", `-F body=@${body}`],
      ["API attached field file", `-Fbody=@${body}`],
      ["API raw field", `-f body=${fixtureName}`],
      ["API input file", `--input ${body}`],
    ]) {
      cases.push([
        `expanded noun possible ${name} ${target} write`,
        cwd,
        `gh "$N" repos/${lisa}/issues ${args}`,
        2,
      ]);
    }
    cases.push(
      [
        `expanded noun issue body-file ${target} write`,
        cwd,
        `gh "$N" create${repo} -F ${body}`,
        2,
      ],
      [
        `expanded both command positions ${target} write`,
        cwd,
        `gh${repo} "$N" "$V" --body '${fixtureName}'`,
        2,
      ]
    );
  }
  cases.push(
    [
      "expanded PR verb protected body-file write",
      lisaCwd,
      `gh pr "$V" --repo ${lisa} --body-file ${body}`,
      2,
    ],
    [
      "expanded PR verb unknown body-file write",
      unknownCwd,
      `gh pr "$V" --body-file ${body}`,
      2,
    ],
    [
      "expanded noun literal host flag cannot certify target",
      hostCwd,
      `gh "$N" create --repo ${host} --body '${fixtureName}'`,
      2,
    ],
    [
      "expanded-name API GET prose with dynamic filter control",
      lisaCwd,
      `gh api repos/${lisa}/issues -X GET -F body=${fixtureName} -q "$FILTER"`,
      0,
    ],
    [
      "expanded-name API GET input with dynamic filter control",
      lisaCwd,
      `gh api repos/${lisa}/issues -X GET --input ${body} -q "$FILTER"`,
      0,
    ],
    [
      "expanded-name literal host control",
      hostCwd,
      `gh issue create --repo ${host} --body '${fixtureName}'`,
      0,
    ],
    [
      "expanded-name literal protected control",
      lisaCwd,
      `gh issue create --repo ${lisa} --body '${fixtureName}'`,
      2,
    ],
    [
      "expanded-name literal unknown control",
      unknownCwd,
      `gh issue create --body '${fixtureName}'`,
      2,
    ],
    [
      "expanded-name dynamic read filter control",
      lisaCwd,
      `gh issue list --repo ${lisa} --json title --jq "$FILTER"`,
      0,
    ],
    [
      "expanded-name dynamic read selector control",
      lisaCwd,
      `gh issue view "$NUMBER" --repo ${lisa} --json title --jq '${fixtureName}'`,
      0,
    ],
    [
      "expanded-name API GET dynamic filter control",
      lisaCwd,
      `gh api repos/${lisa}/issues -X GET -q "$FILTER"`,
      0,
    ],
    [
      "expanded-name single-quoted noun control",
      lisaCwd,
      `gh '$N' create --repo ${lisa} --body '${fixtureName}'`,
      0,
    ],
    [
      "expanded-name single-quoted verb control",
      lisaCwd,
      `gh issue '$V' --repo ${lisa} --body '${fixtureName}'`,
      0,
    ],
    [
      "expanded-name escaped noun control",
      lisaCwd,
      `gh \\$N create --repo ${lisa} --body '${fixtureName}'`,
      0,
    ],
    [
      "expanded-name quoted non-command control",
      lisaCwd,
      `printf '%s' 'gh $N create --repo ${lisa} --body ${fixtureName}'`,
      0,
    ],
    [
      "expanded-name clean prose control",
      lisaCwd,
      `gh "$N" create --repo ${lisa} --body 'A clean report.'`,
      0,
    ],
    [
      "expanded-name options before noun preserve prose boundaries",
      lisaCwd,
      `gh --repo ${lisa} --title 'view list' "$N" create --body '${fixtureName}'`,
      2,
    ],
    [
      "expanded-name literal host API control",
      hostCwd,
      `gh api repos/${host}/issues -F body=${fixtureName}`,
      0,
    ]
  );
  return cases;
}

/**
 * Establish expansion premises with a Bash function that only prints argv.
 * @param {object} context Synthetic fixtures.
 * @param {object} env Isolated child environment.
 * @returns {void}
 */
export function verifyExpandedCommandArgv(context, env) {
  const { lisaCwd, lisa, fixtureName, body } = context;
  const suffix = ` --repo ${lisa} --body '${fixtureName}'`;
  for (const [name, command, values, expected] of [
    [
      "unquoted noun",
      `gh $N create${suffix}`,
      { N: "issue" },
      ["issue", "create", "--repo", lisa, "--body", fixtureName],
    ],
    [
      "quoted braced noun",
      `gh "${"${N}"}" create${suffix}`,
      { N: "issue" },
      ["issue", "create", "--repo", lisa, "--body", fixtureName],
    ],
    [
      "concatenated noun",
      `gh is"$SUFFIX" create${suffix}`,
      { SUFFIX: "sue" },
      ["issue", "create", "--repo", lisa, "--body", fixtureName],
    ],
    [
      "concatenated verb",
      `gh issue cre"$TAIL"${suffix}`,
      { TAIL: "ate" },
      ["issue", "create", "--repo", lisa, "--body", fixtureName],
    ],
    [
      "multiword noun before read-looking word",
      `gh $N view${suffix}`,
      { N: "issue create --title" },
      [
        "issue",
        "create",
        "--title",
        "view",
        "--repo",
        lisa,
        "--body",
        fixtureName,
      ],
    ],
    [
      "multiword verb before read-looking word",
      `gh issue $V view${suffix}`,
      { V: "create --title" },
      [
        "issue",
        "create",
        "--title",
        "view",
        "--repo",
        lisa,
        "--body",
        fixtureName,
      ],
    ],
    [
      "possible API field file",
      `gh "$N" repos/${lisa}/issues -F body=@${body}`,
      { N: "api" },
      ["api", `repos/${lisa}/issues`, "-F", `body=@${body}`],
    ],
  ]) {
    const argv = boundedExecFileSync(
      "/bin/bash",
      ["-c", `gh() { printf '%s\\0' "$@"; }; ${command}`],
      { cwd: lisaCwd, env: { ...env, ...values }, encoding: "utf8" }
    )
      .split("\0")
      .slice(0, -1);
    assert.deepEqual(argv, expected, name);
    console.log(
      JSON.stringify({
        localExpandedArgvControl: {
          name,
          command,
          argv,
          inspectedTrackerWriteExecuted: false,
          ghImplementation: "Bash argv-only printer",
        },
      })
    );
  }
}
