/** Closed proposal controls keep candidate data out of privileged execution. */
import { describe, expect, it, vi } from "vitest";
import { downloadRuntimeArchive } from "../../../all/copy-overwrite/scripts/lib/npm-update-runtime-transport.mjs";
import { writeFileSync, linkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import {
  validatePolicy,
  validateProposal,
  proposalFrom,
  validateRawCommit,
  validateHost,
  selectionKey,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  candidateEnvironment,
  readJson,
  readBytes,
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { refTransport } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import {
  inspectedEnvironment,
  workerEnvironment,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-worker-environment.mjs";

import {
  checkpointComments,
  decodeCheckpoint,
  recoverPartialCheckpoint,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-recovery.mjs";

import {
  gateStreams,
  assertGateTransport,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-hooks.mjs";
import {
  assertWorkerInspection,
  workerArguments,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-isolation.mjs";
import { validateRuntime } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-install.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  validateOwnerReceipt,
  nativeHooksEnabled,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-owner.mjs";
import { boundedSpawnSync as boundedTestSpawnSync } from "../../helpers/io-latency-budget.js";

const NODE_TOOL = "/opt/node/bin/node";
const HELPER_GRAPH_FILE =
  "all/copy-overwrite/scripts/npm-updater-helper-graph.json";

describe("actual native hook table state", () => {
  it.each([
    "[features]\nhooks = true\n",
    "# host comment\n[features]\nhooks\t=\ttrue # enabled\n[other]\nvalue = false\n",
    "[other]\nhooks = false\n  [features]  \r\nhooks = true\r\n",
  ])("accepts one genuine enabled feature table: %s", native => {
    expect(nativeHooksEnabled(native)).toBe(true);
  });
  it.each([
    "# [features]\nhooks = true\n",
    "value = '[features]'\nhooks = true\n",
    "[features]\n[other]\nhooks = true\n",
    "[features]\nhooks = false\n",
    "[features]\nhooks = truejunk\n",
    "[features]\nhooks = true.extra\n",
    "[features]\nhooks = 'true'\n",
    "[features]\nhooks = true\nhooks = false\n",
    "[features]\nhooks = true\n[features]\nhooks = true\n",
    'description = """\n[features]\nhooks = true\n"""\n',
    "description = '''\n[features]\nhooks = true\n'''\n",
    'description = """note"""\n[features]\nhooks = true\n',
    "description = '''note'''\n[features]\nhooks = true\n",
  ])(
    "refuses commented, foreign, malformed or duplicate authority: %s",
    native => {
      expect(nativeHooksEnabled(native)).toBe(false);
    }
  );
});

const RAILS_PREPUSH = "lisa-rails-prepush.mjs";
const WORK_ITEM_HELPER = "lisa-work-item.mjs";
const MANIFEST_FILE = "package.json";
const HISTORY_POLICY = "lib/history-secret-policy.mjs";
const ARM64_PLATFORM = "linux/arm64";
const RUBY_INSTALL_ROLE = "ruby-install";
const WORKSPACE = "/workspace";
const CANDIDATE_HOME = "/home/candidate";
const CONTROLLER_ROOT = "/owned/controller";
const DOCKER_TOOL = "/qualified/docker";
const SECCOMP_FILE = "/owned/controller/seccomp.json";
const OCI_INDEX_TYPE = "application/vnd.oci.image.index.v1+json";
const INSTRUMENTED_ORIGIN = "already-instrumented-origin";
const LAUNCHER_BOOTSTRAP = "launcher-bootstrap";
const BOOTSTRAP_INPUT = "actual input";

describe.skipIf(!["linux", "darwin"].includes(process.platform))(
  "actual updater direct process transport",
  () => {
    it("preserves literal data, stdin, cwd, env and a permitted real exit 17", async () => {
      await withPrivateRoot(async (root, env) => {
        const entry = join(root, "literal fixture.cjs");
        const marker = join(root, "shell-must-not-run");
        const args = [
          "",
          "a'b",
          "\nΩ",
          `$(touch ${marker})`,
          "$HOME",
          "--direct-argv",
        ];
        writeFileSync(
          entry,
          `let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', value => { input += value; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input,
    cwd: process.cwd(), marker: process.env.LISA_LITERAL_MARKER }));
  process.stderr.write('original stderr'); process.exitCode = 17;
});`
        );
        const result = await runProcess(process.execPath, [entry, ...args], {
          cwd: root,
          env: { ...env, LISA_LITERAL_MARKER: "inherited" },
          input: "byte stdin\nΩ",
          allowed: [17],
        });
        expect(result.code).toBe(17);
        expect(result.stderr.toString()).toBe("original stderr");
        expect(JSON.parse(result.stdout.toString())).toEqual({
          args,
          input: "byte stdin\nΩ",
          cwd: root,
          marker: "inherited",
        });
        const { existsSync } = await import("node:fs");
        expect(existsSync(marker)).toBe(false);
      });
    });

    it("rejects combined output overflow and deadline despite allowing every numeric exit", async () => {
      const allowed = Array.from({ length: 256 }, (_, value) => value);
      await expect(
        runProcess(
          process.execPath,
          [
            "-e",
            "process.stdout.write('a'.repeat(40000)); process.stderr.write('b'.repeat(40000));",
          ],
          { allowed, maximum: 65536 }
        )
      ).rejects.toThrow(/output exceeded bound/);
      await expect(
        runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
          allowed,
          timeout: 500,
        })
      ).rejects.toThrow(/deadline|child failed/);
    });

    it("cannot bless a real nonzero child which closes input before consuming it", async () => {
      await expect(
        runProcess(
          process.execPath,
          ["-e", "process.stdin.destroy(); process.exit(17);"],
          { input: Buffer.alloc(1_048_576), timeout: 5000 }
        )
      ).rejects.toThrow(/child failed|child input failed/);
    });

    it("counts supervisor and preload overhead in the complete final vector", async () => {
      await expect(
        runProcess(process.execPath, [
          "--import",
          "file:///qualified/bootstrap.mjs",
          ...Array(505).fill(""),
        ])
      ).rejects.toThrow(/unbounded supervised argument vector/);
      await expect(
        runProcess(process.execPath, ["x".repeat(65537)])
      ).rejects.toThrow(/unbounded supervised argument vector/);
      await expect(runProcess(process.execPath, ["\0"])).rejects.toThrow(
        /unbounded supervised argument vector/
      );
    });
  }
);

/** Test-local authority binds actual source bytes; this is not a released owner or provider proof. */
async function directBootstrapFixture(root: string) {
  const { readFileSync, realpathSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { managedTemplateMembers } =
    await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
  const { writeJson } =
    await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
  const entry = join(root, "qualified-child.mjs");
  const caller = join(root, "qualified-caller.mjs");
  const core = resolve(
    "all/copy-overwrite/scripts/lib/npm-update-process-core.mjs"
  );
  const { pathToFileURL } = await import("node:url");
  writeFileSync(
    entry,
    `let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input,
    cwd: process.cwd(), context: process.env.LISA_NPM_DISPATCH_CONTEXT,
    preloads: process.execArgv.filter(value => value === '--import').length }));
  process.exitCode = 17;
  if (process.argv[2] === '--wait-for-scoped-deadline') setInterval(() => {}, 1000);
});`
  );
  writeFileSync(
    caller,
    `import { runProcess } from ${JSON.stringify(pathToFileURL(core).href)};
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const result = await runProcess(process.execPath, process.argv.slice(2), {
  input: Buffer.concat(chunks), allowed: [17], env: process.env, cwd: process.cwd()
}); process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exitCode = result.code;`
  );
  const graph: Record<string, string> = {};
  for (const path of managedTemplateMembers().values())
    if (path.endsWith(".mjs")) {
      const absolute = realpathSync(path);
      graph[absolute] = sha256(readFileSync(absolute));
    }
  for (const path of [entry, caller]) graph[path] = sha256(readFileSync(path));
  const node = realpathSync(process.execPath);
  expect(process.versions.node).toBe("22.23.3");
  const identity = {
    path: node,
    version: process.versions.node,
    sha256: sha256(readFileSync(node)),
  };
  const context = {
    version: 1,
    root,
    cwd: root,
    graph,
    runtime: { tools: { node: identity } },
    controller: { node: identity },
    boundary: {},
  };
  const file = writeJson(join(root, "launcher.json"), context);
  const adapter = resolve(
    "all/copy-overwrite/scripts/lib/npm-update-execution-adapter.mjs"
  );
  return { entry, caller, context, file, adapter, pathToFileURL };
}

describe.skipIf(!["linux", "darwin"].includes(process.platform))(
  "distinct real direct bootstrap chains",
  () => {
    it("accepts an owned v3 launcher context with no provider authority", async () => {
      const { launcherContext } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      const { replaceJson } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
      await withPrivateRoot(async root => {
        const fixture = await directBootstrapFixture(root);
        const context = {
          ...fixture.context,
          version: 3,
          routes: [],
          provider: null,
        };
        expect(launcherContext(fixture.file)).toEqual(fixture.context);
        replaceJson(fixture.file, context);
        expect(launcherContext(fixture.file)).toEqual(context);
      });
    });

    it("rejects a real exit 17 when scoped helper dispatch permits only zero", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        const args = [fixture.entry, "literal \nΩ", "", "--"];
        const input = Buffer.from(BOOTSTRAP_INPUT);
        const original = await dispatchTool(
          fixture.context,
          "node",
          args,
          input,
          env,
          root
        );
        expect(original.code).toBe(17);
        expect(original.stderr.toString()).toBe("");
        expect(JSON.parse(original.stdout.toString())).toEqual({
          args: args.slice(1),
          input: BOOTSTRAP_INPUT,
          cwd: root,
          context: fixture.file,
          preloads: 1,
        });
        // The seventh execution-contract argument is the admitted target API, not an existing capability.
        await expect(
          Reflect.apply(dispatchTool, undefined, [
            fixture.context,
            "node",
            args,
            input,
            env,
            root,
            { allowed: [0], timeout: 120_000, maximum: 3_145_728 },
          ])
        ).rejects.toMatchObject({
          message: "npm updater: child failed (17)",
          code: 17,
          stdout: original.stdout,
          stderr: original.stderr,
        });
      });
    });

    it("retains v1 and v2 while requiring exact v3 keys and a null provider", async () => {
      const { launcherContext } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      const { replaceJson } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
      await withPrivateRoot(async root => {
        const fixture = await directBootstrapFixture(root);
        const v2 = { ...fixture.context, version: 2, routes: [] };
        const v3 = { ...v2, version: 3, provider: null };
        expect(launcherContext(fixture.file)).toEqual(fixture.context);
        replaceJson(fixture.file, v2);
        expect(launcherContext(fixture.file)).toEqual(v2);
        for (const value of [
          { ...fixture.context, provider: null },
          { ...v2, provider: null },
          { ...fixture.context, version: 3, routes: [] },
          { ...fixture.context, version: 3, provider: null },
          { ...v3, provider: {} },
          { ...v3, provider: false },
          { ...v3, routes: null },
          { ...v3, extra: true },
        ]) {
          replaceJson(fixture.file, value);
          expect(() => launcherContext(fixture.file)).toThrow();
        }
      });
    });

    it.each([
      null,
      {},
      { allowed: [], timeout: 120_000, maximum: 3_145_728 },
      { allowed: [0, 0], timeout: 120_000, maximum: 3_145_728 },
      { allowed: Array(1), timeout: 120_000, maximum: 3_145_728 },
      { allowed: [-1], timeout: 120_000, maximum: 3_145_728 },
      { allowed: [256], timeout: 120_000, maximum: 3_145_728 },
      { allowed: [0.5], timeout: 120_000, maximum: 3_145_728 },
      { allowed: ["0"], timeout: 120_000, maximum: 3_145_728 },
      { allowed: [0], timeout: 0, maximum: 3_145_728 },
      { allowed: [0], timeout: 1_800_001, maximum: 3_145_728 },
      { allowed: [0], timeout: 120_000.5, maximum: 3_145_728 },
      { allowed: [0], timeout: 120_000, maximum: 0 },
      { allowed: [0], timeout: 120_000, maximum: 8_388_609 },
      { allowed: [0], timeout: 120_000, maximum: Infinity },
      { allowed: [0], timeout: 120_000, maximum: 3_145_728, shell: true },
    ])("refuses malformed scoped execution contract %j", async execution => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        await expect(
          Reflect.apply(dispatchTool, undefined, [
            fixture.context,
            "node",
            [fixture.entry],
            Buffer.alloc(0),
            env,
            root,
            execution,
          ])
        ).rejects.toThrow(/fields|object|execution contract/);
      });
    });

    it("preserves default execution and snapshots explicitly allowed native exits", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        const allowed = [17];
        const args = [fixture.entry];
        const pending = dispatchTool(
          fixture.context,
          "node",
          args,
          Buffer.from(BOOTSTRAP_INPUT),
          env,
          root,
          { allowed, timeout: 120_000, maximum: 3_145_728 }
        );
        allowed[0] = 0;
        const result = await pending;
        const original = await Reflect.apply(dispatchTool, undefined, [
          fixture.context,
          "node",
          args,
          Buffer.from(BOOTSTRAP_INPUT),
          env,
          root,
          undefined,
        ]);
        expect(result.code).toBe(17);
        expect(original).toEqual(result);
      });
    });

    it("refuses a scoped execution contract on the worker route before allocation", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        await expect(
          dispatchTool(
            { ...fixture.context, boundary: { workspace: root } },
            "node",
            [join(root, "unqualified-worker-entry.mjs")],
            Buffer.alloc(0),
            env,
            root,
            { allowed: [0], timeout: 120_000, maximum: 3_145_728 }
          )
        ).rejects.toThrow(
          "scoped execution contract is unsupported on worker routes"
        );
      });
    });

    it("enforces the scoped combined-output bound on the actual bootstrap child", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        await expect(
          dispatchTool(
            fixture.context,
            "node",
            [fixture.entry],
            Buffer.from(BOOTSTRAP_INPUT),
            env,
            root,
            { allowed: [17], timeout: 120_000, maximum: 64 }
          )
        ).rejects.toThrow(/output exceeded bound/);
      });
    });

    it("enforces the scoped deadline after the actual child emits its original payload", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        const args = [fixture.entry, "--wait-for-scoped-deadline"];
        const failure = await dispatchTool(
          fixture.context,
          "node",
          args,
          Buffer.from(BOOTSTRAP_INPUT),
          env,
          root,
          { allowed: [17], timeout: 1500, maximum: 3_145_728 }
        ).then(
          () => {
            throw Error("deadline child unexpectedly completed");
          },
          error => error
        );
        expect(failure.message).toMatch(/deadline|child failed \(124\)/);
        expect(JSON.parse(failure.stdout.toString())).toEqual({
          args: args.slice(1),
          input: BOOTSTRAP_INPUT,
          cwd: root,
          context: fixture.file,
          preloads: 1,
        });
      });
    });

    it.each([
      [INSTRUMENTED_ORIGIN, 0],
      [LAUNCHER_BOOTSTRAP, 0],
      [INSTRUMENTED_ORIGIN, 501],
      [LAUNCHER_BOOTSTRAP, 503],
    ] as const)(
      "carries one preload and original data through %s with %i extra elements",
      async (chain, extra) => {
        await withPrivateRoot(async (root, env) => {
          const fixture = await directBootstrapFixture(root);
          const args =
            extra === 0
              ? [fixture.entry, "literal \nΩ", "", "--"]
              : [fixture.entry, ...Array<string>(extra).fill("")];
          let stdout: Buffer;
          let code: number;
          if (chain === LAUNCHER_BOOTSTRAP) {
            const { dispatchTool } =
              await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
            ({ stdout, code } = await dispatchTool(
              fixture.context,
              "node",
              args,
              Buffer.from(BOOTSTRAP_INPUT),
              env,
              root
            ));
          } else {
            // This outer supervisor remains uninstrumented; the actual origin is explicitly instrumented.
            ({ stdout, code } = await runProcess(
              process.execPath,
              [
                "--import",
                fixture.pathToFileURL(fixture.adapter).href,
                fixture.caller,
                ...args,
              ],
              {
                cwd: root,
                env: { ...env, LISA_NPM_DISPATCH_CONTEXT: fixture.file },
                input: BOOTSTRAP_INPUT,
                allowed: [17],
              }
            ));
          }
          expect(code).toBe(17);
          expect(JSON.parse(stdout.toString())).toEqual({
            args: args.slice(1),
            input: BOOTSTRAP_INPUT,
            cwd: root,
            context: fixture.file,
            preloads: 1,
          });
        });
      }
    );

    it("retains loader, alias, transitive-byte and environment refusals", async () => {
      const { dispatchTool } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-tool-launcher.mjs");
      await withPrivateRoot(async (root, env) => {
        const fixture = await directBootstrapFixture(root);
        const dispatch = (args: string[], environment = env) =>
          dispatchTool(
            fixture.context,
            "node",
            args,
            Buffer.alloc(0),
            environment,
            root
          );
        for (const args of [
          [
            "--import",
            fixture.pathToFileURL(fixture.adapter).href,
            fixture.entry,
          ],
          [
            fixture.entry,
            "--import",
            fixture.pathToFileURL(fixture.adapter).href,
          ],
          [fixture.entry, ...Array(512).fill("")],
          [fixture.entry, ...Array(504).fill("")],
        ])
          await expect(dispatch(args)).rejects.toThrow(/loader|argument/);
        for (const name of ["NODE_OPTIONS", "NODE_PATH"])
          await expect(
            dispatch([fixture.entry], { ...env, [name]: "unqualified" })
          ).rejects.toThrow(/environment loader/);
        await expect(
          dispatch([join(root, "unknown-caller.mjs")])
        ).rejects.toThrow(/unmatched candidate workspace mapping/);
        const alias = join(root, "aliased-helper.mjs");
        symlinkSync(fixture.entry, alias);
        await expect(
          dispatchTool(
            {
              ...fixture.context,
              graph: {
                ...fixture.context.graph,
                [alias]: fixture.context.graph[fixture.entry],
              },
            },
            "node",
            [fixture.entry],
            Buffer.alloc(0),
            env,
            root
          )
        ).rejects.toThrow(/aliased/);
        try {
          await runProcess(
            process.execPath,
            [
              "--import",
              fixture.pathToFileURL(fixture.adapter).href,
              fixture.caller,
              fixture.entry,
              "--import",
              fixture.pathToFileURL(fixture.adapter).href,
            ],
            {
              cwd: root,
              env: { ...env, LISA_NPM_DISPATCH_CONTEXT: fixture.file },
            }
          );
          throw Error("unexpected pre-instrumented generic route success");
        } catch (error) {
          if (!error || typeof error !== "object" || !("stderr" in error))
            throw error;
          expect(String(error.stderr)).toContain(
            "unqualified controller loader route"
          );
        }
        const overflow = boundedTestSpawnSync({
          label: "actual adapter final vector refusal",
          command: process.execPath,
          args: [
            "--import",
            fixture.pathToFileURL(fixture.adapter).href,
            fixture.caller,
            fixture.entry,
            ...Array<string>(505).fill(""),
          ],
          cwd: root,
          env: { ...env, LISA_NPM_DISPATCH_CONTEXT: fixture.file },
        });
        expect(overflow.status).toBe(1);
        expect(overflow.stderr).toContain("invalid or unbounded tool argument");
        writeFileSync(
          fixture.caller,
          "throw Error('changed transitive source');"
        );
        await expect(dispatch([fixture.entry])).rejects.toThrow(
          /graph changed/
        );
      });
    });
  }
);

