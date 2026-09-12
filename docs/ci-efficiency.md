# Reducing repeated CI work

These workflow options change orchestration and reuse. Gate declarations in
`.lisa.config.json` still determine whether a check is required, optional, or off.
Required failures block, optional failures remain visible without blocking, and
off gates do not execute.

| Workflow input | Default | Behavior |
| --- | --- | --- |
| `release.yml: run_quality_checks` | `true` | Set `false` when protected PR CI already supplies the required quality checks. The configured quality invocation is omitted entirely; release approvals, scheduling, versioning, signing, and deployment jobs remain. Do not opt out if that invocation supplies unique pre-deploy checks. Reports distinguish skipped from passed. |
| `quality.yml: cache_dependencies` | `true` | Reuse package downloads keyed by platform, architecture, package manager, Node version, and lockfiles. Every selected install still runs; installed dependency directories and build results are not restored by this option. |
| `quality.yml: combine_planning_checks` | `false` | Run compatibility and declared-gate planning inside the preallocation job. Enable only after verifying branch protection does not require the separate Workflow Contract or Declared Gate Legs contexts. Actual gates retain their individual contexts and execution policy. |
| `quality.yml: publish_web_export` | `false` | Publish the successful performance-check `dist` directory, including hidden public files, for checks in this run. The temporary transfer artifact expires after one day. Failure to transfer does not turn a quality failure into success. |
| `zap-baseline-expo.yml: reuse_quality_web_export` | `false` | Download the export from the same run and attempt. Build normally if it was not published or cannot be downloaded. The ZAP scan still runs. |

To share the web export, enable both options and make the ZAP caller depend on
the quality caller. Use this only when both checks should scan the same export
configuration. A performance gate that is off publishes nothing, so ZAP builds
its own export.

Only the identity job publishes the package download cache. Other jobs restore
it and still install normally, avoiding competing archive-and-save attempts on
a cache miss. Combining planning keeps a compatibility failure visible while
allowing successfully planned gate jobs to report their own results.

New TypeScript CI callers group revisions of one PR together and cancel the
superseded revision. Other events use the run identifier, so separate manual
requests cannot evict one another from a pending concurrency slot. Stateful
workflows that intentionally serialize requests need their own policy.

Use one automatic native-build trigger. If releases can be canceled by later
pushes, keep the native trigger independent of that release workflow and reserve
release-triggered native builds for manual requests. When comparing a push,
inspect its full before-to-head range; inspecting only the final commit misses
earlier configuration changes in the same push.
