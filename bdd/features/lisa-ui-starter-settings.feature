@web @ratified-github-1520 @gh-1520
Feature: Project starter provenance in the Lisa console

  @BDD-STARTER-001
  Scenario: Multiple starter origins render independently
    Given a project declares three starter templates with their own refs and sync provenance
    When config sync populates defaults and the live console opens
    Then every recorded entry renders with its own repository, ref, commit, and date
    And demo origins are absent
    And the planned Sync now action remains disabled
    And saving or discarding other settings keeps provenance read-only and unchanged

  @BDD-STARTER-002
  Scenario: Missing provenance has an explicit empty state
    Given a project has no recorded starter templates
    When the live console opens
    Then it reports that no starter templates are recorded
    And no template origins are invented