const SHA = "a".repeat(40);
const POLICY = {
  version: 1,
  repository: "acme/widgets",
  directory: ".",
  target: "main",
  maintainer: "maintainer",
  packages: [{ name: "is-number", version: "7.0.0" }],
  lisaOwner: "absent",
};
const CONFIG = { tracker: "github", github: { org: "acme", repo: "widgets" } };

describe("native publisher Git identity", () => {
  it("computes exact raw blob and commit identities without adding Git objects", async () => {
    const { gitObjectId } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-object.mjs");
    const { mkdirSync, readdirSync } = await import("node:fs");
    const { runProcess } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
    await withPrivateRoot(async (root, env) => {
      const cwd = join(root, "objects");
      mkdirSync(cwd);
      await runProcess("git", ["init", "--object-format=sha1"], { cwd, env });
      const inventory = () =>
        readdirSync(join(cwd, ".git/objects"), {
          recursive: true,
          encoding: "utf8",
        });
      const before = inventory();
      const values = [
        { type: "blob", bytes: Buffer.from([0, 255, 10, 13, 128]) },
        {
          type: "commit",
          bytes: Buffer.from(
            `tree ${SHA}\nparent ${SHA}\nauthor Fixture <fixture@example.invalid> 1780000000 +0000\ncommitter Fixture <fixture@example.invalid> 1780000000 +0000\n\nexact message\n`
          ),
        },
      ];
      for (const value of values) {
        const expected = await runProcess(
          "git",
          ["hash-object", "-t", value.type, "--stdin"],
          { cwd, env, input: value.bytes }
        );
        const actual = gitObjectId(cwd, value.type, value.bytes);
        expect(actual).toBe(expected.stdout.toString().trim());
        const absent = await runProcess("git", ["cat-file", "-e", actual], {
          cwd,
          env,
          allowed: [0, 1, 128],
        });
        expect(absent.code).not.toBe(0);
      }
      expect(inventory()).toEqual(before);
    });
  });
  it("refuses SHA256 repositories, missing cwd, other object kinds and unbounded bytes", async () => {
    const { gitObjectId } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-object.mjs");
    const { mkdirSync } = await import("node:fs");
    const { runProcess } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
    await withPrivateRoot(async (root, env) => {
      const cwd = join(root, "sha256");
      mkdirSync(cwd);
      await runProcess("git", ["init", "--object-format=sha256"], { cwd, env });
      expect(() => gitObjectId(cwd, "blob", Buffer.from("original"))).toThrow(
        /sha1|format/
      );
      expect(() => gitObjectId("", "blob", Buffer.from("original"))).toThrow();
      expect(() => gitObjectId(cwd, "tree", Buffer.from("original"))).toThrow();
      expect(() => gitObjectId(cwd, "blob", Buffer.alloc(1_048_577))).toThrow();
    });
  });
});
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const LOCK = {
  name: "fixture",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": AFTER,
    "node_modules/is-number": {
      version: "7.0.0",
      resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
      integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    },
  },
};
const FILES = {
  [MANIFEST_FILE]: `${JSON.stringify(AFTER)}\n`,
  "package-lock.json": `${JSON.stringify(LOCK)}\n`,
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];

