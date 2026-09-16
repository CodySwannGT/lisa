@web @ratified-github-1534 @gh-1534
Feature: Starter sync results in the Lisa console

  @BDD-STARTER-003
  Scenario: Sync reports the engine result and preserves failures
    Given the live console can invoke its project-bound starter sync engine
    When the engine returns a review PR, nothing to do, an error, and a committed result
    Then the console reports each distinct result
    And the review result links to the PR and displays its retained worktree
    And nothing to do clears the previous PR link
    And the error is shown as escaped text without claiming success
