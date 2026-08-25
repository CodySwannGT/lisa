@web @ratified-github-1547 @gh-1547
Feature: Lisa console demo-data boundary

  @BDD-UI-001
  Scenario: Live console sections render sourced values or an explicit empty state
    Given the Lisa console is served with a live configuration property
    When every console section is rendered
    Then every section reports a live, empty, or unknown state
    And no demo-only value is rendered

  @BDD-UI-002
  Scenario: Live rendering never exposes an unclassified catalog value
    Given the Lisa console is served with a live configuration property
    When the first render and later rerenders are inspected
    Then no sourceless catalog row is rendered

  @BDD-UI-003
  Scenario: Empty live sources never fall back to demo values
    Given a console section whose live source returns no data
    When that section is rendered
    Then it shows an empty or unknown state
    And it does not show the section's demo values

  @BDD-UI-004
  Scenario: Direct file opening preserves the demo catalog
    Given the Lisa console file is opened without a live configuration property
    When the page is rendered
    Then the demo catalog is visible

  @BDD-UI-005
  Scenario: The catalog guard rejects an unclassified rendered value
    Given a catalog row has no key, live source, demo-only marker, or static-copy reason
    When the demo-data guard runs
    Then the guard fails and names that row

  @BDD-UI-006
  Scenario: A demo-like identifier from a live source remains valid
    Given a live project is named acme/acme-app
    When the console is served for that project
    Then the live project name is rendered
    And no demo-only value is rendered

  @BDD-UI-007
  Scenario: Partial composite values and empty selections stay truthful
    Given a live project declares only its production branch and an empty credential store
    When the branch map and credential store controls are rendered
    Then the undeclared branch axes render as unknown
    And production renders its declared branch
    And the empty selection renders as unknown instead of the first demo option

  @BDD-UI-008
  Scenario: An unknown renderer cannot expose an unclassified control
    Given an unknown catalog renderer contains a control with no provenance
    When the live console attempts to render it
    Then rendering fails closed and names the unsupported renderer
    And the unclassified control is not visible

  @BDD-UI-009
  Scenario: Preserved live tables reject newly added sourceless rows
    Given a sourceless job row is added to the preserved Quality jobs table
    When the live console attempts to render it
    Then the catalog audit fails and names the added row
    And the sourceless job row is not visible