interface HelperAuditNode {
  type?: string;
  name?: string;
  value?: string;
  start?: number;
  end?: number;
  source?: HelperAuditNode;
  callee?: HelperAuditNode;
  arguments?: HelperAuditNode[];
  [key: string]: unknown;
}

async function helperAuditSource(member: string) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { managedTemplateMembers } =
    await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
  const { runProcess } =
    await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
  const file = member.startsWith("package/")
    ? member.slice("package/".length)
    : managedTemplateMembers().get(member);
  expect(file, member).toBeTypeOf("string");
  if (existsSync(file)) return readFileSync(file);
  // Released fallback checks draft-data staleness only, never mixed-owner execution.
  return (
    await runProcess(
      "git",
      ["show", `04c57b040ecc65b9682e84875606f4843a437266:${file}`],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH, HOME: "/nonexistent" },
        maximum: 1_048_576,
      }
    )
  ).stdout;
}

/** Genuine parser coordinates must exist before an audit can qualify a literal source span. */
function auditSourceSpan(text: string, node: HelperAuditNode) {
  if (typeof node.start !== "number" || typeof node.end !== "number")
    throw Error("genuine AST source coordinates required");
  return text.slice(node.start, node.end);
}

function helperAuditEdges(
  node: HelperAuditNode,
  member: string,
  text: string,
  result: Record<"staticImports" | "dynamicImports" | "children", string[]>,
  target: (specifier: string) => string
) {
  if (
    [
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
    ].includes(node.type ?? "") &&
    node.source
  )
    result.staticImports.push(target(node.source.value!));
  const dynamic =
    node.type === "ImportExpression"
      ? node.source
      : node.type === "CallExpression" && node.callee?.type === "Import"
        ? node.arguments?.[0]
        : undefined;
  if (dynamic) {
    if (["StringLiteral", "Literal"].includes(dynamic.type ?? ""))
      result.dynamicImports.push(target(dynamic.value!));
    else {
      expect(member).toBe("lib/npm-update-helper.mjs");
      expect(auditSourceSpan(text, node).replace(/\s/g, "")).toBe(
        "import(pathToFileURL(join(owner.root,MEMBERS[0])).href)"
      );
      result.dynamicImports.push(
        "package/plugins/lisa/scripts/intake-blocker-reprobe.mjs"
      );
    }
  }
  const child = node.arguments?.[0];
  const base = node.arguments?.[1];
  if (
    node.type === "NewExpression" &&
    node.callee?.name === "URL" &&
    ["StringLiteral", "Literal"].includes(child?.type ?? "") &&
    typeof child?.value === "string" &&
    base &&
    auditSourceSpan(text, base).replace(/\s/g, "") === "import.meta.url"
  )
    result.children.push(target(child.value));
}

async function helperAuditImports(member: string, bytes: Buffer) {
  const prettier = await import("prettier");
  const parser = Reflect.get(prettier, "__debug") as {
    parse(text: string, options: { parser: string }): Promise<{ ast: unknown }>;
  };
  const { posix } = await import("node:path");
  const { isBuiltin } = await import("node:module");
  const text = bytes.toString("utf8");
  const result: Record<
    "staticImports" | "dynamicImports" | "children",
    string[]
  > = {
    staticImports: [],
    dynamicImports: [],
    children: [],
  };
  const target = (specifier: string) =>
    isBuiltin(specifier)
      ? specifier.startsWith("node:")
        ? specifier
        : `node:${specifier}`
      : posix.normalize(posix.join(posix.dirname(member), specifier));
  const visited = new WeakSet();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const node = value as HelperAuditNode;
    helperAuditEdges(node, member, text, result, target);
    for (const [key, child] of Object.entries(node))
      if (!["comments", "tokens", "loc", "extra"].includes(key)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
  };
  if (member.endsWith(".mjs"))
    visit((await parser.parse(text, { parser: "babel" })).ast);
  if (member === RAILS_PREPUSH) {
    expect(text).toContain('const name = "lisa-work-item.mjs";');
    expect(text).toContain("[join(scripts, name), ...args]");
    result.children.push(WORK_ITEM_HELPER);
  }
  for (const field of ["staticImports", "dynamicImports", "children"] as const)
    result[field] = [...new Set(result[field])].sort((left, right) =>
      left.localeCompare(right)
    );
  return result;
}

describe("original object reconstruction remains Git data", () => {
  it(
    "reconstructs the exact raw object and refuses an unqualified runtime before attributed checkout work",
    async () => {
      const { mkdirSync, readFileSync } = await import("node:fs");
      const { runProcess } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
      const { descriptorFor, gateProposal } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs");
      const { publicationObjects } =
        await import("../../../all/copy-overwrite/scripts/lib/npm-update-publish.mjs");
      await withPrivateRoot(async (root, env) => {
        const cwd = join(root, "fixture");
        mkdirSync(cwd);
        writeFileSync(join(cwd, MANIFEST_FILE), JSON.stringify(BEFORE));
        writeFileSync(
          join(cwd, "package-lock.json"),
          JSON.stringify({
            ...LOCK,
            packages: {
              "": BEFORE,
              "node_modules/is-number": {
                ...LOCK.packages["node_modules/is-number"],
                version: "6.0.0",
              },
            },
          })
        );
        const git = (args: string[]) => runProcess("git", args, { cwd, env });
        await git(["init", "--initial-branch=main"]);
        await git(["config", "user.name", "Fixture"]);
        await git(["config", "user.email", "fixture@example.invalid"]);
        await git(["add", MANIFEST_FILE, "package-lock.json"]);
        await git(["commit", "-m", "chore: establish object fixture"]);
        const parent = (await git(["rev-parse", "HEAD"])).stdout
          .toString()
          .trim();
        const policy = validatePolicy(POLICY, CONFIG);
        const proposal = proposalFrom(policy, parent, BEFORE, FILES, UPDATES);
        const config = { automationProvenance: { signerDigest: parent } };
        const allocation = {
          workItem: "acme/widgets#42",
          claimCommentId: 123,
          claimSha256: "c".repeat(64),
        };
        const preview = await descriptorFor({
          cwd,
          proposal,
          policy,
          automation: config.automationProvenance,
          allocation,
          runId: "123",
          runAttempt: "1",
          epoch: 1780000000,
        });
        const { descriptor, message } = preview;
        const raw = Buffer.from(
          `tree ${descriptor.tree}\nparent ${descriptor.parent}\nauthor ${descriptor.author}\ncommitter ${descriptor.committer}\n\n${message}`
        );
        const commit = validateRawCommit(raw, descriptor, cwd);
        await publicationObjects(
          cwd,
          proposal,
          policy,
          config,
          allocation,
          descriptor,
          raw,
          commit
        );
        expect((await git(["cat-file", "commit", commit.sha])).stdout).toEqual(
          raw
        );
        await expect(
          publicationObjects(
            cwd,
            proposal,
            policy,
            config,
            allocation,
            descriptor,
            raw,
            { ...commit, sha: "b".repeat(40) }
          )
        ).rejects.toThrow(/raw object differs/);
        await expect(
          gateProposal({
            cwd,
            proposal,
            policy,
            allocation,
            preview,
            bundle: "{}",
            token: "fixture-read-only",
            config: {},
          })
        ).rejects.toThrow(/runtime|platform|isolation|hosted/);
        expect(
          (await git(["rev-parse", "HEAD"])).stdout.toString().trim()
        ).toBe(parent);
        expect((await git(["status", "--porcelain"])).stdout.length).toBe(0);
        expect(
          JSON.parse(readFileSync(join(cwd, MANIFEST_FILE), "utf8"))
        ).toEqual(BEFORE);
      });
    },
    ioLatencyBudgetMs(30_000)
  );
});

