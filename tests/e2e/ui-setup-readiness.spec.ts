import { expect, test, type Page } from "@playwright/test";

const CHECKS = [
  "setup.install",
  "setup.sync",
  "setup.agent-ready",
  "setup.standards",
  "setup.tracker",
  "setup.prd-source",
  "setup.github-governance",
  "setup.secrets",
  "setup.automations",
  "setup.exploration",
  "setup.wiki",
  "setup.starter-provenance",
] as const;

type Status = "pass" | "warn" | "fail";
interface Finding {
  check: string;
  layer: string;
  status: string;
  reason: string;
}
interface Readiness {
  schemaVersion: number;
  observedAt: string;
  findings: Finding[];
}

/** Build one exact current Setup readiness response. */
function readiness(
  overrides: Readonly<Record<string, Status>> = {}
): Readiness {
  return {
    schemaVersion: 1,
    observedAt: "2026-07-21T19:00:00.000Z",
    findings: CHECKS.map(check => ({
      check,
      layer: "deterministic",
      status: overrides[check] ?? "warn",
      reason: `${check} is ${overrides[check] ?? "warn"}.`,
    })),
  };
}

/** Route one browser page to a controlled Setup response. */
async function routeReadiness(page: Page, body: object): Promise<void> {
  await page.route("**/api/setup-readiness", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** Assert that an unusable response cannot leave any checklist row green. */
async function expectFailedClosed(page: Page): Promise<void> {
  const rows = page.locator("#section-setup [data-setup-check]");
  await expect(rows).toHaveCount(12);
  await expect(page.locator("#section-setup .check-item.done")).toHaveCount(0);
  const reasons = await rows.locator(".status-why").allTextContents();
  expect(new Set(reasons)).toEqual(
    new Set([
      "Setup readiness is unavailable. Re-open the console after checking the local Lisa service.",
    ])
  );
}

test("renders exact named findings and survives a later live-status render", async ({
  page,
}) => {
  let releaseStatus: () => void = () => undefined;
  const statusGate = new Promise<void>(resolve => {
    releaseStatus = resolve;
  });
  await page.route("**/api/status", async route => {
    await statusGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await routeReadiness(
    page,
    readiness({
      "setup.install": "pass",
      "setup.sync": "pass",
      "setup.tracker": "fail",
    })
  );

  await page.goto("/#setup");
  const rows = page.locator("#section-setup [data-setup-check]");
  await expect(rows).toHaveCount(12);
  expect(
    await rows.evaluateAll(nodes =>
      nodes.map(node => (node as HTMLElement).dataset.setupCheck)
    )
  ).toEqual(CHECKS);
  await expect(page.locator('[data-setup-check="setup.install"]')).toHaveClass(
    /done/u
  );
  await expect(page.locator('[data-setup-check="setup.sync"]')).toHaveClass(
    /done/u
  );
  const tracker = page.locator('[data-setup-check="setup.tracker"]');
  await expect(tracker).not.toHaveClass(/done/u);
  await expect(tracker.locator(".badge")).toHaveText("pending");
  await expect(tracker.locator(".status-why")).toHaveText(
    "setup.tracker is fail."
  );
  await expect(
    page.locator('[data-setup-checklist="Required"] .note')
  ).toHaveText("2 of 10 complete");
  await expect(
    page.locator('[data-setup-checklist="Optional"] .note')
  ).toHaveText("0 of 2 complete");

  releaseStatus();
  await expect(page.locator('[data-setup-check="setup.install"]')).toHaveClass(
    /done/u
  );
  await expect(tracker.locator(".status-why")).toHaveText(
    "setup.tracker is fail."
  );
});

test("applies setup truth after status-driven whole-page renders finish first", async ({
  page,
}) => {
  let releaseSetup: () => void = () => undefined;
  const setupGate = new Promise<void>(resolve => {
    releaseSetup = resolve;
  });
  await page.route("**/api/setup-readiness", async route => {
    await setupGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({ "setup.install": "pass" })),
    });
  });

  await page.goto("/#setup");
  await expect(
    page.locator('[data-setup-check="setup.install"] .status-why')
  ).toHaveText("Checking current setup readiness.");
  releaseSetup();
  await expect(page.locator('[data-setup-check="setup.install"]')).toHaveClass(
    /done/u
  );
});

const malformedCases: ReadonlyArray<{
  name: string;
  body: () => Readiness;
}> = [
  {
    name: "missing finding",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings.pop();
      return value;
    },
  },
  {
    name: "extra finding",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings.push({ ...value.findings[0]!, check: "setup.extra" });
      return value;
    },
  },
  {
    name: "reordered findings",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      [value.findings[0], value.findings[1]] = [
        value.findings[1]!,
        value.findings[0]!,
      ];
      return value;
    },
  },
  {
    name: "duplicate finding",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings[1] = { ...value.findings[0]! };
      return value;
    },
  },
  {
    name: "invalid timestamp",
    body: () => ({ ...readiness(), observedAt: "not-a-timestamp" }),
  },
  {
    name: "invalid layer",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings[0]!.layer = "agentic";
      return value;
    },
  },
  {
    name: "invalid status",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings[0]!.status = "unknown";
      return value;
    },
  },
  {
    name: "unsafe reason",
    body: () => {
      const value = readiness({ "setup.install": "pass" });
      value.findings[0]!.reason = " padded ";
      return value;
    },
  },
];

for (const scenario of malformedCases) {
  test(`${scenario.name} fails every Setup row closed`, async ({ page }) => {
    await routeReadiness(page, scenario.body());
    await page.goto("/#setup");
    await expectFailedClosed(page);
  });
}

test("invalid JSON fails every Setup row closed", async ({ page }) => {
  await page.route("**/api/setup-readiness", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{",
    });
  });
  await page.goto("/#setup");
  await expectFailedClosed(page);
});

test("transport failure fails every Setup row closed", async ({ page }) => {
  await page.route("**/api/setup-readiness", async route => {
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await page.goto("/#setup");
  await expectFailedClosed(page);
});

test("reopening Setup refreshes and reverses one row without stale green", async ({
  page,
}) => {
  let trackerStatus: Status = "fail";
  let requestCount = 0;
  let releaseThird: () => void = () => undefined;
  const thirdGate = new Promise<void>(resolve => {
    releaseThird = resolve;
  });
  await page.route("**/api/setup-readiness", async route => {
    requestCount += 1;
    if (requestCount === 3) await thirdGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({ "setup.tracker": trackerStatus })),
    });
  });
  const tracker = page.locator('[data-setup-check="setup.tracker"]');

  await page.goto("/#setup");
  await expect(tracker).not.toHaveClass(/done/u);
  expect(requestCount).toBe(1);

  await page.locator('[data-section="overview"]').click();
  trackerStatus = "pass";
  await page.locator('[data-section="setup"]').click();
  await expect(tracker).toHaveClass(/done/u);
  expect(requestCount).toBe(2);

  await page.locator('[data-section="overview"]').click();
  trackerStatus = "fail";
  await page.locator('[data-section="setup"]').click();
  await expect(tracker).not.toHaveClass(/done/u);
  await expect(tracker.locator(".status-why")).toHaveText(
    "Checking current setup readiness."
  );
  releaseThird();
  await expect(tracker.locator(".status-why")).toHaveText(
    "setup.tracker is fail."
  );
  expect(requestCount).toBe(3);
});
