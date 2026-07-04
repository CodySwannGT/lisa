# Public External Inspiration Example Output

## What Already Exists
- The host project already has a command catalog and source-authored skill files.
- The host project can inspect public documentation pages without sign-in.
- Existing verification can run through CLI commands and generated markdown artifacts.

## Practical Ideas
### 1. Public Pattern Checklist Import
- User value: Maintainers can compare their command guidance against public best-practice pages without copying private or paid content.
- Existing fit: Builds on the current docs and skill authoring workflow.
- Data/source path: A public, no-login documentation URL supplied by the user, plus local `README.md` and skill files.
- Practical slice: Generate a checklist of public patterns found in the external page and mark whether each is already represented locally.
- Empirical verification: Run the ideation workflow against a fixed public URL and inspect the generated checklist.
- Evidence: Generated markdown containing source URLs, matched local file paths, and unmatched public patterns.
- Confidence: medium because public pages can change, but the source path is accessible and citeable.

## Discovery Spikes
- Automated freshness checks for public pages: needs a policy for when external pages may be re-fetched and cached.

## Rejected / Not Practical Yet
- Importing examples from a sign-in-only competitor workspace: rejected because the data source is not publicly obtainable.