describe("complete authenticated helper closure", () => {
  it("audits the complete fixed inventory separately from the external selector budget", async () => {
    const {
      helperManifest,
      controllerMembers,
      managedClosure,
      managedControllerSelection,
      auditControllerClosure,
    } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
    const { readFileSync } = await import("node:fs");
    const manifest = helperManifest(readFileSync(HELPER_GRAPH_FILE));
    const members = controllerMembers(manifest);
    const first = members[0];
    if (!first) throw Error("complete inventory fixture required");
    const bytes = new Map<string, Buffer>();
    for (const member of members)
      bytes.set(member, await helperAuditSource(member));
    expect(members.length).toBe(96);
    expect(auditControllerClosure(manifest, bytes)).toEqual(
      [...members].sort((left, right) => left.localeCompare(right))
    );
    expect(() => managedClosure(manifest, bytes, members)).toThrow(/selection/);
    const missing = new Map(bytes);
    missing.delete(first);
    expect(() => auditControllerClosure(manifest, missing)).toThrow(
      /inventory/
    );
    const foreign = new Map(bytes);
    foreign.set("foreign.mjs", Buffer.from("foreign"));
    expect(() => auditControllerClosure(manifest, foreign)).toThrow(
      /inventory/
    );
    const oversized = new Map(bytes);
    oversized.set("npm-updater-helper-graph.json", Buffer.alloc(1_048_577));
    expect(() => auditControllerClosure(manifest, oversized)).toThrow(
      /bounded/
    );
    const selected = members
      .filter(member => !member.startsWith("package/"))
      .slice(0, 64);
    const firstSelected = selected[0];
    if (!firstSelected) throw Error("selector fixture required");
    expect(() => managedClosure(manifest, bytes, selected)).not.toThrow();
    expect(managedControllerSelection(manifest, bytes, selected)).toEqual(
      expect.arrayContaining([
        "lib/npm-update-helper-graph.mjs",
        "npm-updater-helper-graph.json",
      ])
    );
    expect(() =>
      managedClosure(manifest, bytes, [...selected, firstSelected])
    ).toThrow(/selection/);
    expect(() => managedClosure(manifest, bytes, [first, first])).toThrow(
      /selection/
    );
    const duplicate = readFileSync(HELPER_GRAPH_FILE, "utf8").replace(
      '"version": 1,',
      '"version": 1, "version": 1,'
    );
    expect(() => helperManifest(Buffer.from(duplicate))).toThrow(/canonical/);
  });
  it("matches the real upstream AST import and child inventory including independently authenticated controls", async () => {
    const { readFileSync } = await import("node:fs");
    const { helperManifest } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
    const manifest = helperManifest(readFileSync(HELPER_GRAPH_FILE));
    for (const [member, record] of Object.entries({
      ...manifest.members,
      ...manifest.controls,
    })) {
      const observed = await helperAuditImports(
        member,
        await helperAuditSource(member)
      );
      expect(observed, member).toEqual({
        staticImports: record.staticImports,
        dynamicImports: record.dynamicImports,
        children: record.children,
      });
    }
  });
  it("requires regeneration when any audited upstream source byte changes", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { managedTemplateMembers, helperManifest } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
    const { runProcess } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
    const inventory = managedTemplateMembers();
    const manifest = helperManifest(
      readFileSync("all/copy-overwrite/scripts/npm-updater-helper-graph.json")
    );
    for (const [member, record] of Object.entries(manifest.members)) {
      const file = member.startsWith("package/")
        ? member.slice("package/".length)
        : inventory.get(member);
      expect(file, member).toBeTypeOf("string");
      // Immutable released inputs only qualify draft-data staleness, never mixed-owner execution.
      const bytes = existsSync(file)
        ? readFileSync(file)
        : (
            await runProcess(
              "git",
              ["show", `04c57b040ecc65b9682e84875606f4843a437266:${file}`],
              {
                cwd: process.cwd(),
                env: { PATH: process.env.PATH, HOME: "/nonexistent" },
                maximum: 1_048_576,
              }
            )
          ).stdout;
      expect(sha256(bytes), `stale helper graph member: ${member}`).toBe(
        record.sha256
      );
    }
  });
  it("streams actual owned archive bytes and refuses aliases and multiple links after helper redistribution", async () => {
    const { archiveIntegrity } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs");
    const { createHash } = await import("node:crypto");
    await withPrivateRoot(async root => {
      const file = join(root, "archive.tgz");
      const bytes = Buffer.from("owned archive byte-integrity control");
      writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
      expect(archiveIntegrity(file)).toBe(
        `sha512-${createHash("sha512").update(bytes).digest("base64")}`
      );
      const alias = join(root, "alias.tgz");
      symlinkSync(file, alias);
      expect(() => archiveIntegrity(alias)).toThrow();
      const linked = join(root, "linked.tgz");
      linkSync(file, linked);
      expect(() => archiveIntegrity(file)).toThrow(/owned helper archive/);
    });
  });
  it("includes literal dynamic imports and canonical child edges and refuses missing or changed members", async () => {
    const { managedClosure } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs");
    const bytes = new Map([
      [
        RAILS_PREPUSH,
        Buffer.from('await import("./lib/history-secret-policy.mjs");'),
      ],
      [HISTORY_POLICY, Buffer.from("export const policy = true;")],
      [WORK_ITEM_HELPER, Buffer.from("export const main = true;")],
    ]);
    const manifest = {
      version: 1,
      controls: {},
      members: Object.fromEntries(
        [...bytes].map(([member, body]) => [
          member,
          {
            sha256: sha256(body),
            staticImports: [],
            dynamicImports: member === RAILS_PREPUSH ? [HISTORY_POLICY] : [],
            children: member === RAILS_PREPUSH ? [WORK_ITEM_HELPER] : [],
          },
        ])
      ),
    };
    expect(managedClosure(manifest, bytes, [RAILS_PREPUSH])).toEqual([
      HISTORY_POLICY,
      RAILS_PREPUSH,
      WORK_ITEM_HELPER,
    ]);
    const missing = new Map(bytes);
    missing.delete(HISTORY_POLICY);
    expect(() => managedClosure(manifest, missing, [RAILS_PREPUSH])).toThrow(
      /missing/
    );
    const changed = new Map(bytes);
    changed.set(HISTORY_POLICY, Buffer.from('await import("./foreign.mjs");'));
    expect(() => managedClosure(manifest, changed, [RAILS_PREPUSH])).toThrow(
      /hash|changed/
    );
    const foreign = structuredClone(manifest);
    const foreignEntry = foreign.members[RAILS_PREPUSH];
    if (!foreignEntry) throw Error("Rails helper fixture required");
    foreignEntry.dynamicImports.push("../../foreign.mjs");
    expect(() => managedClosure(foreign, bytes, [RAILS_PREPUSH])).toThrow(
      /path|inventory/
    );
    expect(() => managedClosure(manifest, bytes, ["application.mjs"])).toThrow(
      /inventory/
    );
  });
});

describe("released owner receipt reconciliation", () => {
  const receipt = {
    harness: "codex",
    schema_version: 1,
    apply_mode: "full",
    lisa_version: "4.70.1",
    stale_paths: [],
  };
  it("accepts a matching full receipt only with unchanged tracked baseline", () => {
    expect(validateOwnerReceipt(receipt, "4.70.1", "", "codex")).toBe(receipt);
    for (const changes of [
      { schema_version: 2 },
      { apply_mode: "partial" },
      { lisa_version: "4.70.0" },
      { stale_paths: ["scripts/lisa-work-item.mjs"] },
      { stale_paths: undefined },
    ])
      expect(() =>
        validateOwnerReceipt({ ...receipt, ...changes }, "4.70.1", "", "codex")
      ).toThrow();
  });
  it("retains actual stale paths and Git status as diagnostic rather than filtering them", () => {
    const stale = { ...receipt, stale_paths: ["scripts/lisa-work-item.mjs"] };
    try {
      validateOwnerReceipt(stale, "4.70.1", "", "codex");
      throw Error("unexpected qualification");
    } catch (error) {
      expect(error).toMatchObject({
        qualification: { stalePaths: stale.stale_paths },
      });
    }
    const status = " M package.json\n?? unexpected-source.mjs";
    try {
      validateOwnerReceipt(receipt, "4.70.1", status, "codex");
      throw Error("unexpected qualification");
    } catch (error) {
      expect(error).toMatchObject({ qualification: { status } });
    }
  });
});

