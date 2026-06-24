"""
Tests for validate_styling.py seal detection helpers.

Covers:
- find_project_roots: should return ALL ancestor roots (not just first)
- has_design_system_eslint_rule: should only match actual rule/plugin syntax
- has_design_system_eslint_rule: should check .eslintrc.yaml/.yml, eslint.config.mts/.cts
- has_design_system_eslint_rule: should parse package.json eslintConfig field
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Allow importing the module under test
sys.path.insert(0, str(Path(__file__).parent))
from validate_styling import (
    find_project_roots,
    has_design_system_eslint_rule,
    has_sealed_design_system,
)


class TestFindProjectRoots(unittest.TestCase):
    """find_project_roots should return ALL package boundaries, not just the nearest."""

    def test_returns_all_ancestor_roots_in_monorepo(self) -> None:
        """In a monorepo, both the inner package root and the workspace root are returned."""
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            inner = workspace / "apps" / "mobile"
            inner.mkdir(parents=True)

            # workspace root: has .git
            (workspace / ".git").mkdir()
            # inner package: has package.json
            (inner / "package.json").write_text("{}", encoding="utf-8")

            source_file = inner / "src" / "components"
            source_file.mkdir(parents=True)

            roots = find_project_roots(str(source_file))
            # Both the inner package root and the workspace root should be returned
            self.assertIn(inner, roots)
            self.assertIn(workspace, roots)

    def test_returns_single_root_for_simple_project(self) -> None:
        """A flat project returns its single root."""
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            (project / "package.json").write_text("{}", encoding="utf-8")
            (project / ".git").mkdir()

            roots = find_project_roots(str(project / "src"))
            self.assertEqual(len(roots), 1)
            self.assertEqual(roots[0], project)

    def test_falls_back_to_current_directory_when_no_root_found(self) -> None:
        """When no package.json or .git exists, returns the starting path."""
        with tempfile.TemporaryDirectory() as tmp:
            orphan = Path(tmp) / "orphan" / "dir"
            orphan.mkdir(parents=True)
            roots = find_project_roots(str(orphan))
            self.assertEqual(len(roots), 1)


class TestHasDesignSystemEslintRule(unittest.TestCase):
    """has_design_system_eslint_rule should match actual rule/plugin identifiers only."""

    def test_ignores_comment_containing_design_system_substring(self) -> None:
        """A comment that mentions 'design-system' without a slash must not trigger the seal."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            eslint = root / ".eslintrc.json"
            eslint.write_text(
                '{"rules": {}, "// note": "do not use design-system here"}',
                encoding="utf-8",
            )
            self.assertFalse(
                has_design_system_eslint_rule(root),
                msg="Plain 'design-system' substring in a comment must not match",
            )

    def test_matches_design_system_slash_rule_syntax(self) -> None:
        """An ESLint rule like 'design-system/no-raw-colors' should trigger the seal."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            eslint = root / ".eslintrc.json"
            eslint.write_text(
                '{"rules": {"design-system/no-raw-colors": "error"}}',
                encoding="utf-8",
            )
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_checks_eslintrc_yaml(self) -> None:
        """.eslintrc.yaml is a valid ESLint config and must be checked."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            yaml_config = root / ".eslintrc.yaml"
            yaml_config.write_text(
                'rules:\n  design-system/no-raw-colors: error\n',
                encoding="utf-8",
            )
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_checks_eslintrc_yml(self) -> None:
        """.eslintrc.yml is a valid ESLint config and must be checked."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            yml_config = root / ".eslintrc.yml"
            yml_config.write_text(
                'rules:\n  design-system/no-raw-colors: error\n',
                encoding="utf-8",
            )
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_checks_eslint_config_mts(self) -> None:
        """eslint.config.mts is a valid ESLint flat-config entry point and must be checked."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mts_config = root / "eslint.config.mts"
            mts_config.write_text(
                'export default [{"rules": {"design-system/no-raw-colors": "error"}}];',
                encoding="utf-8",
            )
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_checks_eslint_config_cts(self) -> None:
        """eslint.config.cts is a valid ESLint flat-config entry point and must be checked."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cts_config = root / "eslint.config.cts"
            cts_config.write_text(
                'module.exports = [{"rules": {"design-system/no-raw-colors": "error"}}];',
                encoding="utf-8",
            )
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_checks_package_json_eslintconfig_field(self) -> None:
        """The eslintConfig key in package.json must be checked for design-system rules."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pkg = {
                "name": "my-app",
                "eslintConfig": {
                    "rules": {"design-system/no-raw-colors": "error"}
                },
            }
            (root / "package.json").write_text(json.dumps(pkg), encoding="utf-8")
            self.assertTrue(has_design_system_eslint_rule(root))

    def test_package_json_non_eslintconfig_does_not_trigger(self) -> None:
        """A 'design-system' substring in package.json outside eslintConfig must not match."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pkg = {
                "name": "my-app",
                "dependencies": {"design-system": "^1.0.0"},
            }
            (root / "package.json").write_text(json.dumps(pkg), encoding="utf-8")
            self.assertFalse(
                has_design_system_eslint_rule(root),
                msg="'design-system' in dependencies must not trigger the ESLint seal check",
            )


class TestHasSealedDesignSystemMonorepo(unittest.TestCase):
    """has_sealed_design_system should find seal markers in ancestor (workspace) roots."""

    def test_finds_seal_marker_at_workspace_root_not_inner_package(self) -> None:
        """Seal markers placed at the workspace root must be respected for inner packages."""
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            inner = workspace / "apps" / "mobile"
            inner.mkdir(parents=True)

            # workspace root: .git + seal marker
            (workspace / ".git").mkdir()
            rules_dir = workspace / ".claude" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "use-the-design-library.md").write_text("", encoding="utf-8")

            # inner package: package.json + atom barrel
            (inner / "package.json").write_text("{}", encoding="utf-8")
            atoms = inner / "components" / "atoms"
            atoms.mkdir(parents=True)
            (atoms / "index.ts").write_text("", encoding="utf-8")

            target_dir = inner / "src" / "components" / "atoms"
            target_dir.mkdir(parents=True)

            self.assertTrue(
                has_sealed_design_system(str(target_dir)),
                msg="Seal marker at workspace root must be detected even for nested packages",
            )


if __name__ == "__main__":
    unittest.main()
