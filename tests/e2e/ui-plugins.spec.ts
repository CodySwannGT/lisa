import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  createEnabledPluginsProbe,
  runUi,
  type ProbeResult,
  type StatusProbe,
  type EnabledPluginsValue,
} from "../../src/cli/ui-cmd.ts";

/**
 * A running console rooted at an isolated origin, plus its teardown.
 */
interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/**
 * Launch `lisa ui` on an OS-assigned port with sync disabled.
 * @param destDir - Project root the console serves
 * @param probes - Injected status probes; omitted to exercise real defaults
 * @returns The console's loopback origin and a close handle
 */
async function launchConsole(
  destDir: string,
  probes?: readonly StatusProbe[]
): Promise<LiveConsole> {
  const server = await runUi(
    destDir,
    { port: "0", sync: false },
    probes ? { probes } : {}
  );
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/**
 * Build the `enabled-plugins` probe returning a fixed result.
 * @param result - Tri-state result the probe reports
 * @returns A probe registered under the `enabled-plugins` id
 */
function enabledPluginsProbe(
  result: ProbeResult<EnabledPluginsValue>
): StatusProbe<EnabledPluginsValue> {
  return { id: "enabled-plugins", timeoutMs: 1_000, run: async () => result };
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-plugins-"));
  createdDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const demoPluginIds = [
  "lisa-nestjs@lisa",
  "code-review@claude-plugins-official",
  "impeccable@impeccable",
];

test("lists exactly the enabled plugins and marks available-not-enabled", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    enabledPluginsProbe({
      state: "value",
      value: {
        settingsPresent: true,
        plugins: [
          {
            id: "lisa@lisa",
            status: "enabled",
            description: "Base governance",
          },
          {
            id: "lisa-nestjs@lisa",
            status: "available",
            description: "NestJS skills",
          },
          {
            id: "playwright@claude-plugins-official",
            status: "enabled",
            description: "Browser automation",
          },
        ],
      },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    await expect(page.locator("#section-plugins h1")).toHaveText(
      "Plugins & MCP"
    );

    const live = page.locator("#section-plugins .plugins-live-block");
    await expect(live.locator(".plugins-state")).toHaveCount(0);

    await expect(live.getByText("lisa@lisa", { exact: true })).toBeVisible();
    await expect(
      live.getByText("lisa-nestjs@lisa", { exact: true })
    ).toBeVisible();
    await expect(
      live.getByText("playwright@claude-plugins-official", { exact: true })
    ).toBeVisible();

    const lisaRow = live.locator("tr", { hasText: "lisa@lisa" });
    await expect(lisaRow.getByText("enabled", { exact: true })).toBeVisible();
    await expect(lisaRow.locator(".badge.on")).toHaveCount(1);

    const nestRow = live.locator("tr", { hasText: "lisa-nestjs@lisa" });
    await expect(
      nestRow.getByText("available, not enabled", { exact: true })
    ).toBeVisible();
    await expect(nestRow.locator(".badge.on")).toHaveCount(0);

    // Demo-only curated ids that were not in the probe must not appear.
    await expect(
      live.getByText("impeccable@impeccable", { exact: true })
    ).toHaveCount(0);
    await expect(
      live.getByText("code-review@claude-plugins-official", { exact: true })
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders the empty state when settings.json is absent", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    enabledPluginsProbe({
      state: "value",
      value: { settingsPresent: false, plugins: [] },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    await expect(
      page.locator("#section-plugins .plugins-state.empty")
    ).toHaveText(/No \.claude\/settings\.json in this project/);
    for (const id of demoPluginIds) {
      await expect(
        page.locator("#section-plugins .plugins-live-block").getByText(id, {
          exact: true,
        })
      ).toHaveCount(0);
    }
    await expect(
      page.locator("#section-plugins .plugins-live-block tr")
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders unknown when the probe is missing", async ({ page }) => {
  const ui = await launchConsole(await makeProjectDir(), [
    {
      id: "github-authenticated",
      timeoutMs: 1_000,
      run: async () => ({ state: "value", value: true }),
    },
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    const unknown = page.locator("#section-plugins .plugins-state.unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText("Plugin enablement unavailable");
    await expect(unknown.locator(".status-why")).toHaveText(
      "missing-probe: The enabled-plugins probe was not reported"
    );
    await expect(
      page
        .locator("#section-plugins .plugins-live-block")
        .getByText("lisa@lisa", {
          exact: true,
        })
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders unknown for an unparseable-settings probe result", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    enabledPluginsProbe({
      state: "unknown",
      reason: "unparseable-settings",
      message: "Unexpected token in JSON",
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    const unknown = page.locator("#section-plugins .plugins-state.unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown.locator(".status-why")).toHaveText(
      "unparseable-settings: Unexpected token in JSON"
    );
    await expect(
      page.locator("#section-plugins .plugins-state.empty")
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders a hostile plugin id as inert text without executing it", async ({
  page,
}) => {
  const hostileId = "<img src=x onerror=window.__xss=1>@lisa";
  const ui = await launchConsole(await makeProjectDir(), [
    enabledPluginsProbe({
      state: "value",
      value: {
        settingsPresent: true,
        plugins: [{ id: hostileId, status: "enabled", description: "hostile" }],
      },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    const live = page.locator("#section-plugins .plugins-live-block");
    await expect(live.getByText(hostileId, { exact: true })).toBeVisible();
    await expect(live.locator("img")).toHaveCount(0);
    const xss = await page.evaluate(() => (window as { __xss?: number }).__xss);
    expect(xss).toBeUndefined();
  } finally {
    await ui.close();
  }
});

test("hydrates from the real probe against a settings.json fixture", async ({
  page,
}) => {
  const projectDir = await makeProjectDir();
  const isolatedHome = await makeProjectDir();
  await mkdir(path.join(projectDir, ".claude"), { recursive: true });
  await writeFile(
    path.join(projectDir, ".claude", "settings.json"),
    `${JSON.stringify(
      {
        enabledPlugins: {
          "lisa@lisa": true,
          "unique-e2e-plugin@lisa": true,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(path.join(projectDir, ".claude-plugin"), { recursive: true });
  await writeFile(
    path.join(projectDir, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        name: "lisa",
        plugins: [
          { name: "lisa", description: "Base" },
          { name: "unique-e2e-plugin", description: "Fixture only" },
          { name: "available-only", description: "Not enabled" },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  // Use the real probe implementation with an empty HOME so the developer's
  // machine marketplaces cannot leak demo-adjacent ids into the assertion.
  const ui = await launchConsole(projectDir, [
    createEnabledPluginsProbe(projectDir, { homedir: () => isolatedHome }),
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    const live = page.locator("#section-plugins .plugins-live-block");
    await expect(
      live.getByText("unique-e2e-plugin@lisa", { exact: true })
    ).toBeVisible();
    await expect(
      live.getByText("available-only@lisa", { exact: true })
    ).toBeVisible();
    const availableRow = live.locator("tr", { hasText: "available-only@lisa" });
    await expect(
      availableRow.getByText("available, not enabled", { exact: true })
    ).toBeVisible();
    await expect(
      live.getByText("impeccable@impeccable", { exact: true })
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("never flashes demo plugin ids before hydration completes", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    {
      id: "enabled-plugins",
      timeoutMs: 1_000,
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        return {
          state: "value",
          value: {
            settingsPresent: true,
            plugins: [
              {
                id: "lisa@lisa",
                status: "enabled",
                description: "Base",
              },
            ],
          },
        } satisfies ProbeResult<EnabledPluginsValue>;
      },
    },
  ]);
  try {
    await page.goto(`${ui.base}/#plugins`);
    // Immediately after navigation, demo curated ids must not be present.
    await expect(
      page
        .locator("#section-plugins .plugins-live-block")
        .getByText("impeccable@impeccable", { exact: true })
    ).toHaveCount(0);
    await expect(
      page
        .locator("#section-plugins .plugins-live-block")
        .getByText("lisa@lisa", {
          exact: true,
        })
    ).toBeVisible({ timeout: 5_000 });
  } finally {
    await ui.close();
  }
});
