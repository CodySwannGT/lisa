---
name: journey-guidance
description: "Expo stack guidance for…"
---
Expo stack guidance for Validation Journeys on any tracker: when a ticket needs one, writing it with screenshot markers and viewports, running it in the browser, and naming screenshots. Read by the tracker journey, add-journey, create and evidence skills.


# Expo Validation Journey Guidance

Stack-specific guidance for Validation Journeys in an Expo / React Native project. It applies the same way whichever tracker the project uses (`tracker` in `.lisa.config.json`: `jira`, `github`, or `linear`).

This skill adds the Expo parts only. The vendor skills still read the ticket, append the journey, and post the evidence; the tracker dispatchers (`lisa-tracker-journey`, `lisa-tracker-add-journey`, `lisa-tracker-create`, `lisa-tracker-evidence`) consult this skill before they dispatch. The Jira mechanics (parsing the journey, generating the evidence comment, uploading screenshots) live in the base `lisa-jira-*` skills, so this skill is the only stack guidance on every tracker.

## When a ticket needs a journey

Every ticket that changes, adds, or fixes UI includes a `Validation Journey` section:

- New UI components or screens
- Layout or styling changes (responsive, spacing, colors)
- Modal, drawer, or popover behavior
- Form validation or user input flows
- Bug fixes that can be checked by looking at the screen

Skip it only for pure backend/API changes with no UI surface, config-only changes (env vars, feature flags), and test-only or documentation-only changes.

When the work touches an existing screen, walk the live product first (`lisa-product-walkthrough`) and carry the findings under `## Current Product`. A UI ticket without a current-product walkthrough is missing context the implementer needs.

When drafting tickets:

- Prefer reusing the project's existing component library over pixel-matching a mock from scratch, and say which component in the ticket. In React Native, rebuilding instead of reusing is the most common way a ticket drifts from the product.
- Put every feature behind a feature flag with a lifecycle plan (when it turns on, and when the flag is removed), and name the flag in the journey's Prerequisites.

## Writing the journey

Write it from the end user's point of view, in the tracker's own markup (Markdown for GitHub and Linear, wiki markup for Jira):

```markdown
## Validation Journey

### Prerequisites
- App running locally or on dev
- Authenticated as test user
- Required feature flags enabled (name each flag; in PostHog when `observability.analytics.provider` is `posthog`, the default)

### Steps
1. Navigate to the relevant page
2. Perform the first action
3. Verify the expected state [SCREENSHOT: state-name]
4. Perform the next action
5. Verify the final state [SCREENSHOT: final-state]

### Viewports
| Name | Width | Height |
|------|-------|--------|
| Desktop | 1512 | 768 |
| Mobile | 375 | 812 |

### Assertions
- What must be true on screen at each viewport
```

Rules:

1. **Concrete steps** — "Click the 'Add action' button", not "Interact with the controls".
2. **3–7 screenshot markers** at the states that prove the change works. `[SCREENSHOT: name]` is shorthand for the typed `[EVIDENCE: screenshot: name]` marker in the `verification` rule. Names are kebab-case (`modal-open`, `button-disabled`, `form-error`).
3. **Viewports match the change** — always Desktop (1512×768); add Mobile (375×812) for responsive changes; add Tablet (768×1024) only when relevant.
4. **Assertions are testable** — "Buttons stacked vertically on mobile", not "Layout looks good".
5. **Include sign-in** in Prerequisites when the journey needs it.

To find the flow, read the code: the components involved (search by ticket id, feature name, or paths named in the ticket), the `testID`s Playwright can target, and the Container/View structure, navigation, and modals.

## Running the journey

Requires the Playwright MCP server and a running dev server.

1. Satisfy prerequisites: check the dev server responds (`browser_navigate` to the app URL), sign in with test credentials from `.env.localhost` or `.env.local`, and go to the starting point.
2. Run the **full journey once per viewport**. Between viewports, `browser_resize` to the next size, navigate back to the start, and repeat every step — some modals close on resize, and each screenshot must reflect that viewport's state. If the app asks for sign-in again after a resize or navigation, the journey's steps must include it.
3. At each screenshot marker, `browser_take_screenshot`. For a conditional step, capture the state the step text describes.

## Naming the evidence

Screenshots are `NN-<marker-name>-<viewport>.png`: a zero-padded sequence number, the marker name, and the lowercase viewport name. Three markers over two viewports give `01-…-desktop.png` through `06-…-mobile.png`. Only `.png` is uploaded, so do not save screenshots as `.jpg` or `.gif`. What happens to them next depends on the tracker. On Jira, `lisa-jira-journey`'s template generator labels and sizes each screenshot by the viewport its name ends in, and `lisa-jira-evidence` attaches it to the ticket and uploads it to the configured evidence release under a PR-scoped name, so same-named files on two pull requests never overwrite each other. The GitHub and Linear evidence skills upload text evidence only (`lisa-github-evidence` takes `NN-*.txt`/`.json`; `lisa-linear-evidence` takes text files from `evidence/files/`), so on those trackers attach image evidence to the pull request yourself, and record the text form of each check (for example the command output) under the same `NN-` name so the vendor skill carries it.
