# Production Verifiability (load-bearing)

A change is not done when it builds and starts. Make its production impact detectable, diagnosable, and reversible.

- Instrument the operations you add or change at their boundaries: outcomes, errors, and latency, tagged with the release. Use the project's existing telemetry, whatever the tools.
- Fill in the PR's "How we'll know it works in production" and "How to undo" sections.
- Follow your instrumentation to wherever it sends data, and confirm the data arrives there.
- Keep secrets, personal data, and high-cardinality values out of telemetry.

Full principle: [reference/production-verifiability.md](../reference/production-verifiability.md).
