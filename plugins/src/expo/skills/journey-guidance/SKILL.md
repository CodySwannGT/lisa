---
name: journey-guidance
description: "Expo stack guidance for Validation Journeys on any tracker: when a ticket needs one, writing it with screenshot markers and viewports, running it in the browser, and naming screenshots. Read by the tracker journey, add-journey, create and evidence skills."
---

# Expo Validation Journey Guidance

Stack-specific guidance for Validation Journeys in an Expo / React Native project. It applies the same way whichever tracker the project uses (`tracker` in `.lisa.config.json`: `jira`, `github`, or `linear`).

This skill adds the Expo parts only. The vendor skills still read the ticket, append the journey, and post the evidence; the tracker dispatchers (`lisa-tracker-journey`, `lisa-tracker-add-journey`, `lisa-tracker-create`, `lisa-tracker-evidence`) consult this skill before they dispatch. The Jira-only overlays in this plugin (`jira-journey`, `jira-add-journey`, `jira-create`, `jira-evidence`) carry the same guidance plus Jira mechanics; this skill is what a GitHub or Linear project reaches.

## When a ticket needs a journey

Every ticket that changes, adds, or fixes UI includes a `Validation Journey` section:

- New UI components or screens
- Layout or styling changes (responsive, spacing, colors)
- Modal, drawer, or popover behavior
- Form validation or user input flows
- Bug fixes that can be checked by looking at the screen

Skip it only for pure backend/API changes with no UI surface, config-only changes (env vars, feature flags), and test-only or documentation-only changes.

When the work touches an existing screen, walk the live product first (`lisa-product-walkthrough`) and carry the findings under `## Current Product`. A UI ticket without a current-product walkthrough is missing context the implementer needs.

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
2. Run the **full journey once per viewport**. Between viewports, `browser_resize` to the next size, navigate back to the start, and repeat every step — some modals close on resize, and each screenshot must reflect that viewport's state.
3. At each screenshot marker, `browser_take_screenshot`. For a conditional step, capture the state the step text describes.

## Naming the evidence

Screenshots are `NN-<marker-name>-<viewport>.png`: a zero-padded sequence number, the marker name, and the lowercase viewport name. Three markers over two viewports give `01-…-desktop.png` through `06-…-mobile.png`. What happens to them next depends on the tracker. On Jira, `lisa-jira-evidence` uploads them to the configured evidence release under a PR-scoped name, so same-named files on two pull requests never overwrite each other. The GitHub and Linear evidence skills upload text evidence only (`lisa-github-evidence` takes `NN-*.txt`/`.json`; `lisa-linear-evidence` takes text files from `evidence/files/`), so on those trackers attach image evidence to the pull request yourself, and record the text form of each check (for example the command output) under the same `NN-` name so the vendor skill carries it.
