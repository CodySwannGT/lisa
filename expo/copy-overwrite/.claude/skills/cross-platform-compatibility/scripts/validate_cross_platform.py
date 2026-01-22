#!/usr/bin/env python3
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
"""
Cross-Platform Compatibility Validator

This script validates Expo/React Native code for cross-platform compatibility issues.
It checks for:
1. Platform-specific files in app/ directory without base versions
2. Platform.OS checks that don't handle all platforms
3. Web-incompatible API usage without Platform checks
4. Incomplete Platform.select() usage

Usage:
    python3 validate_cross_platform.py [path]

    path: Optional. Directory or file to validate. Defaults to current directory.
"""

import os
import re
import sys
from pathlib import Path
from typing import NamedTuple


class ValidationIssue(NamedTuple):
    """Represents a validation issue found in the codebase."""

    file_path: str
    line_number: int
    issue_type: str
    message: str
    severity: str  # "error" or "warning"


# Platform-specific file extensions
PLATFORM_EXTENSIONS = [".web", ".native", ".ios", ".android"]

# Web-incompatible APIs that require Platform.OS checks
WEB_INCOMPATIBLE_APIS = [
    "MediaLibrary.saveToLibraryAsync",
    "MediaLibrary.createAssetAsync",
    "MediaLibrary.getAssetsAsync",
    "Haptics.impactAsync",
    "Haptics.notificationAsync",
    "Haptics.selectionAsync",
    "captureRef",
    "SecureStore.getItemAsync",
    "SecureStore.setItemAsync",
    "SecureStore.deleteItemAsync",
]

# Patterns that suggest incomplete platform handling
INCOMPLETE_PLATFORM_PATTERNS = [
    # Platform.OS === 'web' without else/default
    (
        r"if\s*\(\s*Platform\.OS\s*===?\s*['\"]web['\"]\s*\)\s*\{[^}]+\}(?!\s*else)",
        "Platform.OS check for 'web' without handling other platforms",
    ),
    # Platform.OS === 'ios' without android/web handling
    (
        r"if\s*\(\s*Platform\.OS\s*===?\s*['\"]ios['\"]\s*\)\s*\{[^}]+\}(?!\s*else)",
        "Platform.OS check for 'ios' without handling other platforms",
    ),
    # Platform.OS === 'android' without ios/web handling
    (
        r"if\s*\(\s*Platform\.OS\s*===?\s*['\"]android['\"]\s*\)\s*\{[^}]+\}(?!\s*else)",
        "Platform.OS check for 'android' without handling other platforms",
    ),
]


def get_base_filename(filename: str) -> str:
    """
    Extract the base filename without platform extension.

    Args:
        filename: The filename to process

    Returns:
        The base filename without platform extension
    """
    name = filename
    for ext in PLATFORM_EXTENSIONS:
        if ext in name:
            name = name.replace(ext, "")
            break
    return name


def has_platform_extension(filename: str) -> bool:
    """
    Check if a filename has a platform-specific extension.

    Args:
        filename: The filename to check

    Returns:
        True if the filename has a platform extension
    """
    return any(ext in filename for ext in PLATFORM_EXTENSIONS)


def find_orphaned_platform_files(app_dir: Path) -> list[ValidationIssue]:
    """
    Find platform-specific files in app/ directory without base versions.

    Args:
        app_dir: Path to the app directory

    Returns:
        List of validation issues for orphaned files
    """
    issues = []

    if not app_dir.exists():
        return issues

    # Collect all files in app directory
    all_files = set()
    platform_files = []

    for file_path in app_dir.rglob("*"):
        if file_path.is_file() and file_path.suffix in [".tsx", ".ts", ".jsx", ".js"]:
            relative_path = file_path.relative_to(app_dir)
            all_files.add(str(relative_path))

            if has_platform_extension(file_path.name):
                platform_files.append(file_path)

    # Check each platform file for a base version
    for platform_file in platform_files:
        base_name = get_base_filename(platform_file.name)
        relative_dir = platform_file.parent.relative_to(app_dir)

        # Check if base file exists
        base_path = str(relative_dir / base_name) if str(relative_dir) != "." else base_name
        base_exists = base_path in all_files

        if not base_exists:
            issues.append(
                ValidationIssue(
                    file_path=str(platform_file),
                    line_number=0,
                    issue_type="orphaned_platform_file",
                    message=f"Platform-specific file '{platform_file.name}' in app/ directory "
                    f"has no base version '{base_name}'. Routes must be universal for deep linking.",
                    severity="error",
                )
            )

    return issues


def check_web_incompatible_apis(file_path: Path) -> list[ValidationIssue]:
    """
    Check for web-incompatible API usage without Platform checks.

    Args:
        file_path: Path to the file to check

    Returns:
        List of validation issues for web-incompatible APIs
    """
    issues = []

    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, IOError):
        return issues

    lines = content.split("\n")

    for api in WEB_INCOMPATIBLE_APIS:
        # Find lines containing the API
        for line_num, line in enumerate(lines, 1):
            if api in line:
                # Check if there's a Platform check nearby (within 10 lines before)
                start_line = max(0, line_num - 10)
                context = "\n".join(lines[start_line : line_num + 1])

                has_platform_check = (
                    "Platform.OS" in context
                    or "Platform.select" in context
                    or '.native"' in str(file_path)
                    or ".native'" in str(file_path)
                )

                if not has_platform_check:
                    issues.append(
                        ValidationIssue(
                            file_path=str(file_path),
                            line_number=line_num,
                            issue_type="web_incompatible_api",
                            message=f"'{api}' may not work on web. Consider adding a Platform.OS check.",
                            severity="warning",
                        )
                    )

    return issues


