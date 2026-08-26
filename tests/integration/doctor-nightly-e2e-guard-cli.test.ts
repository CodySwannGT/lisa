/**
 * @file doctor-nightly-e2e-guard-cli.test.ts
 * @description Built-CLI red legs for executable bypass discovery
 * @module tests/integration/doctor-nightly-e2e-guard-cli.test
 */
import { describe, expect, it } from "vitest";

import {
  doctorNightlyGuard as doctor,
  TARGET,
} from "./doctor-nightly-e2e-guard-cli-helper.js";

const DETERMINATE_ZERO = "determinate zero";

const header = `
'on': [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
`;

describe("built doctor executable bypass discovery", () => {
  it.each(["NIGHTLY_E2E_BYPASS", "Nightly.E2E-Bypass"])(
    "fails a guard-skipping case/punctuation variant %s",
    async label => {
      const finding = await doctor(`${header.replace(
        "    runs-on:",
        `    if: \${{ !contains(github.event.pull_request.labels.*.name, '${label}') }}\n    runs-on:`
      )}    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: node ${TARGET}
`);
      expect(finding).toMatchObject({
        status: "fail",
        detail: expect.stringMatching(/discovery unavailable|if.*bypass/u),
      });
      expect(finding.detail).not.toContain(DETERMINATE_ZERO);
    }
  );

  it("fails a guard-skipping join/fromJSON bypass expression", async () => {
    const finding = await doctor(`${header.replace(
      "    runs-on:",
      `    if: \${{ !contains(github.event.pull_request.labels.*.name, join(fromJSON('["nightly","e2e","bypass"]'), '-')) }}\n    runs-on:`
    )}    env:
      GATE_BYPASS: true
    steps:
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/discovery unavailable|if.*bypass/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails quoted env-command bypass wiring instead of reporting zero", async () => {
    const finding = await doctor(`${header}    steps:
      - run: env "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'Nightly_E2E.Bypass') }}" node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/env.*GATE_BYPASS|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails quoted GITHUB_ENV bypass wiring instead of reporting zero", async () => {
    const finding = await doctor(`${header}    steps:
      - run: echo "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'NIGHTLY_E2E_BYPASS') }}" >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_ENV|indirect|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails an unsupported remote reusable carrying bypass input evidence", async () => {
    const finding = await doctor(`
'on': [pull_request]
jobs:
  gate:
    uses: example/tools/.github/workflows/gate.yml@v1
    with:
      bypass_label: nightly-e2e-bypass
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/remote reusable|bypass|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails a guard invocation whose runner leaves shell semantics unknown", async () => {
    const finding = await doctor(`${header.replace(
      "ubuntu-latest",
      "windows-latest"
    )}    env:
      GATE_BYPASS: true
    steps:
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/POSIX|runner|shell/u),
    });
  });

  it("fails a tee append into GITHUB_ENV before the guard", async () => {
    const finding = await doctor(`${header}    steps:
      - run: printf '%s\\n' "GATE_BYPASS=true" | tee -a "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(
        /GITHUB_ENV|environment.*file|unsupported/u
      ),
    });
  });

  it.each([
    ["clobber redirect", `echo "./fake-bin" >| "$GITHUB_PATH"`],
    ["tee replacement", `echo "./fake-bin" | tee "$GITHUB_PATH"`],
    [
      "assignment-prefixed tee",
      `echo "./fake-bin" | LC_ALL=C tee "$GITHUB_PATH"`,
    ],
    ["command-prefixed tee", `echo "./fake-bin" | command tee "$GITHUB_PATH"`],
  ])("fails a GITHUB_PATH %s before the guard", async (_label, sink) => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: ${sink}
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_PATH|command.*path|execution/u),
    });
  });

  it("keeps bypass_cache outside nightly bypass classification", async () => {
    const finding = await doctor(`${header}    if: \${{ !env.bypass_cache }}
    steps:
      - run: node scripts/ordinary.mjs
`);
    expect(finding).toMatchObject({
      status: "ok",
      detail: expect.stringContaining(DETERMINATE_ZERO),
    });
  });

  it("refuses a NODE_OPTIONS zero-exit replacement before certifying exact guard bytes", async () => {
    const finding = await doctor(
      `${header}    env:
      GATE_BYPASS: true
      NODE_OPTIONS: --import=./zero-exit.mjs
    steps:
      - run: node ${TARGET}
`,
      { "zero-exit.mjs": "process.exit(0);\n" }
    );
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/NODE_OPTIONS|environment|execution/u),
    });
    expect(finding.detail).not.toMatch(/compatible at contract/u);
  });

  it("fails a constructed NIGHTLY_BYPASS_LABEL GITHUB_ENV write", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: echo "NIGHTLY_\${{ inputs.kind }}_LABEL=nightly-e2e-bypass" >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_ENV|environment.*file|unknown/u),
    });
  });

  it("does not let a SAFE prefix certify an unknown GITHUB_ENV payload", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: SAFE=present cat generated.env >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_ENV|environment.*file|unknown/u),
    });
    expect(finding.detail).not.toMatch(/compatible at contract/u);
  });

  it("refuses a GITHUB_PATH mutation before the certified target", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: echo "./fake-bin" >> "$GITHUB_PATH"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_PATH|command.*path|execution/u),
    });
  });

  it("accepts the certified target when command-file mutations occur afterward", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: node ${TARGET}
      - run: cat generated.env >> "$GITHUB_ENV"
      - run: echo "./fake-bin" >> "$GITHUB_PATH"
`);
    expect(finding).toMatchObject({
      status: "ok",
      detail: expect.stringMatching(/Inspected|compatible at contract/u),
    });
  });

  it.each([
    [
      "uppercase GITHUB_PATH alias",
      `FILE="$GITHUB_PATH"\necho "./fake-bin" >> "$FILE"`,
    ],
    [
      "lowercase GITHUB_PATH alias",
      `path_file="$GITHUB_PATH"\necho "./fake-bin" >> "$path_file"`,
    ],
    [
      "underscore-prefixed GITHUB_PATH alias",
      `_path_file="$GITHUB_PATH"\necho "./fake-bin" >> "$_path_file"`,
    ],
    [
      "Bash indirect GITHUB_PATH alias",
      `FILE=GITHUB_PATH\necho "./fake-bin" >> "\${!FILE}"`,
    ],
    [
      "unsafe lowercase GITHUB_ENV alias",
      `env_file="$GITHUB_ENV"\necho "GATE_BYPASS=true" >> "$env_file"`,
    ],
  ])("refuses a %s", async (_label, sink) => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: |
${sink
  .split("\n")
  .map(line => `          ${line}`)
  .join("\n")}
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(
        /GITHUB_(?:ENV|PATH)|alias|indirect|command.*file/u
      ),
    });
    expect(finding.detail).not.toMatch(/compatible at contract/u);
  });

  it("refuses an expanded GITHUB_ENV assignment payload", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: echo "CACHE_MODE=$VALUE" >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_ENV|payload|unknown/u),
    });
  });

  it("accepts one deterministic literal printf assignment", async () => {
    const finding = await doctor(`${header}    env:
      GATE_BYPASS: true
    steps:
      - run: printf 'CACHE_MODE=warm\\n' >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "ok",
      detail: expect.stringMatching(/Inspected|compatible at contract/u),
    });
  });
});
