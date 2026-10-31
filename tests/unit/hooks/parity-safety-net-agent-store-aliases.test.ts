/**
 * R1: equivalent literal store spellings retain protection. Proposed commands
 * are JSON DATA supplied to actual Bash classifiers, never executed. Only
 * harmless authored artifacts are created beneath one owned temporary root;
 * every protected target remains a nonexistent synthetic path string.
 * @module tests/unit/hooks/parity-safety-net-agent-store-aliases
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/agent-store-paths.json" with { type: "json" };

/** One synthetic input and required status, with attributable refusal. */
interface AliasCase {
  readonly id: string;
  readonly family: string;
  readonly command: string;
  readonly expected: number;
}

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));
const SHAPES = ["relative", "absolute", "quoted-absolute"];
const NAMES = [
  "authorization-notes.md",
  "operator-resume-authority-v1.md",
  "lint-final-authored.stdout",
];
const STORE_DIAGNOSTIC = "coding-agent or package-registry credential store";

/**
 * Render literal operand text without evaluating it.
 * @param relative Synthetic relative path, possibly containing shell quote data.
 * @param shape Controlled equivalent path spelling.
 * @returns Proposed operand text for the JSON command field only.
 */
function operand(relative: string, shape: string): string {
  if (shape === "relative") return relative;
  if (shape === "absolute") return `{root}/${relative}`;
  return `"{root}/${relative}"`;
}

const PROTECTED: readonly AliasCase[] = profile.agentStorePaths.flatMap(
  store => {
    const [directory, leaf] = store.split("/");
    const aliases = [
      ["repeated-root-separator", `${directory}//${leaf}`],
      ["nested-repeated-separator", `${directory}/cache//${leaf}`],
      ["multiple-nested-separators", `${directory}///cache///${leaf}`],
      [
        "quoted-format-fragment",
        `${directory}/${leaf?.replace(/\.json$/u, '."json"')}`,
      ],
    ];
    return aliases.flatMap(([alias, relative]) =>
      SHAPES.flatMap(shape => {
        const target = operand(relative ?? "", shape);
        const benign = operand(
          `${directory}/artifacts/research/lint-final-authored.stdout`,
          shape
        );
        return [
          {
            id: `${store}/${alias}/${shape}/read`,
            family: alias ?? "",
            command: `cat ${target}`,
            expected: 2,
          },
          {
            id: `${store}/${alias}/${shape}/mixed`,
            family: alias ?? "",
            command: `cat ${benign} ${target}`,
            expected: 2,
          },
          {
            id: `${store}/${alias}/${shape}/copy`,
            family: alias ?? "",
            command: `cp ${target} ${benign}`,
            expected: 2,
          },
        ];
      })
    );
  }
);

const DIRECT: readonly AliasCase[] = profile.agentStorePaths.flatMap(store =>
  SHAPES.map(shape => ({
    id: `${store}/${shape}/direct-store-control`,
    family: "direct-store-control",
    command: `cat ${operand(store, shape)}`,
    expected: 2,
  }))
);

const BENIGN: readonly AliasCase[] = profile.agentDirectories.flatMap(
  directory =>
    NAMES.flatMap(name =>
      [
        `${directory}/artifacts/research/${name}`,
        `${directory}//artifacts///research//${name}`,
      ].flatMap(relative =>
        SHAPES.map(shape => ({
          id: `${relative}/${shape}/benign-control`,
          family: "benign-control",
          command: `cat ${operand(relative, shape)}`,
          expected: 0,
        }))
      )
    )
);

const BENIGN_QUOTES: readonly AliasCase[] = profile.agentDirectories.flatMap(
  directory =>
    SHAPES.map(shape => ({
      id: `${directory}/${shape}/benign-quoted-format`,
      family: "benign-control",
      command: `cat ${operand(`${directory}/artifacts/research/lint-final-authored."stdout"`, shape)}`,
      expected: 0,
    }))
);
const CASES = [...PROTECTED, ...DIRECT, ...BENIGN, ...BENIGN_QUOTES];
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-store-aliases-"));
  for (const directory of profile.agentDirectories) {
    const research = path.join(root, directory, "artifacts", "research");
    mkdirSync(research, { recursive: true });
    for (const name of NAMES) {
      writeFileSync(
        path.join(research, name),
        "Synthetic authored notes; no secrets.\n"
      );
    }
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/**
 * Identify source/input bytes for immutable classifier evidence.
 * @param bytes Content to identify.
 * @returns Hexadecimal SHA256.
 */
const sha256 = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The hook is the only Bash argv; proposed strings enter solely through stdin.
 * @param hook Actual canonical or emitted hook path.
 * @param row Synthetic command and required verdict.
 * @returns Actual bounded hook receipt.
 */
function classify(hook: string, row: AliasCase) {
  const command = row.command.replaceAll("{root}", root);
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    cwd: root,
  });
  const result = boundedSpawnSync({
    label: `agent-store-alias: ${row.id}`,
    command: "/bin/bash",
    args: [hook],
    input,
    cwd: root,
    env: { ...process.env },
  });
  const receipt = {
    id: row.id,
    family: row.family,
    command,
    input,
    cwd: root,
    input_sha256: sha256(input),
    hook,
    hook_sha256: sha256(readFileSync(hook)),
    invocation: ["/bin/bash", hook],
    observed_at: new Date().toISOString(),
    expected: row.expected,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  console.info(`[agent-store-alias] ${JSON.stringify(receipt)}`);
  return receipt;
}

describe("parity-safety-net: literal store aliases", () => {
  it.each(CASES)("$id", row => {
    const receipts = HOOKS.map(hook => classify(hook, row));
    for (const receipt of receipts) {
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected === 2) {
        expect(receipt.stderr, JSON.stringify(receipt)).toContain(
          STORE_DIAGNOSTIC
        );
      } else {
        expect(receipt.stderr).not.toContain("Blocked by safety-net");
      }
    }
    expect(receipts.map(receipt => receipt.status)).toEqual([
      row.expected,
      row.expected,
    ]);
  });
});