def check_incomplete_platform_handling(file_path: Path) -> list[ValidationIssue]:
    """
    Check for incomplete Platform.OS handling patterns.

    Args:
        file_path: Path to the file to check

    Returns:
        List of validation issues for incomplete platform handling
    """
    issues = []

    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, IOError):
        return issues

    for pattern, message in INCOMPLETE_PLATFORM_PATTERNS:
        matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)
        for match in matches:
            # Calculate line number
            line_num = content[: match.start()].count("\n") + 1

            issues.append(
                ValidationIssue(
                    file_path=str(file_path),
                    line_number=line_num,
                    issue_type="incomplete_platform_handling",
                    message=message,
                    severity="warning",
                )
            )

    return issues


def check_platform_select_completeness(file_path: Path) -> list[ValidationIssue]:
    """
    Check if Platform.select() calls handle all platforms or have a default.

    Args:
        file_path: Path to the file to check

    Returns:
        List of validation issues for incomplete Platform.select usage
    """
    issues = []

    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, IOError):
        return issues

    # Find Platform.select calls
    pattern = r"Platform\.select\s*\(\s*\{([^}]+)\}\s*\)"
    matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)

    for match in matches:
        select_content = match.group(1)
        line_num = content[: match.start()].count("\n") + 1

        has_ios = "ios:" in select_content or "'ios'" in select_content or '"ios"' in select_content
        has_android = (
            "android:" in select_content
            or "'android'" in select_content
            or '"android"' in select_content
        )
        has_web = "web:" in select_content or "'web'" in select_content or '"web"' in select_content
        has_native = (
            "native:" in select_content
            or "'native'" in select_content
            or '"native"' in select_content
        )
        has_default = (
            "default:" in select_content
            or "'default'" in select_content
            or '"default"' in select_content
        )

        # Check completeness
        covers_all = (has_ios and has_android and has_web) or has_default or (has_native and has_web)

        if not covers_all:
            missing = []
            if not has_ios and not has_native:
                missing.append("ios")
            if not has_android and not has_native:
                missing.append("android")
            if not has_web:
                missing.append("web")

            if missing and not has_default:
                issues.append(
                    ValidationIssue(
                        file_path=str(file_path),
                        line_number=line_num,
                        issue_type="incomplete_platform_select",
                        message=f"Platform.select() missing handling for: {', '.join(missing)}. "
                        "Consider adding a 'default' key.",
                        severity="warning",
                    )
                )

    return issues


def validate_directory(root_path: Path) -> list[ValidationIssue]:
    """
    Validate all files in a directory for cross-platform issues.

    Args:
        root_path: Path to the directory to validate

    Returns:
        List of all validation issues found
    """
    issues = []

    # Check for orphaned platform files in app/ directory
    app_dir = root_path / "app"
    issues.extend(find_orphaned_platform_files(app_dir))

    # Check TypeScript/JavaScript files
    extensions = [".tsx", ".ts", ".jsx", ".js"]
    exclude_dirs = ["node_modules", ".git", "dist", "build", ".expo"]

    for ext in extensions:
        for file_path in root_path.rglob(f"*{ext}"):
            # Skip excluded directories
            if any(excluded in str(file_path) for excluded in exclude_dirs):
                continue

            # Skip platform-specific files for web incompatibility checks
            # (they're inherently platform-specific)
            if not has_platform_extension(file_path.name):
                issues.extend(check_web_incompatible_apis(file_path))

            issues.extend(check_incomplete_platform_handling(file_path))
            issues.extend(check_platform_select_completeness(file_path))

    return issues


def print_issues(issues: list[ValidationIssue]) -> None:
    """
    Print validation issues in a formatted way.

    Args:
        issues: List of validation issues to print
    """
    if not issues:
        print("✅ No cross-platform compatibility issues found!")
        return

    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]

    print(f"\n🔍 Found {len(issues)} issue(s):\n")

    if errors:
        print(f"❌ Errors ({len(errors)}):")
        print("-" * 60)
        for issue in errors:
            location = f"{issue.file_path}:{issue.line_number}" if issue.line_number else issue.file_path
            print(f"  [{issue.issue_type}] {location}")
            print(f"    {issue.message}\n")

    if warnings:
        print(f"⚠️  Warnings ({len(warnings)}):")
        print("-" * 60)
        for issue in warnings:
            location = f"{issue.file_path}:{issue.line_number}" if issue.line_number else issue.file_path
            print(f"  [{issue.issue_type}] {location}")
            print(f"    {issue.message}\n")


def main() -> int:
    """
    Main entry point for the validation script.

    Returns:
        Exit code (0 for success, 1 for errors found)
    """
    # Get path from arguments or use current directory
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    else:
        path = Path.cwd()

    if not path.exists():
        print(f"❌ Error: Path '{path}' does not exist")
        return 1

    print(f"🔍 Validating cross-platform compatibility in: {path}")

    if path.is_file():
        issues = []
        if not has_platform_extension(path.name):
            issues.extend(check_web_incompatible_apis(path))
        issues.extend(check_incomplete_platform_handling(path))
        issues.extend(check_platform_select_completeness(path))
    else:
        issues = validate_directory(path)

    print_issues(issues)

    # Return error code if there are any errors
    has_errors = any(issue.severity == "error" for issue in issues)
    return 1 if has_errors else 0


if __name__ == "__main__":
    sys.exit(main())