/** HTTP fixtures exercise cleanup/deadlines only, never public runtime qualification. */
describe("anonymous archive transport refusal cleanup", () => {
  const digest = "a".repeat(64);
  const entry = {
    image: `sha256:${digest}`,
    platform: ARM64_PLATFORM,
    archive: {
      url: `https://github.com/CodySwannGT/lisa/releases/download/v4.70.1/npm-updater-gate-linux-arm64-${digest}.tar.gz`,
      sha256: digest,
      bytes: 1,
      uncompressedBytes: 1,
      config: `sha256:${"b".repeat(64)}`,
    },
  };
  it("cancels a refused declared length and preserves a foreign-existing output", async () => {
    let canceled = 0;
    const response = (headers = {}) =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled++;
          },
        }),
        { headers }
      );
    const request = vi.spyOn(globalThis, "fetch");
    try {
      await withPrivateRoot(async root => {
        request.mockResolvedValueOnce(response({ "content-length": "2" }));
        await expect(downloadRuntimeArchive(root, entry)).rejects.toThrow(
          /length/
        );
        expect(canceled).toBe(1);
        const file = join(root, `runtime-${digest}.tar.gz`);
        writeFileSync(file, "preserve", { mode: 0o600 });
        request.mockResolvedValueOnce(response());
        await expect(downloadRuntimeArchive(root, entry)).rejects.toThrow();
        expect(canceled).toBe(2);
        expect(readBytes(file).toString()).toBe("preserve");
      });
    } finally {
      request.mockRestore();
    }
  });
  it("a deadline remains a failure even when the final received byte count matches", async () => {
    vi.useFakeTimers();
    let canceled = false;
    let sent = false;
    const body = new ReadableStream(
      {
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new Uint8Array([0]));
          }
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(body));
    try {
      await withPrivateRoot(async root => {
        const refused = expect(
          downloadRuntimeArchive(root, entry)
        ).rejects.toThrow(/deadline/);
        await vi.advanceTimersByTimeAsync(180_001);
        await refused;
        expect(canceled).toBe(true);
      });
    } finally {
      request.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("closed npm proposal", () => {
  it("keeps private evidence singly owned and rejects aliased or invalid bounded reads", async () => {
    await withPrivateRoot(async root => {
      const file = join(root, "private.json");
      writeFileSync(file, "{}\n", { mode: 0o600 });
      expect(readBytes(file, 3).toString()).toBe("{}\n");
      expect(() => readBytes(file, Infinity)).toThrow(/bound/);
      expect(() => readBytes(file, 2)).toThrow();
      const alias = join(root, "alias");
      symlinkSync(file, alias);
      expect(() => readBytes(alias)).toThrow();
      linkSync(file, join(root, "hard-link"));
      expect(() => readBytes(file)).toThrow(/private/);
    });
  });
  it("refuses a host that explicitly requires Bun before candidate execution", () => {
    expect(() =>
      validateHost({ ...BEFORE, engines: { npm: "please-use-bun" } })
    ).toThrow(/engines/);
    expect(() =>
      validateHost({ ...BEFORE, packageManager: "bun@1.3.8" })
    ).toThrow(/manager/);
  });
  it("requires a complete canonical SHA512 digest rather than a syntactic prefix", () => {
    for (const integrity of [
      "sha512-YQ==",
      `sha512-${Buffer.alloc(64).toString("base64").replace(/=+$/, "")}`,
    ]) {
      const lock = structuredClone(LOCK);
      lock.packages["node_modules/is-number"].integrity = integrity;
      expect(() =>
        proposalFrom(
          POLICY,
          SHA,
          BEFORE,
          { ...FILES, "package-lock.json": JSON.stringify(lock) },
          UPDATES
        )
      ).toThrow(/integrity/);
    }
  });
  it("requires the entire exact ref stream, including new-ref zero and all ranges", () => {
    const branch = `lisa/npm-${"a".repeat(64)}`;
    const refs = `refs/heads/${branch} ${SHA} refs/heads/${branch} ${"0".repeat(40)}\n`;
    expect(refTransport(branch, SHA, refs)).toBe(refs);
    for (const altered of [
      "",
      refs + refs,
      refs.replace("refs/heads/", "HEAD "),
      refs.replace("0".repeat(40), SHA),
    ])
      expect(() => refTransport(branch, SHA, altered)).toThrow();
  });
  it("does not inherit write, issuer, npm config or Git environment", () => {
    const env = candidateEnvironment("/owned/home", {
      PATH: "/usr/bin",
      GH_TOKEN: "write",
      AWS_SECRET_ACCESS_KEY: "secret",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "issuer",
      NODE_OPTIONS: "unsafe",
      NPM_CONFIG_USERCONFIG: "/foreign",
      GIT_CONFIG_COUNT: "1",
    });
    expect(Object.keys(env)).not.toContain("GH_TOKEN");
    expect(Object.keys(env)).not.toContain("NODE_OPTIONS");
    expect(Object.keys(env)).not.toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(env.HOME).toBe("/owned/home");
  });
  it.each(["gate", "install", RUBY_INSTALL_ROLE])(
    "keeps provider and controller identity out of %s workers",
    role => {
      const names = [
        "GH_TOKEN",
        "GH_HOST",
        "GITHUB_REPOSITORY",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_DATE",
      ];
      const source = {
        ...Object.fromEntries(names.map(name => [name, "synthetic-control"])),
        RAILS_ENV: "test",
        DATABASE_PASSWORD: "isolated-test",
      };
      const env = workerEnvironment(source, { role });
      for (const name of names) {
        expect(env).not.toHaveProperty(name);
        expect(() =>
          inspectedEnvironment([`${name}=synthetic-control`])
        ).toThrow(/authority environment/);
      }
      if (role === "gate") {
        expect(env).toHaveProperty("RAILS_ENV", "test");
        expect(env).toHaveProperty("DATABASE_PASSWORD", "isolated-test");
      } else {
        expect(env).not.toHaveProperty("RAILS_ENV");
        expect(env).not.toHaveProperty("DATABASE_PASSWORD");
      }
    }
  );
  it("refuses an absent private JSON file", () =>
    expect(() => readJson("/no-such-owned-proof-4347.json")).toThrow());
  it("binds deterministic identities to actual two-file bytes", () => {
    const policy = validatePolicy(POLICY, CONFIG);
    const proposal = proposalFrom(policy, SHA, BEFORE, FILES, UPDATES);
    expect(validateProposal(proposal, policy)).toEqual(proposal);
    expect(proposalFrom(policy, SHA, BEFORE, FILES, UPDATES).key).toBe(
      proposal.key
    );
    expect(
      proposalFrom(policy, "b".repeat(40), BEFORE, FILES, UPDATES).key
    ).not.toBe(proposal.key);
  });
  it.each([
    { ...POLICY, repository: "foreign/widgets" },
    { ...POLICY, directory: "../escape" },
    { ...POLICY, target: "dev" },
    { ...POLICY, command: "unsafe" },
    { ...POLICY, packages: [{ name: "is-number;id", version: "7.0.0" }] },
    { ...POLICY, packages: [{ name: "is-number", version: "file:/tmp/a" }] },
    { ...POLICY, packages: [{ name: "@codyswann/lisa", version: "4.69.5" }] },
  ])("rejects policy widening %#", bad =>
    expect(() => validatePolicy(bad, CONFIG)).toThrow()
  );
  it("refuses non-GitHub tracking", () =>
    expect(() => validatePolicy(POLICY, { tracker: "jira" })).toThrow());
  it("refuses unknown or modified proposal fields", () => {
    const policy = validatePolicy(POLICY, CONFIG);
    const proposal = proposalFrom(policy, SHA, BEFORE, FILES, UPDATES);
    expect(() =>
      validateProposal({ ...proposal, command: "id" }, policy)
    ).toThrow();
    expect(() =>
      validateProposal({ ...proposal, key: "b".repeat(64) }, policy)
    ).toThrow();
    expect(() =>
      validateProposal(
        { ...proposal, files: { ...FILES, "extra.sh": "id" } },
        policy
      )
    ).toThrow();
  });
  it("rejects undeclared manifest changes and lock mismatch", () => {
    const policy = validatePolicy(POLICY, CONFIG);
    expect(() =>
      proposalFrom(
        policy,
        SHA,
        BEFORE,
        {
          ...FILES,
          [MANIFEST_FILE]: JSON.stringify({
            ...AFTER,
            scripts: { postinstall: "id" },
          }),
        },
        UPDATES
      )
    ).toThrow();
    expect(() =>
      proposalFrom(
        policy,
        SHA,
        BEFORE,
        {
          ...FILES,
          "package-lock.json": JSON.stringify({
            ...LOCK,
            packages: {
              ...LOCK.packages,
              "node_modules/is-number": {
                ...LOCK.packages["node_modules/is-number"],
                version: "6.0.0",
              },
            },
          }),
        },
        UPDATES
      )
    ).toThrow();
  });
  it("rejects token-bearing or nonregistry transitive URLs", () => {
    const policy = validatePolicy(POLICY, CONFIG);
    for (const url of [
      "https://token@registry.npmjs.org/a.tgz",
      "file:/tmp/a",
      "git+ssh://example/a",
    ]) {
      const lock = structuredClone(LOCK);
      lock.packages["node_modules/is-number"].resolved = url;
      expect(() =>
        proposalFrom(
          policy,
          SHA,
          BEFORE,
          { ...FILES, "package-lock.json": JSON.stringify(lock) },
          UPDATES
        )
      ).toThrow();
    }
  });
  it("does not authorize a rewritten raw Git object", () => {
    const raw = `tree ${SHA}\nparent ${SHA}\nauthor github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> 1780000000 +0000\ncommitter github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> 1780000000 +0000\n\nchore(deps): update npm dependencies\n\nWork-Item: acme/widgets#42\nAutomation-Provenance: actions/123/attempts/1\n`;
    const expected = {
      parent: SHA,
      tree: SHA,
      author: raw.split("\n")[2]?.slice(7),
      committer: raw.split("\n")[3]?.slice(10),
      messageSha256: "bad",
    };
    expect(() =>
      validateRawCommit(Buffer.from(raw), expected, "/missing")
    ).toThrow();
    expect(() =>
      validateRawCommit(
        Buffer.from(raw.replace(`parent ${SHA}`, `parent ${"b".repeat(40)}`)),
        expected,
        "/missing"
      )
    ).toThrow();
  });
});

/** Chunk fixtures exercise public transport integrity, never origin authorization. */
describe("bounded durable public checkpoint transport", () => {
  const digest = "f".repeat(64);
  const payload = {
    version: 1,
    proposal: { files: { [MANIFEST_FILE]: "x".repeat(60_000) } },
    allocation: {},
    preview: {},
    bundle: '{"public":"fixture"}',
  };
  it("reassembles exact canonical bytes despite provider comment order", () => {
    const bodies = checkpointComments(payload, digest);
    expect(bodies.length).toBeGreaterThan(2);
    expect(bodies.every(body => Buffer.byteLength(body) <= 24_576)).toBe(true);
    const comments = bodies.map(body => ({ body })).reverse();
    expect(decodeCheckpoint(comments, digest)).toEqual(payload);
    expect(decodeCheckpoint([...comments, comments[1]!], digest)).toEqual(
      payload
    );
  });
  it("refuses missing, forged, differing duplicate, oversized or ambiguous checkpoint", () => {
    const comments = checkpointComments(payload, digest).map(body => ({
      body,
    }));
    for (const values of [
      comments.slice(1),
      [...comments, { body: comments[0]!.body.replace(/.$/, "!") }],
      [...comments, comments.at(-1)!],
      comments.map((entry, index) => ({
        body: index ? entry.body : entry.body.replace("eHh4", "eHh5"),
      })),
    ])
      expect(() => decodeCheckpoint(values, digest)).toThrow();
    expect(() =>
      checkpointComments({ ...payload, bundle: "x".repeat(4_194_305) }, digest)
    ).toThrow();
    expect(() =>
      checkpointComments({ ...payload, token: "forbidden" }, digest)
    ).toThrow();
  });
  it("retains incomplete storage as incomplete without manufacturing success", () => {
    const bodies = checkpointComments(payload, digest);
    expect(() =>
      decodeCheckpoint(
        bodies.slice(0, -1).map(body => ({ body })),
        digest
      )
    ).toThrow(/incomplete/);
    expect(decodeCheckpoint([], digest)).toBeUndefined();
  });
});

describe("base-independent unfinished selection identity", () => {
  it("finds the same selected versions across main advance but separates versions/policy", () => {
    const first = proposalFrom(POLICY, SHA, BEFORE, FILES, UPDATES);
    const next = proposalFrom(POLICY, "b".repeat(40), BEFORE, FILES, UPDATES);
    expect(first.key).not.toBe(next.key);
    expect(first.selectionKey).toBe(selectionKey(POLICY, UPDATES));
    expect(next.selectionKey).toBe(first.selectionKey);
    expect(selectionKey({ ...POLICY, maintainer: "other" }, UPDATES)).not.toBe(
      first.selectionKey
    );
    expect(selectionKey(POLICY, [{ ...UPDATES[0]!, to: "8.0.0" }])).not.toBe(
      first.selectionKey
    );
  });
});

describe("full audit and actual publication streams remain separate", () => {
  const branch = `lisa/npm-${"c".repeat(64)}`;
  const commit = "d".repeat(40);
  it("checks the full original range while reporting actual existing destination as no-op", () => {
    const streams = gateStreams(branch, commit, SHA, commit);
    expect(streams.audit.refs).toContain(
      `${commit} refs/heads/${branch} ${SHA}\n`
    );
    expect(streams.audit.range).toEqual([commit]);
    expect(streams.destination.range).toEqual([]);
    expect(streams.destination.kind).toBe("existing-destination-no-op");
    const receipt = {
      audit: { ...streams.audit, exit: 0 },
      destination: { ...streams.destination, exit: 0 },
    };
    expect(() =>
      assertGateTransport(receipt, branch, commit, SHA, commit)
    ).not.toThrow();
    for (const altered of [
      { ...receipt, audit: { ...receipt.destination } },
      { ...receipt, audit: { ...receipt.audit, range: [] } },
      {
        ...receipt,
        destination: {
          ...receipt.destination,
          refs: receipt.destination.refs + receipt.destination.refs,
        },
      },
      { ...receipt, audit: { ...receipt.audit, exit: 1 } },
    ])
      expect(() =>
        assertGateTransport(altered, branch, commit, SHA, commit)
      ).toThrow();
  });
  it("retains genuine absent-destination zero stream and rejects a changed destination", () => {
    const streams = gateStreams(branch, commit, SHA, null);
    expect(streams.destination.refs).toContain("0".repeat(40));
    expect(streams.destination.range).toEqual([commit]);
    expect(() => gateStreams(branch, commit, SHA, "e".repeat(40))).toThrow();
  });
});

/** Recovered partial bytes remain unauthenticated until the controller verifies origin. */
describe("complete chunks without final checkpoint marker", () => {
  const digest = "b".repeat(64);
  const payload = {
    version: 1,
    proposal: { files: "x".repeat(40_000) },
    allocation: {},
    preview: {},
    bundle: "{}",
  };
  it("recovers exact untrusted payload only when every canonical chunk exists", () => {
    const chunks = checkpointComments(payload, digest)
      .slice(0, -1)
      .map(body => ({ body }));
    expect(recoverPartialCheckpoint(chunks, digest)).toEqual(payload);
    expect(() => recoverPartialCheckpoint(chunks.slice(1), digest)).toThrow();
    expect(() =>
      recoverPartialCheckpoint(
        [...chunks, { body: chunks[0]!.body.replace(/.$/, "!") }],
        digest
      )
    ).toThrow();
  });
});

/** Inspection fixtures prove fail-closed admission only; no Docker runtime is qualified here. */
describe("closed candidate worker boundary", () => {
  const nonce = "9".repeat(64);
  const image = `sha256:${"8".repeat(64)}`;
  const mounts = [
    { source: "/owned/source", target: WORKSPACE, readOnly: true },
  ];
  const profile = { defaultAction: "SCMP_ACT_ERRNO", syscalls: [] };
  const seccompSha256 = sha256(`${canonicalJson(profile)}\n`);
  const supervisor = {
    path: "/usr/local/bin/lisa-npm-supervisor",
    version: "lisa-npm-supervisor 1",
    sha256: "a".repeat(64),
  };
  const expected = {
    nonce,
    image,
    mounts,
    seccompPath: "/owned/seccomp.json",
    seccompSha256,
    network: "none",
    workspace: WORKSPACE,
    deadlineMs: 1500,
    supervisor,
  };
  const inspected = {
    Id: "7".repeat(64),
    Image: image,
    Config: {
      User: "2001:2001",
      Labels: { "dev.lisa.npm.owner": nonce },
      Env: [
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/scratch/home",
        "RUBY_VERSION=3.4.11",
      ],
      Entrypoint: [supervisor.path],
      Cmd: ["1500", "--", NODE_TOOL, "--version"],
    },
    HostConfig: {
      ReadonlyRootfs: true,
      Privileged: false,
      PidMode: "",
      IpcMode: "private",
      CapDrop: ["ALL"],
      CapAdd: null,
      SecurityOpt: ["no-new-privileges", `seccomp=${canonicalJson(profile)}`],
      PidsLimit: 512,
      Memory: 4_294_967_296,
      NanoCpus: 4_000_000_000,
      NetworkMode: "none",
      Binds: null,
      Devices: [],
      DeviceRequests: null,
      GroupAdd: null,
      ExtraHosts: null,
      Links: null,
      VolumesFrom: null,
      ReadonlyPaths: [
        "/proc/bus",
        "/proc/fs",
        "/proc/irq",
        "/proc/sys",
        "/proc/sysrq-trigger",
      ],
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,size=536870912,mode=1777",
        [CANDIDATE_HOME]:
          "rw,nosuid,nodev,size=536870912,uid=2001,gid=2001,mode=700",
        "/workspace/tmp":
          "rw,nosuid,nodev,size=536870912,uid=2001,gid=2001,mode=700",
      },
    },
    Mounts: [
      {
        Type: "bind",
        Source: "/owned/source",
        Destination: WORKSPACE,
        RW: false,
      },
    ],
  };
  it("admits the exact inspected nonroot namespace without ambient control credentials", () => {
    expect(() => assertWorkerInspection(inspected, expected)).not.toThrow();
  });
  it("refuses privileged or foreign namespace, mutable authority, extra mounts and issuer environment", () => {
    const cases = [
      { Config: { ...inspected.Config, User: "0" } },
      {
        Config: {
          ...inspected.Config,
          Labels: { "dev.lisa.npm.owner": "foreign" },
        },
      },
      {
        Config: {
          ...inspected.Config,
          Env: [...inspected.Config.Env, "ACTIONS_RUNTIME_TOKEN=untrusted"],
        },
      },
      { HostConfig: { ...inspected.HostConfig, Privileged: true } },
      { HostConfig: { ...inspected.HostConfig, PidMode: "host" } },
      { HostConfig: { ...inspected.HostConfig, ReadonlyRootfs: false } },
      { HostConfig: { ...inspected.HostConfig, CapAdd: ["SYS_ADMIN"] } },
      { HostConfig: { ...inspected.HostConfig, GroupAdd: ["0"] } },
      { HostConfig: { ...inspected.HostConfig, ReadonlyPaths: [] } },
      { HostConfig: { ...inspected.HostConfig, NanoCpus: 0 } },
      {
        HostConfig: {
          ...inspected.HostConfig,
          SecurityOpt: ["no-new-privileges", "seccomp=unconfined"],
        },
      },
      {
        HostConfig: {
          ...inspected.HostConfig,
          Tmpfs: { ...inspected.HostConfig.Tmpfs, "/control": "rw" },
        },
      },
      { Config: { ...inspected.Config, Entrypoint: ["/bin/sh"] } },
      { Mounts: [{ ...inspected.Mounts[0]!, RW: true }] },
      {
        Mounts: [
          ...inspected.Mounts,
          {
            Type: "bind",
            Source: "/var/run/docker.sock",
            Destination: "/daemon",
            RW: true,
          },
        ],
      },
    ];
    for (const changes of cases)
      expect(() =>
        assertWorkerInspection({ ...inspected, ...changes }, expected)
      ).toThrow();
  });
  it("checks the daemon-observed Ruby frozen path rather than only allowed names", () => {
    const rubyExpected = {
      ...expected,
      role: RUBY_INSTALL_ROLE,
      uid: 2001,
      gid: 2001,
    };
    const env = [
      ...inspected.Config.Env,
      "BUNDLE_PATH=/workspace/vendor/bundle",
      "BUNDLE_FROZEN=true",
      "BUNDLE_APP_CONFIG=/home/candidate/bundle",
    ];
    expect(() =>
      assertWorkerInspection(
        { ...inspected, Config: { ...inspected.Config, Env: env } },
        rubyExpected
      )
    ).not.toThrow();
    for (const changed of [
      "BUNDLE_PATH=/foreign",
      "BUNDLE_FROZEN=false",
      "BUNDLE_APP_CONFIG=/foreign",
    ]) {
      const name = changed.split("=")[0];
      expect(() =>
        assertWorkerInspection(
          {
            ...inspected,
            Config: {
              ...inspected.Config,
              Env: env
                .filter(value => !value.startsWith(`${name}=`))
                .concat(changed),
            },
          },
          rubyExpected
        )
      ).toThrow(/Ruby|frozen/);
    }
  });
  it("separates Ruby installer writes from npm, gates and alternate paths", () => {
    const boundary = {
      role: RUBY_INSTALL_ROLE,
      uid: 501,
      gid: 20,
      root: CONTROLLER_ROOT,
      docker: DOCKER_TOOL,
      dockerSha256: "a".repeat(64),
      nonce: "9".repeat(48),
      platform: ARM64_PLATFORM,
      image,
      network: "none",
      seccompPath: SECCOMP_FILE,
      seccompSha256,
      supervisor,
      deadlineMs: 1500,
      workspace: WORKSPACE,
      cwd: WORKSPACE,
      mounts: [
        mounts[0],
        {
          source: "/owned/controller/ruby-dependencies",
          target: "/workspace/vendor/bundle",
          readOnly: false,
        },
      ],
    };
    const invocation = {
      command: "/usr/local/bin/bundle",
      args: ["install", "--local"],
    };
    const env = {
      HOME: CANDIDATE_HOME,
      BUNDLE_PATH: "/workspace/vendor/bundle",
      BUNDLE_FROZEN: "true",
      BUNDLE_APP_CONFIG: "/home/candidate/bundle",
    };
    expect(workerArguments(boundary, invocation, env)).toContain(
      "type=bind,src=/owned/controller/ruby-dependencies,dst=/workspace/vendor/bundle"
    );
    for (const role of ["install", "gate"])
      expect(() =>
        workerArguments({ ...boundary, role }, invocation, env)
      ).toThrow();
    expect(() =>
      workerArguments(boundary, invocation, { ...env, GH_TOKEN: "forbidden" })
    ).toThrow(/authority environment/);
    expect(() =>
      workerArguments(boundary, invocation, { ...env, BUNDLE_FROZEN: "false" })
    ).toThrow(/Ruby|frozen/);
    expect(() =>
      workerArguments(boundary, invocation, {
        ...env,
        BUNDLE_PATH: "/workspace/other",
      })
    ).toThrow(/Ruby|path/);
    expect(() =>
      workerArguments(
        {
          ...boundary,
          mounts: [
            mounts[0],
            { ...boundary.mounts[1], target: "/workspace/node_modules" },
          ],
        },
        invocation,
        env
      )
    ).toThrow(/mount/);
  });
  it("separates installer dependency-only writes and refuses controller mounts or credentials", () => {
    const boundary = {
      role: "install",
      uid: 501,
      gid: 20,
      root: CONTROLLER_ROOT,
      docker: DOCKER_TOOL,
      dockerSha256: "a".repeat(64),
      nonce: "9".repeat(48),
      platform: ARM64_PLATFORM,
      image,
      network: "none",
      seccompPath: SECCOMP_FILE,
      seccompSha256,
      supervisor,
      deadlineMs: 1500,
      workspace: WORKSPACE,
      cwd: WORKSPACE,
      mounts: [
        mounts[0],
        {
          source: "/owned/controller/dependencies",
          target: "/workspace/node_modules",
          readOnly: false,
        },
      ],
    };
    const invocation = {
      command: NODE_TOOL,
      args: ["/opt/npm/bin/npm-cli.js", "ci", "--ignore-scripts"],
    };
    const args = workerArguments(boundary, invocation, {
      HOME: CANDIDATE_HOME,
    });
    expect(
      args.slice(args.indexOf("--user"), args.indexOf("--user") + 2)
    ).toEqual(["--user", "501:20"]);
    expect(args).toContain(
      "type=bind,src=/owned/controller/dependencies,dst=/workspace/node_modules"
    );
    expect(() =>
      workerArguments(
        { ...boundary, role: "gate", uid: 2001, gid: 2001 },
        invocation,
        {}
      )
    ).toThrow(/mount/);
    expect(() =>
      workerArguments(boundary, invocation, { GH_TOKEN: "not-allowed" })
    ).toThrow(/authority environment/);
    expect(() =>
      workerArguments(
        {
          ...boundary,
          mounts: [
            { source: boundary.root, target: "/worker-input", readOnly: true },
          ],
        },
        invocation,
        {}
      )
    ).toThrow(/mount/);
    expect(() =>
      workerArguments(
        { ...boundary, mounts: [mounts[0]], cwd: "/workspace,readonly=false" },
        invocation,
        {}
      )
    ).toThrow(/path|boundary/);
  });
  it("refuses read-only control, ancestor, Git and socket sources behind innocent destinations", () => {
    const boundary = {
      role: "gate",
      uid: 2001,
      gid: 2001,
      root: CONTROLLER_ROOT,
      docker: DOCKER_TOOL,
      dockerSha256: "a".repeat(64),
      nonce: "9".repeat(48),
      platform: ARM64_PLATFORM,
      image,
      network: "none",
      seccompPath: SECCOMP_FILE,
      seccompSha256,
      supervisor,
      deadlineMs: 1500,
      workspace: WORKSPACE,
      cwd: WORKSPACE,
      mounts,
    };
    const invocation = { command: NODE_TOOL, args: ["--version"] };
    for (const source of [
      "/owned/controller/launcher.json",
      SECCOMP_FILE,
      "/owned/controller/proof",
      "/owned",
      "/",
      "/owned/source/.git",
      "/var/run/docker.sock",
      "/foreign/application",
      "/owned/source/../controller",
    ])
      expect(() =>
        workerArguments(
          {
            ...boundary,
            mounts: [{ source, target: WORKSPACE, readOnly: true }],
          },
          invocation,
          {}
        )
      ).toThrow(/mount|projection/);
    expect(() =>
      workerArguments(
        {
          ...boundary,
          mounts: [
            {
              source: "/owned/controller/source",
              target: WORKSPACE,
              readOnly: true,
            },
          ],
        },
        invocation,
        {}
      )
    ).not.toThrow();
  });
});

describe("frozen Ruby installation input policy", () => {
  it("preserves exact supported Ruby/Bundler and refuses private, git or configured alternate sources", async () => {
    const { rubyInstallationInputs } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-gate-install.mjs");
    const inputs = {
      lock: "GEM\n  remote: https://rubygems.org/\n  specs:\n    rake (13.2.1)\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n  rake (= 13.2.1)\n\nRUBY VERSION\n   ruby 3.4.11p137\n\nBUNDLED WITH\n   2.4.10\n",
      rubyVersion: "3.4.11\n",
      configurationPresent: false,
    };
    const tools = {
      ruby: { path: "/usr/local/bin/ruby", version: "ruby 3.4.11 (fixture)" },
      bundle: {
        path: "/usr/local/bin/bundle",
        version: "Bundler version 2.4.10",
      },
    };
    expect(typeof rubyInstallationInputs).toBe("function");
    expect(() => rubyInstallationInputs(inputs, tools)).not.toThrow();
    for (const changed of [
      { configurationPresent: true },
      { rubyVersion: "3.4.8" },
      {
        lock: inputs.lock.replace(
          "https://rubygems.org/",
          "https://private.example.invalid/"
        ),
      },
      {
        lock: `GIT\n  remote: https://github.com/acme/unknown\n${inputs.lock}`,
      },
      { lock: inputs.lock.replace("2.4.10", "2.4.9") },
    ])
      expect(() =>
        rubyInstallationInputs({ ...inputs, ...changed }, tools)
      ).toThrow();
    expect(() =>
      rubyInstallationInputs(inputs, {
        ...tools,
        ruby: { ...tools.ruby, version: "ruby 3.4.8" },
      })
    ).toThrow();
  });
});

describe("fleet owner harness authority", () => {
  it("binds the genuine full receipt to the exact configured Codex or fleet harness", () => {
    for (const harness of ["codex", "fleet"]) {
      const receipt = {
        schema_version: 1,
        apply_mode: "full",
        lisa_version: "4.70.1",
        stale_paths: [],
        harness,
      };
      expect(validateOwnerReceipt(receipt, "4.70.1", "", harness)).toBe(
        receipt
      );
      for (const wrong of [
        undefined,
        "claude",
        harness === "fleet" ? "codex" : "fleet",
      ]) {
        expect(() =>
          validateOwnerReceipt(receipt, "4.70.1", "", wrong)
        ).toThrow(/harness/);
      }
      expect(() =>
        validateOwnerReceipt(
          { ...receipt, harness: undefined },
          "4.70.1",
          "",
          harness
        )
      ).toThrow(/harness/);
    }
  });
});

describe("closed qualified runtime contract", () => {
  const profile = {
    defaultAction: "SCMP_ACT_ERRNO",
    syscalls: [
      { names: ["read", "write", "exit_group"], action: "SCMP_ACT_ALLOW" },
    ],
  };
  const tool = {
    path: "/usr/local/bin/tool",
    version: "fixture",
    sha256: "a".repeat(64),
  };
  const archive = {
    url: `https://github.com/CodySwannGT/lisa/releases/download/v4.70.2/npm-updater-gate-linux-arm64-${"a".repeat(64)}.tar.gz`,
    sha256: "a".repeat(64),
    bytes: 1024,
    uncompressedBytes: 2048,
    config: `sha256:${"b".repeat(64)}`,
  };
  const runtime = {
    version: 1,
    recipeSha256: "b".repeat(64),
    supervisorSha256: "d".repeat(64),
    seccomp: { sha256: sha256(`${canonicalJson(profile)}\n`), profile },
    services: [],
    platforms: [
      {
        platform: ARM64_PLATFORM,
        image: `sha256:${"c".repeat(64)}`,
        archive,
        tools: Object.fromEntries(
          [
            "node",
            "npm",
            "git",
            "shell",
            "bash",
            "bun",
            "gh",
            "gitleaks",
            "ruby",
            "bundle",
            "timeout",
            "supervisor",
          ].map(name => [
            name,
            {
              ...tool,
              version:
                name === "node"
                  ? "22.23.3"
                  : name === "npm"
                    ? "11.21.0"
                    : "fixture",
            },
          ])
        ),
      },
    ],
  };
  it("refuses a local-only image ID without its immutable archive transport", () => {
    const { archive: _archive, ...localOnly } = runtime.platforms[0]!;
    expect(() =>
      validateRuntime({ ...runtime, platforms: [localOnly] }, ARM64_PLATFORM)
    ).toThrow(/archive|fields/);
  });
  it("binds exact closed platform/tool/security identity without qualifying fixture images", () => {
    expect(validateRuntime(runtime, ARM64_PLATFORM).image).toBe(
      runtime.platforms[0]!.image
    );
    expect(() => validateRuntime(runtime, "linux/amd64")).toThrow(/platform/);
  });
  it("rejects guessed images, unknown flags, missing tools and process-memory syscall authority", () => {
    const processAccess = {
      ...profile,
      syscalls: [{ names: ["read", "ptrace"], action: "SCMP_ACT_ALLOW" }],
    };
    for (const value of [
      { ...runtime, dockerFlags: ["--privileged"] },
      {
        ...runtime,
        platforms: [{ ...runtime.platforms[0], image: "node:latest" }],
      },
      { ...runtime, platforms: [] },
      { ...runtime, platforms: [{ ...runtime.platforms[0], tools: {} }] },
      {
        ...runtime,
        seccomp: {
          sha256: sha256(`${canonicalJson(processAccess)}\n`),
          profile: processAccess,
        },
      },
      {
        ...runtime,
        seccomp: {
          sha256: sha256(
            `${canonicalJson({ ...profile, listenerPath: "/controller/socket" })}\n`
          ),
          profile: { ...profile, listenerPath: "/controller/socket" },
        },
      },
    ])
      expect(() => validateRuntime(value, ARM64_PLATFORM)).toThrow();
  });
});

/** Byte-bound OCI controls do not claim a published runtime or real provider identity. */
describe("immutable runtime archive graph", () => {
  function graphFixture() {
    const members = new Map<
      string,
      { size: number; bytes: Buffer; sha256: string }
    >();
    const member = (path: string, value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      members.set(path, { bytes, size: bytes.length, sha256: sha256(bytes) });
      return { digest: `sha256:${sha256(bytes)}`, size: bytes.length };
    };
    const blob = (value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      return member(`blobs/sha256/${sha256(bytes)}`, value);
    };
    const config = blob({
      architecture: "arm64",
      os: "linux",
      rootfs: { type: "layers", diff_ids: [] },
    });
    const manifest = blob({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        ...config,
        mediaType: "application/vnd.oci.image.config.v1+json",
      },
      layers: [],
    });
    const index = blob({
      schemaVersion: 2,
      mediaType: OCI_INDEX_TYPE,
      manifests: [
        {
          ...manifest,
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          platform: { architecture: "arm64", os: "linux" },
        },
      ],
    });
    member("index.json", {
      schemaVersion: 2,
      mediaType: OCI_INDEX_TYPE,
      manifests: [{ ...index, mediaType: OCI_INDEX_TYPE }],
    });
    member("manifest.json", [
      {
        Config: `blobs/sha256/${config.digest.slice(7)}`,
        RepoTags: null,
        Layers: [],
      },
    ]);
    member("oci-layout", { imageLayoutVersion: "1.0.0" });
    return {
      members,
      expected: {
        image: index.digest,
        config: config.digest,
        platform: ARM64_PLATFORM,
      },
      member,
    };
  }
  it("binds distinct OCI index and config identities instead of conflating Docker IDs", async () => {
    const { validateArchiveGraph } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-runtime-archive.mjs");
    const { members, expected } = graphFixture();
    expect(expected.image).not.toBe(expected.config);
    expect(validateArchiveGraph(members, expected)).toEqual(expected);
    expect(() =>
      validateArchiveGraph(members, { ...expected, config: expected.image })
    ).toThrow(/config/);
    expect(() =>
      validateArchiveGraph(members, { ...expected, platform: "linux/amd64" })
    ).toThrow(/platform/);
  });
  it("refuses repository tags and unreferenced blobs before any daemon load", async () => {
    const { validateArchiveGraph } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-runtime-archive.mjs");
    const fixture = graphFixture();
    fixture.member("manifest.json", [
      {
        Config: `blobs/sha256/${fixture.expected.config.slice(7)}`,
        RepoTags: ["foreign:latest"],
        Layers: [],
      },
    ]);
    expect(() =>
      validateArchiveGraph(fixture.members, fixture.expected)
    ).toThrow(/tag/);
    const other = graphFixture();
    other.member(`blobs/sha256/${sha256("unexpected")}`, "unexpected");
    expect(() => validateArchiveGraph(other.members, other.expected)).toThrow(
      /unreferenced|digest/
    );
  });
  function archiveBytes(members: Map<string, { bytes: Buffer }>) {
    const records = [];
    for (const [name, member] of members) {
      const header = Buffer.alloc(512);
      header.write(name, 0, 100, "ascii");
      header.write("0000600\0", 100, "ascii");
      header.write("0000000\0", 108, "ascii");
      header.write("0000000\0", 116, "ascii");
      header.write(
        `${member.bytes.length.toString(8).padStart(11, "0")}\0`,
        124,
        "ascii"
      );
      header.write("00000000000\0", 136, "ascii");
      header.fill(32, 148, 156);
      header[156] = name.endsWith("/") ? 53 : 48;
      const sum = header.reduce((value, byte) => value + byte, 0);
      header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
      records.push(
        header,
        member.bytes,
        Buffer.alloc((512 - (member.bytes.length % 512)) % 512)
      );
    }
    return Buffer.concat([...records, Buffer.alloc(1024)]);
  }
  it("streams real gzip/tar bytes and refuses truncation, changed whole bytes or a duplicate member", async () => {
    const { inspectRuntimeArchive } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-runtime-archive.mjs");
    const fixture = graphFixture();
    const raw = archiveBytes(
      new Map<string, { bytes: Buffer }>([
        ["blobs/", { bytes: Buffer.alloc(0) }],
        ["blobs/sha256/", { bytes: Buffer.alloc(0) }],
        ...fixture.members,
      ])
    );
    await withPrivateRoot(async root => {
      const file = join(root, "archive.tar.gz");
      const bytes = gzipSync(raw);
      writeFileSync(file, bytes, { mode: 0o600 });
      const identity = {
        ...fixture.expected,
        bytes: bytes.length,
        sha256: sha256(bytes),
        uncompressedBytes: raw.length,
      };
      expect(await inspectRuntimeArchive(file, identity)).toEqual(
        fixture.expected
      );
      await expect(
        inspectRuntimeArchive(file, { ...identity, sha256: "f".repeat(64) })
      ).rejects.toThrow(/identity/);
      const truncated = gzipSync(raw.subarray(0, raw.length - 1024));
      writeFileSync(file, truncated, { mode: 0o600 });
      await expect(
        inspectRuntimeArchive(file, {
          ...identity,
          bytes: truncated.length,
          sha256: sha256(truncated),
          uncompressedBytes: raw.length - 1024,
        })
      ).rejects.toThrow(/truncated/);
      const duplicate = Buffer.concat([raw.subarray(0, 1024), raw]);
      const duplicateGzip = gzipSync(duplicate);
      writeFileSync(file, duplicateGzip, { mode: 0o600 });
      await expect(
        inspectRuntimeArchive(file, {
          ...identity,
          bytes: duplicateGzip.length,
          sha256: sha256(duplicateGzip),
          uncompressedBytes: duplicate.length,
        })
      ).rejects.toThrow(/duplicate/);
    });
  });
});

