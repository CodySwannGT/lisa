/**
 * Host-stack ownership for `block-managed-file-edits.sh` (CodySwannGT/lisa#4511).
 *
 * The same host-relative path can be copy-overwrite in one stack and
 * create-only in another. `.github/workflows/ci.yml` is create-only in the
 * typescript, nestjs, cdk, expo, and rails templates — the host owns it after
 * the first apply — but copy-overwrite in harper-fabric and phaser. The guard
 * probed every stack's copy-overwrite tree regardless of what the host is, so
 * the harper-fabric copy (first in glob order) made a NestJS consumer's own
 * `ci.yml` read as Lisa-managed, and a one-line Node bump needed a human to run
 * the override.
 *
 * `lisa apply` only ever copies a stack's templates into a host that stack's
 * detector recognises, so a child stack's copy-overwrite hit governs only a
 * host of that stack. These cases pin both sides: the cross-stack collision is
 * allowed, and every genuine managed hit — the matching stack's own copy, and
 * the `all`/`typescript` trees every TypeScript host receives — stays refused.
 *
 * Each case runs in a synthetic HOST project; inside Lisa's own repository the
 * guard stands down and would prove nothing.
 * @module tests/unit/hooks/block-managed-file-edits-host-stack
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  sourceGuard,
} from "./support/executed-script-reach.js";

const GUARD = sourceGuard("block-managed-file-edits.sh");

/** The path that is create-only in most stacks and copy-overwrite in two. */
const CI = ".github/workflows/ci.yml";
/** Managed in `all`, which every host receives. */
const ALL_MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
/** Managed in `typescript`, which every TypeScript child stack inherits. */
const TS_MANAGED = ".lintstagedrc.json";
/** Managed only in the nestjs stack. */
const NEST_MANAGED = ".nest-managed.json";
const PACKAGE = "node_modules/@codyswann/lisa";

/** Host shapes, each mirroring the matching `src/detection/detectors/*.ts`. */
type HostShape = {
  readonly packageJson: Record<string, unknown>;
  readonly files?: Readonly<Record<string, string>>;
};

const HARPER_CONFIG =
  "graphqlSchema:\n  files: schema.graphql\njsResource:\n  files: resources.js\nstatic:\n  files: web/*\n";

const HOSTS = {
  nestjs: { packageJson: { dependencies: { "@nestjs/core": "^11.0.0" } } },
  nestCli: {
    packageJson: { dependencies: {} },
    files: { "nest-cli.json": "{}" },
  },
  harper: {
    packageJson: { dependencies: {} },
    files: {
      "harper-app/config.yaml": HARPER_CONFIG,
      "harper-app/schema.graphql": "type T @table { id: ID @primaryKey }\n",
    },
  },
  harperDependency: {
    packageJson: { dependencies: { harperdb: "^4.0.0" } },
    files: {
      "harper-app/config.yaml": "rest: true\n",
      "harper-app/schema.graphql": "type T @table { id: ID @primaryKey }\n",
    },
  },
  // Config keys without the schema file: the detector says NOT harper-fabric.
  harperWithoutSchema: {
    packageJson: { dependencies: { harperdb: "^4.0.0" } },
    files: { "harper-app/config.yaml": HARPER_CONFIG },
  },
  phaser: { packageJson: { devDependencies: { phaser: "^3.80.0" } } },
  plain: { packageJson: { dependencies: { typescript: "^5.0.0" } } },
} satisfies Record<string, HostShape>;

/** Managed only in its own stack, one per detector arm not covered above. */
const STACK_MANAGED = {
  expo: ".expo-managed.json",
  cdk: ".cdk-managed.json",
  rails: ".rails-managed.json",
} as const;

/**
 * Every remaining detector signal, each alone, paired with the stack-only
 * managed file it must make reachable. One signal per host so a refusal is
 * attributable to exactly that arm of `stack_reaches_host`.
 */
const SIGNAL_HOSTS: ReadonlyArray<readonly [string, string, HostShape]> = [
  [
    "expo via app.json",
    STACK_MANAGED.expo,
    { packageJson: { dependencies: {} }, files: { "app.json": "{}" } },
  ],
  [
    "expo via eas.json",
    STACK_MANAGED.expo,
    { packageJson: { dependencies: {} }, files: { "eas.json": "{}" } },
  ],
  [
    "expo via the expo dependency",
    STACK_MANAGED.expo,
    { packageJson: { dependencies: { expo: "^53.0.0" } } },
  ],
  [
    "cdk via cdk.json",
    STACK_MANAGED.cdk,
    { packageJson: { dependencies: {} }, files: { "cdk.json": "{}" } },
  ],
  [
    "rails via bin/rails",
    STACK_MANAGED.rails,
    { packageJson: {}, files: { "bin/rails": "#!/usr/bin/env ruby\n" } },
  ],
  [
    "rails via config/application.rb",
    STACK_MANAGED.rails,
    {
      packageJson: {},
      files: { "config/application.rb": "module App; end\n" },
    },
  ],
  [
    "nestjs via a devDependencies @nestjs/cli",
    NEST_MANAGED,
    { packageJson: { devDependencies: { "@nestjs/cli": "^11.0.0" } } },
  ],
];

/**
 * Write a file, creating its parent directories.
 * @param file - Absolute path
 * @param body - Contents
 */
const put = (file: string, body: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf-8");
};

/**
 * Build a host project with an installed package carrying the colliding
 * templates, then the host's own stack signals.
 * @param shape - The host's stack signals
 * @returns The host directory
 */
