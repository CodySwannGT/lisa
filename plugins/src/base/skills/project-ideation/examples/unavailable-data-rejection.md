# Unavailable Data Rejection Example Output

## What Already Exists
- The host project can read local source files, docs, scripts, and generated artifacts.
- The host project does not expose customer analytics, private support tickets, or paid market datasets.

## Practical Ideas
### 1. Local Verification Gap Finder
- User value: Maintainers can identify skills that describe empirical verification but do not name an evidence artifact.
- Existing fit: Builds on local skill markdown files and existing unit tests.
- Data/source path: Local `SKILL.md` files under the plugin source tree.
- Practical slice: Scan skill files for verification sections and report entries that mention tests but no observable artifact.
- Empirical verification: Run the scanner against a fixture skill with one missing evidence line.
- Evidence: CLI output naming the fixture skill and the missing evidence field.
- Confidence: high because the input is local and fully inspectable.

## Discovery Spikes
- Prioritize gaps by real-world usage: needs an obtainable telemetry source or a manually approved usage export before it can rank by frequency.

## Rejected / Not Practical Yet
- Recommend ideas from private customer support pain points: rejected because the missing source is a legitimate support-ticket export or configured support integration.
- Recommend ideas from paid analyst reports: rejected because the missing source is a licensed data feed available to the agent at runtime.
