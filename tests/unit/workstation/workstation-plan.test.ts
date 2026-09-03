/**
 * Tests for the workstation bootstrap.
 *
 * Every probe is injected, so nothing here touches the machine running the
 * suite: a test that asked the real PATH would pass or fail depending on whose
 * laptop it ran on, which is precisely the bug class this skill exists to
 * remove.
 * @module tests/unit/workstation/workstation-plan
 */

import { describe, expect, it } from "vitest";

import {
  AGENTS,
  CHECKSUMMED,
  INSTALLABLE,
  PROVIDERS,
  TOOLS,
  pathDirs,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/catalogue.mjs";
import {
  locate,
  planEntry,
  planProvider,
  planWorkstation,
  provenance,
  renderPlan,
  resolveProvider,
  version,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation.mjs";
import { resolvePlatform } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

import {
  BIN_DIR,
  HOME,
  SYSTEM_GIT,
  VENDOR_SCRIPT,
  probes,
} from "./fixtures.js";

describe("catalogue integrity", () => {
  const checksummed = [...AGENTS, ...PROVIDERS, ...TOOLS].filter(e =>
    CHECKSUMMED.has(e.kind as string)
  );

  it("has at least one checksummed entry, or this suite proves nothing", () => {
    expect(checksummed.length).toBeGreaterThan(0);
  });

  it.each(checksummed.map(e => [e.name, e] as const))(
    "%s pins a url AND a sha256 for every platform it claims",
    (_name, entry) => {
      // The pinned installer refuses an entry missing either, so a half-filled
      // platform block is a container build that fails two minutes in. gh
      // shipped with `url` and `binary` but no `sha256` and did exactly that;
      // this catches it in milliseconds instead.
      const platforms = (entry as { platforms?: Record<string, unknown> })
        .platforms;
      expect(platforms).toBeDefined();
      for (const [key, block] of Object.entries(platforms ?? {})) {
        const artifact = block as { url?: string; sha256?: string };
        expect(artifact.url, `${entry.name}/${key} url`).toMatch(/^https:\/\//);
        expect(artifact.sha256, `${entry.name}/${key} sha256`).toMatch(
          /^[0-9a-f]{64}$/
        );
      }
    }
  );

  it.each([
    ["bws", "darwin-arm64"],
    ["bws", "darwin-x64"],
    ["bws", "linux-x64"],
    ["bws", "linux-arm64"],
    ["gh", "darwin-arm64"],
    ["gh", "darwin-x64"],
    ["gh", "linux-x64"],
    ["gh", "linux-arm64"],
  ])(
    "resolves a pinned %s artifact on %s instead of refusing the platform",
    (name, platform) => {
      // `bws` was pinned for Linux only, so a macOS workstation selecting the
      // bitwarden provider got `no pin for darwin-arm64` from the shared
      // resolver — the one credential CLI Lisa can verify was the one macOS had
      // to install by hand. `gh` had the mirror-image gap on Intel macs.
      const entry = [...PROVIDERS, ...TOOLS].find(
        e => (e.binary ?? e.name) === name
      );
      const resolved = resolvePlatform(entry, platform);
      expect(resolved.url, `${name}/${platform} url`).toMatch(/^https:\/\//);
      expect(resolved.sha256, `${name}/${platform} sha256`).toMatch(
        /^[0-9a-f]{64}$/
      );
    }
  );

  it("leaves the linux bws pins exactly as they were", () => {
    // Adding platforms must not perturb the digests already in service; these
    // are the committed values, written out rather than read back from the
    // catalogue so the assertion can actually fail.
    const bws = PROVIDERS.find(p => p.name === "bitwarden");
    expect(bws.platforms["linux-x64"].sha256).toBe(
      "ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860"
    );
    expect(bws.platforms["linux-arm64"].sha256).toBe(
      "18253757286e119d450133a87eb463bf8c1ce418ce24c834f4f250d60cba6f9e"
    );
  });

  it("names the archive-internal binary path for every gh platform", () => {
    // gh ships each artifact with the version and platform baked into the
    // directory name, so a copied block that keeps the wrong path unpacks fine
    // and then fails to find the binary.
    const gh = TOOLS.find(t => t.name === "gh");
    for (const [key, block] of Object.entries(gh.platforms)) {
      expect(block.binary, `gh/${key} binary`).toMatch(/\/bin\/gh$/);
    }
  });

  it("gives every entry a kind the installer knows how to act on", () => {
    const known = new Set([...INSTALLABLE, "required", "manual", "none"]);
    for (const entry of [...AGENTS, ...PROVIDERS, ...TOOLS]) {
      expect(known, `${entry.name} has kind "${entry.kind}"`).toContain(
        entry.kind
      );
    }
  });

  it("gives every vendor-script entry either a script or a note", () => {
    // Without one it silently becomes a no-op install that reports success.
    for (const entry of [...AGENTS, ...PROVIDERS, ...TOOLS]) {
      if (entry.kind !== VENDOR_SCRIPT) continue;
      const e = entry as { script?: string; note?: string };
      expect(
        Boolean(e.script || e.note),
        `${entry.name} has neither script nor note`
      ).toBe(true);
    }
  });

  it("marks every agent installable, since each vendor ships a bootstrapper", () => {
    // Antigravity was carried as `manual` on the claim that it published no
    // headless installer. It does — https://antigravity.google/cli/install.sh
    // returns application/x-sh — so the entry made a real agent look
    // unprovisionable. A wrong "cannot" is worse than a missing entry: it stops
    // anyone from looking again.
    for (const agent of AGENTS) {
      expect(INSTALLABLE, `${agent.name} is ${agent.kind}`).toContain(
        agent.kind
      );
    }
  });

  it("puts the pinned bin directory first on PATH", () => {
    // A pinned, checksummed binary must win over whatever an image ships under
    // the same name.
    expect(pathDirs(HOME)[0]).toBe(BIN_DIR);
  });

  it("declares a bin directory for vendors that install outside it", () => {
    // opencode and sonar install into their own directory and only append a
    // PATH line to a shell rc, which no non-interactive run ever sources.
    expect(pathDirs(HOME)).toContain(`${HOME}/.opencode/bin`);
    expect(pathDirs(HOME)).toContain(`${HOME}/.local/share/sonarqube-cli/bin`);
  });
});

describe("locate", () => {
  it("returns the path when the command resolves", async () => {
    expect(locate("git", () => `${SYSTEM_GIT}\n`)).toBe(SYSTEM_GIT);
  });

  it("returns null when the command is absent", async () => {
    expect(
      locate("nope", () => {
        throw new Error("not found");
      })
    ).toBeNull();
  });
});

describe("version", () => {
  it("extracts a dotted version", async () => {
    expect(version("gh", () => "gh version 2.83.0 (2026-01-01)")).toBe(
      "2.83.0"
    );
  });

  it("treats a non-zero exit as present, not absent", async () => {
    // Info-ZIP exits 10 on --version but still prints its banner. Reporting
    // that as absent is the false negative that shipped once already.
    const failing = () => {
      const error = new Error("exit 10");
      error.status = 10;
      error.stdout = "UnZip 6.00 of 20 April 2009";
      throw error;
    };
    expect(version("unzip", failing)).toBe("6.00");
  });

  it("returns null only when the binary cannot be spawned", async () => {
    const missing = () => {
      const error = new Error("spawn failed");
      error.code = "ENOENT";
      throw error;
    };
    expect(version("nope", missing)).toBeNull();
  });
});

describe("provenance", () => {
  it.each([
    ["/opt/homebrew/bin/gh", "homebrew"],
    ["/Users/x/.local/bin/claude", "~/.local/bin"],
    ["/repo/node_modules/.bin/playwright", "node_modules"],
    [SYSTEM_GIT, "system"],
    [null, "absent"],
  ])("labels %s as %s", (path, expected) => {
    expect(provenance(path)).toBe(expected);
  });
});

describe("planEntry", () => {
  it("leaves an installed tool alone regardless of how it got there", async () => {
    const row = planEntry(
      { name: "gh", label: "GitHub CLI", kind: "release-tar" },
      probes({ gh: "/opt/homebrew/bin/gh" })
    );
    expect(row.action).toBe("present");
    expect(row.from).toBe("homebrew");
  });

  it("blocks on a required tool that is absent", async () => {
    const row = planEntry(
      { name: "git", label: "git", kind: "required", note: "from the OS" },
      probes()
    );
    expect(row.action).toBe("blocked");
  });

  it("reports a manual-only tool as manual, not installable", async () => {
    const row = planEntry(
      {
        name: "vendor-only-tool",
        label: "A tool with no headless installer",
        kind: "manual",
        note: "no installer",
      },
      probes()
    );
    expect(row.action).toBe("manual");
    expect(row.reason).toBe("no installer");
  });

  it("marks a vendor-script install as not checksummed", async () => {
    const row = planEntry(
      { name: "claude", label: "Claude Code", kind: "vendor-script" },
      probes()
    );
    expect(row.action).toBe("install");
    expect(row.checksummed).toBe(false);
  });
});

describe("resolveProvider", () => {
  it("returns null when nothing was requested", async () => {
    expect(resolveProvider(null)).toBeNull();
  });

  it("resolves a known provider", async () => {
    expect(resolveProvider("bitwarden").binary).toBe("bws");
  });

  it("throws on an unknown name rather than falling back", async () => {
    expect(() => resolveProvider("lastpass")).toThrow(
      /unknown credential manager/
    );
  });
});

describe("planProvider", () => {
  it("treats none as a supported answer, not an absence", async () => {
    const row = planProvider(PROVIDERS.find(p => p.name === "none"));
    expect(row.action).toBe("present");
    expect(row.path).toBeNull();
  });

  it("plans the selected provider by its binary name", async () => {
    const row = planProvider(
      PROVIDERS.find(p => p.name === "bitwarden"),
      probes()
    );
    expect(row.name).toBe("bws");
    expect(row.action).toBe("install");
  });
});

describe("planWorkstation", () => {
  it("plans only the selected credential manager", async () => {
    const plan = planWorkstation({ provider: "doppler", ...probes() });
    const credentials = plan.filter(r => r.group === "provider");
    expect(credentials).toHaveLength(1);
    expect(credentials[0].name).toBe("doppler");
  });

  it("omits the credential group entirely when none is requested", async () => {
    const plan = planWorkstation(probes());
    expect(plan.filter(r => r.group === "provider")).toHaveLength(0);
  });

  it("restricts agents to the requested subset", async () => {
    const plan = planWorkstation({ agents: ["claude"], ...probes() });
    const agents = plan.filter(r => r.group === "agent");
    expect(agents.map(a => a.name)).toEqual(["claude"]);
  });
});

describe("renderPlan", () => {
  it("names the installs that carry no checksum", async () => {
    const text = renderPlan(
      planWorkstation({ agents: ["claude"], ...probes() })
    );
    expect(text).toContain("Not checksummed");
    expect(text).toContain("claude");
  });

  it("shows a reason rather than a version for a pathless row", async () => {
    const text = renderPlan([
      {
        ...planProvider(PROVIDERS.find(p => p.name === "none")),
        group: "provider",
      },
    ]);
    expect(text).toContain("no credential manager selected");
    expect(text).not.toContain("?  (");
  });
});