const makeHost = (shape: HostShape): string => {
  const host = scratchDir("managed-host-stack");
  const pkg = path.join(host, PACKAGE);
  put(path.join(pkg, "harper-fabric/copy-overwrite", CI), "harper\n");
  put(path.join(pkg, "phaser/copy-overwrite", CI), "phaser\n");
  put(path.join(pkg, "nestjs/create-only", CI), "nest\n");
  put(path.join(pkg, "typescript/create-only", CI), "ts\n");
  put(path.join(pkg, "nestjs/copy-overwrite", NEST_MANAGED), "{}\n");
  put(path.join(pkg, "all/copy-overwrite", ALL_MANAGED), "shipped\n");
  put(path.join(pkg, "typescript/copy-overwrite", TS_MANAGED), "{}\n");
  for (const [stack, file] of Object.entries(STACK_MANAGED)) {
    put(path.join(pkg, stack, "copy-overwrite", file), "{}\n");
  }
  put(
    path.join(host, "package.json"),
    JSON.stringify({ name: "a-host-project", ...shape.packageJson })
  );
  for (const [file, body] of Object.entries(shape.files ?? {})) {
    put(path.join(host, file), body);
  }
  put(path.join(host, CI), "name: CI\n");
  return host;
};

/**
 * Run the guard as the host against one payload.
 * @param host - Host directory
 * @param payload - PreToolUse payload
 * @returns Exit status; 2 means refused
 */
const decide = (host: string, payload: unknown): number | null =>
  runGuard(GUARD, payload, {
    cwd: host,
    env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
  }).status;

/**
 * A Write payload at a host-relative target.
 * @param target - Host-relative path
 * @returns Payload
 */
const write = (target: string) => ({
  tool_name: "Write",
  tool_input: { file_path: target },
});

/**
 * An apply_patch payload updating one host-relative target.
 * @param target - Host-relative path
 * @returns Payload
 */
const patch = (target: string) => ({
  tool_name: "apply_patch",
  tool_input: {
    command: `*** Begin Patch\n*** Update File: ${target}\n@@\n-a\n+b\n*** End Patch`,
  },
});

/**
 * A Bash in-place edit of one host-relative target.
 * @param target - Host-relative path
 * @returns Payload
 */
const sedInPlace = (target: string) => bash(`sed -i '' "s/22/24/" ${target}`);

const ARMS = [
  ["Write", write],
  ["apply_patch", patch],
  ["Bash sed -i", sedInPlace],
] as const;

describe.each(ARMS)("host-stack ownership via %s", (_arm, payload) => {
  it("allows a NestJS host to edit its own create-only ci.yml despite another stack's copy-overwrite twin", () => {
    expect(decide(makeHost(HOSTS.nestjs), payload(CI))).toBe(EXIT_ALLOWED);
  });

  it("detects NestJS from nest-cli.json alone, as the detector does", () => {
    expect(decide(makeHost(HOSTS.nestCli), payload(CI))).toBe(EXIT_ALLOWED);
  });

  it("allows a plain TypeScript host the same create-only ci.yml", () => {
    expect(decide(makeHost(HOSTS.plain), payload(CI))).toBe(EXIT_ALLOWED);
  });

  it("refuses a harper-fabric host, whose ci.yml IS copy-overwrite", () => {
    expect(decide(makeHost(HOSTS.harper), payload(CI))).toBe(EXIT_BLOCKED);
  });

  it("recognises harper-fabric from the harperdb dependency when config keys are absent", () => {
    expect(decide(makeHost(HOSTS.harperDependency), payload(CI))).toBe(
      EXIT_BLOCKED
    );
  });

  it("does not take harper-fabric without its schema file, as the detector does not", () => {
    expect(decide(makeHost(HOSTS.harperWithoutSchema), payload(CI))).toBe(
      EXIT_ALLOWED
    );
  });

  it("refuses a phaser host, whose ci.yml IS copy-overwrite", () => {
    expect(decide(makeHost(HOSTS.phaser), payload(CI))).toBe(EXIT_BLOCKED);
  });

  it("still refuses a NestJS host editing an all/copy-overwrite template", () => {
    expect(decide(makeHost(HOSTS.nestjs), payload(ALL_MANAGED))).toBe(
      EXIT_BLOCKED
    );
  });

  it("still refuses a NestJS host editing a typescript/copy-overwrite template", () => {
    expect(decide(makeHost(HOSTS.nestjs), payload(TS_MANAGED))).toBe(
      EXIT_BLOCKED
    );
  });

  it("still refuses a NestJS host editing its own stack's copy-overwrite template", () => {
    expect(decide(makeHost(HOSTS.nestjs), payload(NEST_MANAGED))).toBe(
      EXIT_BLOCKED
    );
  });

  it("allows a non-NestJS host a path only the nestjs stack manages", () => {
    expect(decide(makeHost(HOSTS.plain), payload(NEST_MANAGED))).toBe(
      EXIT_ALLOWED
    );
  });

  it.each(SIGNAL_HOSTS)(
    "refuses %s editing that stack's own copy-overwrite template",
    (_signal, target, shape) => {
      expect(decide(makeHost(shape), payload(target))).toBe(EXIT_BLOCKED);
    }
  );

  it.each(Object.values(STACK_MANAGED))(
    "allows a plain TypeScript host %s, which only another stack manages",
    target => {
      expect(decide(makeHost(HOSTS.plain), payload(target))).toBe(EXIT_ALLOWED);
    }
  );
});
