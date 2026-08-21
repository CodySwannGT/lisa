/**
 * `GET /api/gate-report` — the Doctor tab's data, composed at serve time.
 *
 * The tab's markup is composed HERE rather than living inside
 * `ui/index.html`, and that is the point of the route. That file is a single
 * 13,000-line zero-build document with a known concurrent-edit hazard where
 * union merges lose braces; a section of this size pasted into it would make a
 * bad merge materially worse, and would put a second copy of the report's
 * markup somewhere no test renders. The console instead gains a small block
 * that asks this route for the fragment.
 *
 * The standalone property `ui/README.md` advertises survives untouched:
 * opening `ui/index.html` from disk still works, and the tab then says — in
 * the report's own three-state vocabulary — that the report could not be
 * derived without a server. That is an honest `unknown`, not an empty panel.
 *
 * Lazy and single-flight, following `/api/setup-readiness`. Tier 2 shells out
 * to `gh`, so building the report at server start would delay the console for
 * a section the operator may never open, and two tabs opened at once must not
 * become two `gh` invocations.
 * @module cli/ui-gate-report
 */
import type * as http from "node:http";
import * as path from "node:path";

import { renderGateReportFragment } from "./gate-report-fragment.js";
import { buildGateReport } from "./gate-report.js";
import type { GateReport } from "./gate-report-types.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** What the route returns. */
export interface GateReportResponse {
  /** The scoped fragment the console injects into the Doctor tab. */
  readonly html: string;
  /**
   * The payload the fragment was rendered from.
   *
   * Served alongside the markup so an agent or a script can consume the same
   * verdicts the operator is looking at, without a second derivation that
   * could disagree with the first.
   */
  readonly report: GateReport;
}

/** Injectable boundaries, so tests never shell out or read a real project. */
export interface GateReportDependencies {
  /** Build the report. Defaults to the real emitter. */
  readonly build?: (projectRoot: string) => Promise<GateReport>;
}

/**
 * Build the response for one project.
 * @param projectRoot - Project root served by this UI process
 * @param dependencies - Injectable boundaries
 * @returns The fragment and the payload it came from
 */
export async function readGateReport(
  projectRoot: string,
  dependencies: GateReportDependencies = {}
): Promise<GateReportResponse> {
  const build =
    dependencies.build ??
    (async (root: string) => await buildGateReport({ projectRoot: root }));
  const report = await build(projectRoot);
  return {
    report,
    html: renderGateReportFragment(report, path.basename(projectRoot)),
  };
}

/**
 * Coalesce concurrent reads without caching a stale answer for later ones.
 *
 * The slot is a `current` holder rather than a reassigned binding, which is
 * the shape the repository's immutability rules already sanction: the entry is
 * set when a read starts and cleared when it settles, which is the same
 * lifetime with none of the suppression.
 * @param read - The underlying reader
 * @returns A single-flight reader that clears after settlement
 */
function singleFlight(
  read: () => Promise<GateReportResponse>
): () => Promise<GateReportResponse> {
  const slot: { current: Promise<GateReportResponse> | undefined } = {
    current: undefined,
  };
  return () => {
    if (slot.current !== undefined) return slot.current;
    const pending = read();
    slot.current = pending;
    const clear = (): void => {
      if (slot.current === pending) slot.current = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  };
}

/**
 * Create the `/api/gate-report` handler for one project.
 * @param projectRoot - Project root served by this UI process
 * @param dependencies - Injectable boundaries
 * @returns A request handler
 */
export function createGateReportHandler(
  projectRoot: string,
  dependencies: GateReportDependencies = {}
): (request: http.IncomingMessage, response: http.ServerResponse) => void {
  const read = singleFlight(
    async () => await readGateReport(projectRoot, dependencies)
  );
  return (request, response) => {
    if (request.method === "HEAD") {
      response.writeHead(200, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, {
        allow: "GET, HEAD",
        "cache-control": NO_STORE,
        "content-type": TEXT_CONTENT_TYPE,
      });
      response.end("Method not allowed");
      return;
    }
    void read().then(
      result => {
        response.writeHead(200, {
          "cache-control": NO_STORE,
          "content-type": JSON_CONTENT_TYPE,
        });
        response.end(JSON.stringify(result));
      },
      error => {
        // A failure here must not render as an empty report. The console shows
        // the message, which keeps "the report could not be derived" distinct
        // from "the report found nothing".
        response.writeHead(500, {
          "cache-control": NO_STORE,
          "content-type": JSON_CONTENT_TYPE,
        });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    );
  };
}
