> **AI disclosure:** AI agents drove and reviewed this localhost verification. The screenshots are the durable browser observations; the text files preserve the independently observed CLI and failure-boundary details.

## Verification journey

1. Built the exact source commit and ran deterministic `lisa health` against an isolated Lisa project whose managed `eslint.config.ts` was deliberately changed. The CLI reported `templates.managed` / `deterministic` / `fail` / `Managed files do not match templates: eslint.config.ts` and a `drift detected` summary. See [the observed CLI excerpt](./cli-output.json).
2. Opened the built `lisa ui` server for that same project and clicked **Run deterministic health check**. The existing table rendered the same managed-file finding fields, the latest-run stamp showed `2026-07-21T04:37:26.223Z · drift detected`, and the top chip read `drift detected`. See [the drift screenshot](./browser-drift.png).
3. Restored the managed file and clicked the browser control again. The latest-run stamp advanced to `2026-07-21T04:40:20.221Z · in band`, and the top chip switched to `in band`. See [the recovery screenshot](./browser-in-band.png).
4. Began from a stored green result, replaced the run dependency with one that throws a sensitive local path, and clicked once. The UI showed the generic alert `Unable to run Lisa health`, zero result rows, `health unavailable`, and `Run failed · no current verdict`; the sensitive path was not visible. The server recorded one attempt and no retry. See [the failure screenshot](./browser-failure.png) and [the failure transcript](./failure-transcript.txt).

## What this shows

- The localhost console invokes the deterministic persisted Health consumer and renders the target drift finding using the same stable fields as the built CLI: `check`, `layer`, `status`, `reason`, and summary.
- Findings use the existing Health results table, and the last-run stamp is current after each run.
- The top-bar health chip changes from `drift detected` to `in band` after the project is restored and rerun.
- A failed run replaces stale green output with an operator-readable error state: no result rows remain, the chip is non-green, and no sensitive thrown value appears.
- The codified public journey also passed: the focused Playwright set was 9/9, the Health endpoint unit set was 6/6, the full unit suite was 6794 passing, and integration was 137 passing. Lint, typecheck, format, build, plugin checks, and manifest checks were green. The targeted named Playwright artifact records 4/4 Health journeys in [playwright-output.log](./playwright-output.log).

## Artifact identity

- Repository: `CodySwannGT/lisa`
- Base SHA: `761c746003f7d8a8bb2941d568b9bab78a6f525f`
- Head SHA: `9112b1e6d6b8926f78805cb2f35563631f80d35d`
- Build ID: `local-build-9112b1e6d`
- Environment: local development, built CLI and localhost browser server
- Observation window: `2026-07-21T04:35:45.837Z` through `2026-07-21T04:42:40Z`

The exact SHA-256 digest and capture time for every cited artifact are recorded in `verdict.json`.

## Not established

- No production or remotely hosted deployment was exercised; the ticket explicitly scopes the console to localhost.
- The drift screenshot does not place all 12 findings in one viewport. It visually establishes the acceptance-critical `templates.managed` row and its stable fields; complete result-set parity is additionally covered by the named browser regression journey.
- No HTTP request/response transcript was captured, so this report makes no HTTP status-code or response-body claim.
- A browser-initiated full/agentic run was not exercised; the amendment deliberately requires browser runs to remain deterministic.

`not_established_reviewed` is `true` in the durable verdict.

## How to QA

1. On this commit, build Lisa and create an isolated Lisa-managed project.
2. Change a managed file such as `eslint.config.ts`, run `lisa health`, and note the stable drift finding fields.
3. Start `lisa ui`, open Health, click **Run deterministic health check**, and compare the visible finding to the CLI fields.
4. Restore the managed file, rerun from the browser, and confirm the chip and latest-run stamp move to `in band`.
5. Exercise a throwing Health dependency and confirm the generic failure state replaces all stale green findings without retrying or leaking the thrown value.

Please correct this report if any screenshot, artifact identity value, or observed behavior does not match your review.

## Lisa Usage

_This section is managed by Lisa. Rewrites update matching usage entries in place and preserve older rows._

| Flow | Source | Model | Tokens | Cost |
| --- | --- | --- | ---: | ---: |
| verify | unavailable | OpenAI/GPT-5 | null | null | <!-- lisa:usage-entry entry_id=verify-1529-019f7f0c-0a0a-73c0-8140-43f619719293 flow=verify run_id=019f7f0c-0a0a-73c0-8140-43f619719293 provider=OpenAI model=GPT-5 source=unavailable input_tokens=null cached_input_tokens=null output_tokens=null reasoning_tokens=null total_tokens=null cost=null currency=null pricing_status=unavailable pricing_source=null artifact_ref=github%3ACodySwannGT%2Flisa%231529 parent_artifact_ref=github%3ACodySwannGT%2Flisa%231505 --> <!-- lisa:usage-entry-measured-subset entry_id=verify-1529-019f7f0c-0a0a-73c0-8140-43f619719293 measured_subset_tokens=null -->

<!-- lisa:usage-rollup direct_entry_ids=verify-1529-019f7f0c-0a0a-73c0-8140-43f619719293 child_entry_ids= child_refs= direct_tokens=null child_tokens=null total_tokens=null direct_cost=null child_cost=null total_cost=null currency=null child_currency=null -->
