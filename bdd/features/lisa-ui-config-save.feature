@web @ratified-github-1528 @gh-1528
Feature: Save configuration in the live Lisa console

  @BDD-SAVE-001
  Scenario: Save and Discard use the last confirmed configuration
    Given a live console with three changed numeric settings
    When the user saves the changes
    Then only the three changed keys are written
    And Discard restores their last confirmed values
    But a failed retry keeps its draft and shows an error

  @BDD-SAVE-002
  Scenario: Different controls preserve their value types and storage destination
    Given a live console with text, selection, toggle and environment settings
    When the user changes and saves those settings
    Then each value keeps its JSON type
    And local settings are written to the local configuration

  @BDD-SAVE-003
  Scenario: A pending or unconfirmed save cannot discard edits
    Given the console has pending changes
    When a save is in progress
    Then overlapping edits are disabled
    But an unconfirmed response retains the draft and displays an error

  @BDD-SAVE-004
  Scenario: Editing a legacy environment setting preserves production
    Given a production setting is stored as a legacy string
    When the user changes another environment and saves
    Then the original production value is preserved

  @BDD-SAVE-005
  Scenario: Background status rendering preserves an unfinished edit
    Given the user has edited a number or cleared its input
    When a delayed status response renders the console again
    Then the unfinished value and its changed indicator remain visible

  @BDD-SAVE-006
  Scenario: Tag removal preserves the exact visible pending array
    Given the console displays duplicate tags
    When the user removes a tag and attempts to save
    Then the pending array matches the remaining visible tags
    And a setting outside the write allowlist keeps its error and draft
    And Discard restores the saved tags

  @BDD-SAVE-007
  Scenario: An unwritable file retains the draft
    Given the configuration file is read-only
    When the user attempts to save a changed setting
    Then the file is unchanged
    And the draft and error remain visible without a success message
