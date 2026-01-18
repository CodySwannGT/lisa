#!/usr/bin/env bats
# Lisa test suite using bats-core
# Run with: bats tests/lisa.bats
# Install bats: brew install bats-core (macOS) or apt install bats (Linux)

# Setup and teardown
setup() {
    # Get the directory containing the test file
    TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    LISA_DIR="$(cd "$TEST_DIR/.." && pwd)"
    LISA_SCRIPT="$LISA_DIR/lisa.sh"

    # Create a temporary directory for test projects
    TEST_PROJECT="$(mktemp -d)"

    # Ensure we have a clean test environment
    export PATH="$LISA_DIR:$PATH"
}

teardown() {
    # Clean up temporary directory
    if [[ -d "$TEST_PROJECT" ]]; then
        rm -rf "$TEST_PROJECT"
    fi
}

# Helper function to create a minimal project
create_minimal_project() {
    mkdir -p "$TEST_PROJECT"
    echo '{}' > "$TEST_PROJECT/package.json"
}

# Helper function to create a TypeScript project
create_typescript_project() {
    mkdir -p "$TEST_PROJECT"
    echo '{"dependencies": {"typescript": "^5.0.0"}}' > "$TEST_PROJECT/package.json"
    echo '{}' > "$TEST_PROJECT/tsconfig.json"
}

# Helper function to create an Expo project
create_expo_project() {
    mkdir -p "$TEST_PROJECT"
    echo '{"dependencies": {"expo": "^50.0.0"}}' > "$TEST_PROJECT/package.json"
    echo '{"expo": {"name": "test-app"}}' > "$TEST_PROJECT/app.json"
}

# Helper function to create a NestJS project
create_nestjs_project() {
    mkdir -p "$TEST_PROJECT"
    echo '{"dependencies": {"@nestjs/core": "^10.0.0"}}' > "$TEST_PROJECT/package.json"
    echo '{}' > "$TEST_PROJECT/nest-cli.json"
}

# Helper function to create a CDK project
create_cdk_project() {
    mkdir -p "$TEST_PROJECT"
    echo '{"dependencies": {"aws-cdk-lib": "^2.0.0"}}' > "$TEST_PROJECT/package.json"
    echo '{}' > "$TEST_PROJECT/cdk.json"
}

# =============================================================================
# Basic Script Tests
# =============================================================================

@test "lisa.sh exists and is executable" {
    [[ -x "$LISA_SCRIPT" ]]
}

@test "lisa.sh shows help with --help" {
    run "$LISA_SCRIPT" --help
    [[ "$status" -eq 1 ]]  # usage exits with 1
    [[ "$output" =~ "Usage:" ]]
    [[ "$output" =~ "--dry-run" ]]
    [[ "$output" =~ "--yes" ]]
    [[ "$output" =~ "--validate" ]]
    [[ "$output" =~ "--uninstall" ]]
}

@test "lisa.sh shows help with -h" {
    run "$LISA_SCRIPT" -h
    [[ "$status" -eq 1 ]]
    [[ "$output" =~ "Usage:" ]]
}

@test "lisa.sh fails without destination" {
    run "$LISA_SCRIPT"
    [[ "$status" -eq 1 ]]
    [[ "$output" =~ "Usage:" ]]
}

@test "lisa.sh fails with non-existent destination" {
    run "$LISA_SCRIPT" "/nonexistent/path/that/does/not/exist"
    [[ "$status" -eq 1 ]]
    [[ "$output" =~ "ERROR" ]]
}

# =============================================================================
# Dependency Check Tests
# =============================================================================

@test "lisa.sh checks for jq dependency" {
    # Verify jq is mentioned in the script
    run grep -q "command -v jq" "$LISA_SCRIPT"
    [[ "$status" -eq 0 ]]
}

# =============================================================================
# Project Type Detection Tests
# =============================================================================

@test "detects TypeScript project by tsconfig.json" {
    create_typescript_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "typescript" ]]
}

@test "detects Expo project by app.json" {
    create_expo_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "expo" ]]
}

@test "detects NestJS project by nest-cli.json" {
    create_nestjs_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "nestjs" ]]
}

@test "detects CDK project by cdk.json" {
    create_cdk_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "cdk" ]]
}

@test "Expo project includes TypeScript parent" {
    create_expo_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "typescript" ]]
    [[ "$output" =~ "expo" ]]
}

@test "NestJS project includes TypeScript parent" {
    create_nestjs_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "typescript" ]]
    [[ "$output" =~ "nestjs" ]]
}

@test "CDK project includes TypeScript parent" {
    create_cdk_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "typescript" ]]
    [[ "$output" =~ "cdk" ]]
}

# =============================================================================
# Dry Run Tests
# =============================================================================

@test "dry run does not modify files" {
    create_typescript_project
    local before_count=$(find "$TEST_PROJECT" -type f | wc -l)

    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    local after_count=$(find "$TEST_PROJECT" -type f | wc -l)
    [[ "$before_count" -eq "$after_count" ]]
}

