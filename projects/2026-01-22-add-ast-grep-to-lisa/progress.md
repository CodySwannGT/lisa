# Progress

## Tasks

- [ ] 1. Add ast-grep configuration files (sgconfig.yml and directory structure)
- [ ] 2. Add @ast-grep/cli dependency to typescript/merge/package.json
- [ ] 3. Add sg:scan script to typescript/merge/package.json
- [ ] 4. Create ast-grep Claude hook (sg-scan-on-edit.sh)
- [ ] 5. Register ast-grep hook in .claude/settings.json
- [ ] 6. Add ast-grep to lint-staged configuration
- [ ] 7. Add ast-grep to pre-commit hook
- [ ] 8. Add ast-grep job to quality.yml workflow

## Notes

Tasks are ordered for logical dependency:
- Tasks 1-3 set up the basic ast-grep infrastructure
- Tasks 4-5 integrate with Claude hooks
- Tasks 6-7 integrate with pre-commit workflow
- Task 8 adds CI/CD quality check
