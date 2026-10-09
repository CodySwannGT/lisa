/**
 * Installed channel skew remains observable without calling historical apply
 * receipts the host's current vintage or prescribing an unnecessary apply.
 * @module tests/integration/enforcement-fallback-freshness-channels
 */
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  datePluginTree,
  PLUGIN_HOOKS,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  installedChannel,
  INSTALLED_VERSION,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

describe("distinct installed plugin channel evidence", () => {
  it("points to the older package when the independently installed plugin is newer", () => {
    const root = currentHost();
    const result = driveFreshness(root, undefined, {
      env: { CLAUDE_CONFIG_DIR: installedChannel(root, "4.73.0") },
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain("cross-channel vintage SKEW");
    expect(result.output).toContain("update the installed Lisa package");
    expect(result.output).not.toContain("update the installed plugin");
    expect(result.output).not.toContain("npx @codyswann/lisa apply");
  });
  it("reports genuine skew while matching host content needs no apply repair", () => {
    const root = currentHost();
    const result = driveFreshness(root, undefined, {
      env: { CLAUDE_CONFIG_DIR: installedChannel(root, "4.60.0") },
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain(
      "cross-channel vintage SKEW — installed Lisa package is lisa 4.72.7"
    );
    expect(result.output).toContain(
      "installed for this project is lisa 4.60.0"
    );
    expect(result.output).toContain("When both fire");
    expect(result.output).toContain("update the installed plugin");
    expect(result.output).not.toContain("npx @codyswann/lisa apply");
  });

  it("never invents exact host vintage when installed channel versions agree but host bytes differ", () => {
    const root = currentHost();
    writeFileSync(
      template(root),
      `${readFileSync(template(root), "utf8")}\n# template difference\n`
    );
    const result = driveFreshness(root, undefined, {
      env: { CLAUDE_CONFIG_DIR: installedChannel(root, INSTALLED_VERSION) },
    });
    expect(result.status).toBe(2);
    expect(result.output).not.toContain("cross-channel vintage SKEW");
    expect(result.output).toMatch(
      /Refused by .*\(DIFFERENT from installed template; installed lisa/u
    );
    expect(result.output).not.toMatch(/Refused by .*\(lisa 4\.72\.7/u);
  });

  it("reports unknown plugin evidence without treating it as channel agreement", () => {
    const root = currentHost();
    const result = driveFreshness(root);
    expect(result.status).toBe(2);
    expect(result.output).toContain("cross-channel vintage UNDETERMINED");
    expect(result.output).toContain("Not agreement");
  });

  it("reports both references in a mixed host/plugin selected roster", () => {
    const root = currentHost();
    const plugin = path.join(root, "plugins/lisa/hooks");
    mkdirSync(plugin, { recursive: true });
    rmSync(path.join(root, "scripts/lisa-hooks/parity-safety-net.sh"));
    copyFileSync(
      path.join(PLUGIN_HOOKS, "parity-safety-net.sh"),
      path.join(plugin, "parity-safety-net.sh")
    );
    datePluginTree(root, "4.61.0");
    const result = driveFreshness(root, undefined, {
      env: { CLAUDE_CONFIG_DIR: installedChannel(root, "4.60.0") },
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain("installed Lisa package is lisa 4.72.7");
    expect(result.output).toContain(
      "this checkout's plugin manifest is lisa 4.61.0"
    );
    expect(result.output).toMatch(
      /Refused by .*scripts\/lisa-hooks\/block-no-verify\.sh \(matches installed template/u
    );
  });
});