describe("closed immutable runtime transport", () => {
  it("requires anonymous immutable asset and exact bounded archive/config identity", async () => {
    const { validateArchiveTransport } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-runtime-transport.mjs");
    const archive = {
      url: `https://github.com/CodySwannGT/lisa/releases/download/v4.70.2/npm-updater-gate-linux-arm64-${"a".repeat(64)}.tar.gz`,
      sha256: "a".repeat(64),
      bytes: 1024,
      uncompressedBytes: 2048,
      config: `sha256:${"b".repeat(64)}`,
    };
    expect(validateArchiveTransport(archive, ARM64_PLATFORM)).toEqual(archive);
    for (const invalid of [
      { ...archive, bytes: 1_000_000_000 },
      { ...archive, uncompressedBytes: 1_500_000_000 },
      { ...archive, url: "https://example.invalid/runtime.tar.gz" },
      { ...archive, config: "node:latest" },
      { ...archive, authorization: "forbidden" },
    ])
      expect(() => validateArchiveTransport(invalid, ARM64_PLATFORM)).toThrow();
  });
});

describe("worker capture deadline", () => {
  it("retains the original outer budget while allowing bounded supervisor cleanup", async () => {
    const { workerCaptureBudget } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-worker-lifecycle.mjs");
    expect(workerCaptureBudget(1500)).toBe(7500);
    expect(workerCaptureBudget(1_800_000)).toBe(1_800_000);
    expect(() => workerCaptureBudget(1_800_001)).toThrow(/deadline/);
  });
});
