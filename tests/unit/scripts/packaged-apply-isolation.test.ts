/** Protocol fixtures are unit controls, not native Docker isolation evidence. */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { checkoutFiles } from "../../helpers/tracked-files.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { defaultUserMcpConfigPath } from "../../../src/agy/mcp-installer.js";
import {
  assertDisposableContainer,
  refuseHostApply,
  snapshotFiles,
  compareSnapshots,
  preserveUnexpectedWrite,
} from "../../../scripts/lib/packaged-apply-isolation.mjs";

const roots: string[] = [];
const sentinelFile = "sentinel.json";
const privateBytes = "current private bytes";
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-apply-isolation-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })));
});

function inspection(): Record<string, unknown> {
  return {
    Id: "a".repeat(64),
    State: { Status: "created", Running: false },
    Mounts: [],
    HostConfig: {
      Binds: null,
      Mounts: [],
      VolumesFrom: null,
      Privileged: false,
      Devices: [],
      DeviceRequests: [],
      CapAdd: null,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: "bridge",
      PidMode: "",
      IpcMode: "private",
      UsernsMode: "",
      CgroupnsMode: "private",
    },
  };
}

describe("packaged apply preflight", () => {
  it("carries the shared preflight through every generated Verify surface", async () => {
    const root = path.resolve(".");
    const files = checkoutFiles(root).filter(
      file =>
        file.startsWith("plugins/") &&
        file.endsWith("/skills/lisa-verification-lifecycle/SKILL.md")
    );
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const text = await readFile(path.join(root, file), "utf8");
      expect(text, file).toContain(
        "scripts/verify-packaged-apply.mjs --backend docker"
      );
      expect(text, file).toContain(
        "before/after comparison on success and failure"
      );
    }
  });
  it("the executable refuses with no vendor CLIs and prints only the destination", async () => {
    const emptyPath = await fixture();
    const result = boundedSpawnSync({
      command: process.execPath,
      args: [
        path.resolve("scripts/verify-packaged-apply.mjs"),
        "--harness",
        "fleet",
      ],
      env: { ...process.env, PATH: emptyPath },
      label: "refuse uncontained packaged apply before spawning its CLI",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(defaultUserMcpConfigPath());
    expect(result.stderr).toContain("Refused before spawning apply");
    expect(result.stdout).toBe("");
  });
  it("refuses fleet using the actual user resolver even without vendor CLIs", async () => {
    const project = await fixture();
    const destination = defaultUserMcpConfigPath();
    // The real resolver is called; no agent command or config writer is called.
    expect(path.relative(project, destination).startsWith("..")).toBe(true);
    expect(() => refuseHostApply("fleet", destination)).toThrow(destination);
    expect(() => refuseHostApply("fleet", destination)).toThrow(
      /before.*apply/u
    );
  });

  it.each(["claude", "codex", "cursor", "opencode", "agy", "copilot", "devin"])(
    "fails closed for uncontained %s registration and cache paths",
    harness => {
      expect(() =>
        refuseHostApply(harness, "/outside/mcp_config.json")
      ).toThrow(/disposable/u);
    }
  );

  it("accepts only a stopped container with an isolated writable filesystem", () => {
    expect(() =>
      assertDisposableContainer(inspection(), "a".repeat(64))
    ).not.toThrow();
  });

  it.each([
    ["Mounts", [{ Type: "bind", Source: "/host", Destination: "/work" }]],
    ["State", { Status: "running", Running: true }],
    ["Id", "b".repeat(64)],
  ])("rejects unsafe container %s before starting it", (key, value) => {
    expect(() =>
      assertDisposableContainer(
        { ...inspection(), [key]: value },
        "a".repeat(64)
      )
    ).toThrow();
  });

  it.each([
    ["Binds", ["/host:/work"]],
    ["Mounts", [{ Type: "bind", Source: "/host" }]],
    ["VolumesFrom", ["another-container"]],
    ["Privileged", true],
    ["Devices", [{ PathOnHost: "/dev/sda" }]],
    ["DeviceRequests", [{ Count: -1 }]],
    ["CapAdd", ["SYS_ADMIN"]],
    ["CapDrop", []],
    ["SecurityOpt", []],
    ["NetworkMode", "host"],
    ["PidMode", "host"],
    ["IpcMode", "host"],
    ["UsernsMode", "host"],
    ["CgroupnsMode", "host"],
  ])("rejects unsafe HostConfig.%s", (key, value) => {
    const row = inspection();
    row.HostConfig = { ...(row.HostConfig as object), [key]: value };
    expect(() => assertDisposableContainer(row, "a".repeat(64))).toThrow();
  });

  it("does not accept an incomplete inspection as isolation proof", () => {
    expect(() => assertDisposableContainer({}, "a".repeat(64))).toThrow();
  });
});

describe("outside destination preservation", () => {
  it("refuses an initial symlink even when its target is absent", async () => {
    const root = await fixture();
    const link = path.join(root, "initial-link.json");
    await symlink("absent-target.json", link);
    await expect(snapshotFiles([link])).rejects.toThrow(/not a regular file/u);
  });
  it("records a post-run symlink and still captures another changed file", async () => {
    const root = await fixture();
    const config = path.join(root, "replaced.json");
    const other = path.join(root, "other.json");
    const targetName = "private-link-target.json";
    const target = path.join(root, targetName);
    const otherAfter = "independent change";
    await writeFile(config, "original config");
    await writeFile(other, "original other");
    await writeFile(target, privateBytes);
    const before = await snapshotFiles(
      [config, other],
      path.join(root, "before")
    );
    await rm(config);
    await symlink(targetName, config);
    await writeFile(other, otherAfter);
    const images = path.join(root, "after");
    const after = await snapshotFiles([config, other], images, {
      phase: "after",
    });
    expect(compareSnapshots(before, after)).toEqual([config, other]);
    expect(after[config]).toMatchObject({ present: true, kind: "symlink" });
    expect(JSON.stringify(after)).not.toContain(targetName);
    expect(JSON.stringify(after)).not.toContain(privateBytes);
    const captured = await Promise.all(
      (await readdir(images)).map(name =>
        readFile(path.join(images, name), "utf8")
      )
    );
    expect(captured).toEqual(expect.arrayContaining([targetName, otherAfter]));
    const recovery = await preserveUnexpectedWrite(
      config,
      path.join(root, "link-recovery")
    );
    expect(await readFile(recovery.copy, "utf8")).toBe(targetName);
    expect((await stat(recovery.copy)).mode & 0o777).toBe(0o600);
    expect(await readFile(target, "utf8")).toBe(privateBytes);
    expect(recovery.restored).toBe(false);
  });
  it("preserves non-UTF8 symlink bytes in after-images and unknown-content recovery", async () => {
    const root = await fixture();
    const link = path.join(root, "raw-link");
    const target = Buffer.from([0x6c, 0x69, 0x6e, 0x6b, 0xff]);
    await symlink(target, link);
    const images = path.join(root, "raw-images");
    const after = await snapshotFiles([link], images, { phase: "after" });
    expect(after[link]).toMatchObject({
      present: true,
      kind: "symlink",
      bytes: target.length,
    });
    const [name] = await readdir(images);
    if (!name) throw new Error("No captured raw link image");
    expect(await readFile(path.join(images, name))).toEqual(target);
    const recovery = await preserveUnexpectedWrite(
      link,
      path.join(root, "raw-recovery")
    );
    expect(await readFile(recovery.copy)).toEqual(target);
    expect(recovery.prior_content).toBe("unknown");
    expect(recovery.restored).toBe(false);
  });
  it("retains complete private before-images without exposing bytes in reports", async () => {
    const root = await fixture();
    const file = path.join(root, "settings.json");
    const images = path.join(root, "before-images");
    await writeFile(file, privateBytes);
    const report = await snapshotFiles([file], images);
    const [image] = await readdir(images);
    if (!image) throw new Error("No captured before-image");
    const captured = path.join(images, image);
    expect(await readFile(captured, "utf8")).toBe(privateBytes);
    expect((await stat(captured)).mode & 0o777).toBe(0o600);
    expect((await stat(images)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(report)).not.toContain(privateBytes);
    await writeFile(file, "changed");
    expect(await readFile(captured, "utf8")).toBe(privateBytes);
  });
  it("compares both host and Lisa-managed entries without exclusions", async () => {
    const root = await fixture();
    const config = path.join(root, sentinelFile);
    const absent = path.join(root, "absent.json");
    await writeFile(
      config,
      JSON.stringify({ host: {}, lisa: { _lisaManaged: true } })
    );
    const before = await snapshotFiles([config, absent]);
    expect(
      compareSnapshots(before, await snapshotFiles([config, absent]))
    ).toEqual([]);
    await writeFile(config, JSON.stringify({ host: {} }));
    await writeFile(absent, "unexpected");
    expect(
      compareSnapshots(before, await snapshotFiles([config, absent]))
    ).toEqual([config, absent]);
  });

  it("privately preserves unknown current bytes and never guesses a restoration", async () => {
    const root = await fixture();
    const config = path.join(root, "unknown.json");
    await writeFile(config, privateBytes);
    expect(compareSnapshots({}, await snapshotFiles([config]))).toEqual([
      config,
    ]);
    const recovery = await preserveUnexpectedWrite(
      config,
      path.join(root, "evidence")
    );
    expect(recovery.prior_content).toBe("unknown");
    expect(recovery.restored).toBe(false);
    expect(await readFile(recovery.copy, "utf8")).toBe(privateBytes);
    expect((await stat(recovery.copy)).mode & 0o777).toBe(0o600);
    expect(await readFile(config, "utf8")).toBe(privateBytes);
  });
  it("refuses recovery into an existing non-private directory", async () => {
    const root = await fixture();
    const config = path.join(root, "observed.json");
    const evidence = path.join(root, "public-directory");
    await mkdir(evidence, { mode: 0o755 });
    await chmod(evidence, 0o755);
    await writeFile(config, privateBytes);
    await expect(preserveUnexpectedWrite(config, evidence)).rejects.toThrow(
      /private/u
    );
    expect(await readFile(config, "utf8")).toBe(privateBytes);
  });
});
