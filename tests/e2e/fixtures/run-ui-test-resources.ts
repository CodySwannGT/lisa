/**
 * @file run-ui-test-resources.ts
 * @description Deterministic browser and HTTP teardown for Playwright-owned `runUi` origins
 * @module tests/e2e/fixtures
 */
import type { Server } from "node:http";

import type { BrowserContext, Page } from "@playwright/test";

const SERVER_CLOSE_GRACE_MS = 250;
const SERVER_CLOSE_DEADLINE_MS = 2_000;

/** Resources whose network ownership must end before a `runUi` test returns. */
export interface RunUiTestResources {
  /** Optional isolated context created by the test rather than Playwright. */
  readonly context?: BrowserContext;
  /** Page connected to the private `runUi` origin. */
  readonly page: Page;
  /** Private listener created on an operating-system-assigned port. */
  readonly server: Server;
}

/** Evidence that teardown drained the browser-owned origin rather than timing out. */
export interface RunUiTeardownReport {
  /** Connections observed while the browser page was still open. */
  readonly connectionsBeforePageClose: number;
  /** Connections remaining after the listener reported closed. */
  readonly connectionsAfterServerClose: number;
  /** Whether the bounded active-connection fail-safe had to fire. */
  readonly forcedServerClose: boolean;
}

/** Fulfilled or rejected result used to retain every cleanup error. */
type Observed<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly reason: unknown; readonly status: "rejected" };

/**
 * Capture an asynchronous outcome without short-circuiting later cleanup.
 * @param action - One teardown stage whose error must remain visible
 * @returns The value or original rejection reason without rewriting its stack
 */
async function observe<T>(action: () => Promise<T>): Promise<Observed<T>> {
  try {
    return { status: "fulfilled", value: await action() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/**
 * Count sockets owned by the listener so regression tests can prove the drain.
 * @param server - Private `runUi` listener under test
 * @returns Current accepted connection count reported by Node
 */
async function serverConnections(server: Server): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.getConnections((error, count) => {
      if (error) reject(error);
      else resolve(count);
    });
  });
}

/**
 * Stop accepting connections, then force active sockets only after a short grace.
 * @param server - Listener whose browser clients have already been closed
 * @returns Whether an active-connection fail-safe was needed
 * @remarks `server.close()` begins first, as Node requires, so the forced drain
 * cannot race a newly accepted connection. The hard deadline prevents cleanup
 * from consuming Playwright's whole timeout or leaking the listener afterward.
 */
async function closeRunUiServer(
  server: Server
): Promise<{ readonly forced: boolean }> {
  if (!server.listening) return { forced: false };
  return await new Promise((resolve, reject) => {
    // eslint-disable-next-line functional/no-let -- timer callbacks share shutdown state
    let forced = false;
    // eslint-disable-next-line functional/no-let -- guards callback/deadline double settlement
    let settled = false;
    const finish = (
      error: Error | undefined,
      graceTimer: NodeJS.Timeout,
      deadlineTimer: NodeJS.Timeout
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      clearTimeout(deadlineTimer);
      if (error) reject(error);
      else resolve({ forced });
    };
    const graceTimer = setTimeout(() => {
      forced = true;
      server.closeAllConnections();
    }, SERVER_CLOSE_GRACE_MS);
    const deadlineTimer = setTimeout(() => {
      server.closeAllConnections();
      finish(
        new Error(
          `runUi server did not close within ${SERVER_CLOSE_DEADLINE_MS}ms`
        ),
        graceTimer,
        deadlineTimer
      );
    }, SERVER_CLOSE_DEADLINE_MS);
    server.close(error => finish(error, graceTimer, deadlineTimer));
  });
}

/**
 * Close browser ownership before its origin, retaining every cleanup error.
 * @param resources - Page, optional owned context, and private listener
 * @returns Socket evidence captured on both sides of teardown
 * @remarks Playwright-owned fixture contexts are intentionally omitted by
 * callers; only contexts a test created itself belong in this cleanup chain.
 */
export async function closeRunUiTestResources(
  resources: RunUiTestResources
): Promise<RunUiTeardownReport> {
  const connectionsBeforePageClose = await serverConnections(resources.server);
  const pageClose = await observe(async () => {
    if (!resources.page.isClosed()) await resources.page.close();
  });
  const contextClose = await observe(async () => resources.context?.close());
  const serverClose = await observe(async () =>
    closeRunUiServer(resources.server)
  );
  const connectionsAfterServerClose = await observe(async () =>
    serverConnections(resources.server)
  );
  const failures = [
    pageClose,
    contextClose,
    serverClose,
    connectionsAfterServerClose,
  ].filter(
    (outcome): outcome is Extract<Observed<unknown>, { status: "rejected" }> =>
      outcome.status === "rejected"
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(outcome => outcome.reason),
      "Private runUi teardown failed"
    );
  }
  return {
    connectionsBeforePageClose,
    connectionsAfterServerClose: connectionsAfterServerClose.value,
    forcedServerClose: serverClose.value.forced,
  };
}
