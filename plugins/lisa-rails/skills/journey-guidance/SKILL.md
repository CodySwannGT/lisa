---
name: journey-guidance
description: "Rails stack guidance for Validation Journeys on any tracker (Jira, GitHub, Linear): choosing the verification method for UI, API, and background-job changes, reusing partials and ViewComponents, and naming text and image evidence. Consulted by the tracker journey, add-journey, create, and evidence dispatchers."
---

# Rails Validation Journey Guidance

Stack-specific guidance for Validation Journeys in a Rails project. It applies the same way whichever tracker the project uses (`tracker` in `.lisa.config.json`: `jira`, `github`, or `linear`).

This skill adds the Rails parts only. The vendor skills still read the ticket, append the journey, and post the evidence; the tracker dispatchers (`lisa-tracker-journey`, `lisa-tracker-add-journey`, `lisa-tracker-create`, `lisa-tracker-evidence`) consult this skill before they dispatch. The Jira-only overlays in this plugin (`jira-journey`, `jira-add-journey`, `jira-create`, `jira-evidence`) carry the same guidance plus Jira mechanics; this skill is what a GitHub or Linear project reaches.

## Writing the journey

Compose Prerequisites, Steps with typed evidence markers (`[EVIDENCE: <artifact-type>: <name>]` per the `verification` rule), and Assertions. Pick the marker type from what the change touches:

| Change touches | Verify with | Marker type |
|----------------|-------------|-------------|
| Views, partials, ViewComponents, Hotwire | Playwright MCP browser tools at each viewport | `screenshot` |
| Controllers / JSON API | `curl` (or a request spec) against the running app | `http-transcript` |
| Background jobs (Solid Queue) | `ops-verify-jobs` — worker health, queue depth, failed and retried jobs | `state-dump` or `cli-output` |
| Tracing, metrics, logs | `ops-verify-telemetry`, `ops-check-logs` | `log-snippet` |
| Model / library code with no runtime surface | the test suite | `test-run-log` |

Start the app with `ops-run-local` when a step needs it.

When drafting tickets for UI work, prefer reusing the closest existing partial or ViewComponent over pixel-matching a mock from scratch, and say which one in the ticket.

## Running the journey

Run each step in order and capture an artifact of the declared type at every marker. For UI steps, run the full journey once per viewport. For API and job steps, keep the raw request/response or command output — a prose summary satisfies no marker.

## Naming the evidence

- Image evidence: `NN-name-viewport.png` (for example `01-search-step-desktop.png`).
- Text evidence: `NN-name.txt` or `NN-name.json` (for example `01-health-check.json`).

The vendor evidence skill uploads them to the configured evidence release under a PR-scoped name, so same-named files on two pull requests never overwrite each other.