@test "dry run shows what would be copied" {
    create_typescript_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "DRY-RUN" ]] || [[ "$output" =~ "Would" ]]
}

# =============================================================================
# Validate Mode Tests
# =============================================================================

@test "validate mode reports compatibility" {
    create_typescript_project
    run "$LISA_SCRIPT" --validate "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "VALIDATE" ]] || [[ "$output" =~ "Validation" ]]
}

@test "validate mode does not modify files" {
    create_typescript_project
    local before_count=$(find "$TEST_PROJECT" -type f | wc -l)

    run "$LISA_SCRIPT" --validate "$TEST_PROJECT"

    local after_count=$(find "$TEST_PROJECT" -type f | wc -l)
    [[ "$before_count" -eq "$after_count" ]]
}

# =============================================================================
# Copy Strategy Tests
# =============================================================================

@test "copy-overwrite creates new files" {
    create_typescript_project
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    # Check that at least some files were copied
    [[ "$output" =~ "Copied:" ]] || [[ "$output" =~ "Copied" ]]
}

@test "copy-overwrite skips identical files" {
    create_typescript_project

    # Run twice
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    # Second run should skip most files
    [[ "$output" =~ "Skipped:" ]] || [[ "$output" =~ "identical" ]]
}

# =============================================================================
# Manifest Tests
# =============================================================================

@test "creates manifest file after installation" {
    create_typescript_project
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    # Check manifest was created
    [[ -f "$TEST_PROJECT/.lisa-manifest" ]]
}

@test "manifest contains file entries" {
    create_typescript_project
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    # Check manifest has content beyond just comments
    local entry_count=$(grep -v '^#' "$TEST_PROJECT/.lisa-manifest" | grep -v '^$' | wc -l)
    [[ "$entry_count" -gt 0 ]]
}

# =============================================================================
# Uninstall Tests
# =============================================================================

@test "uninstall fails without manifest" {
    create_typescript_project
    run "$LISA_SCRIPT" --uninstall "$TEST_PROJECT"
    [[ "$status" -eq 1 ]]
    [[ "$output" =~ "No Lisa manifest found" ]]
}

@test "uninstall removes copy-overwrite files" {
    create_typescript_project

    # Install first
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    # Verify manifest exists
    [[ -f "$TEST_PROJECT/.lisa-manifest" ]]

    # Uninstall
    run "$LISA_SCRIPT" --uninstall "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "Removed:" ]] || [[ "$output" =~ "Uninstall Complete" ]]

    # Manifest should be removed
    [[ ! -f "$TEST_PROJECT/.lisa-manifest" ]]
}

@test "uninstall dry-run does not remove files" {
    create_typescript_project

    # Install first
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    local before_count=$(find "$TEST_PROJECT" -type f | wc -l)

    # Dry run uninstall
    run "$LISA_SCRIPT" --dry-run --uninstall "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]

    local after_count=$(find "$TEST_PROJECT" -type f | wc -l)
    [[ "$before_count" -eq "$after_count" ]]
}

# =============================================================================
# Non-Interactive Mode Tests
# =============================================================================

@test "yes mode runs without prompts" {
    create_typescript_project
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
}

@test "yes mode overwrites conflicting files" {
    create_typescript_project

    # Create a file that will conflict
    mkdir -p "$TEST_PROJECT/.claude"
    echo "custom content" > "$TEST_PROJECT/.claude/settings.json"

    # Run with --yes to auto-accept
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
}

# =============================================================================
# Edge Cases
# =============================================================================

@test "handles project with no package.json" {
    mkdir -p "$TEST_PROJECT"
    # No package.json, just an empty directory

    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
}

@test "handles relative path" {
    create_typescript_project
    cd "$TEST_PROJECT"

    run "$LISA_SCRIPT" --dry-run --yes .
    [[ "$status" -eq 0 ]]
}

@test "handles path with spaces" {
    local SPACE_PROJECT="$(mktemp -d)/project with spaces"
    mkdir -p "$SPACE_PROJECT"
    echo '{}' > "$SPACE_PROJECT/package.json"

    run "$LISA_SCRIPT" --dry-run --yes "$SPACE_PROJECT"
    [[ "$status" -eq 0 ]]

    rm -rf "$(dirname "$SPACE_PROJECT")"
}

# =============================================================================
# Summary Output Tests
# =============================================================================

@test "shows installation summary" {
    create_typescript_project
    run "$LISA_SCRIPT" --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "Installation Complete" ]] || [[ "$output" =~ "Complete" ]]
    [[ "$output" =~ "Copied:" ]] || [[ "$output" =~ "files" ]]
}

@test "shows dry run summary" {
    create_typescript_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "Dry Run Complete" ]] || [[ "$output" =~ "DRY RUN" ]]
}

@test "shows project types in summary" {
    create_expo_project
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "Project types:" ]]
}
