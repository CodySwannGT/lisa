When updating a project file, always check to see if it has a cooresponding template file. IF it does, update it to match

Never parse JSON in shell scripts using grep/sed/cut/awk - always use jq for robust JSON handling

When creating Claude Code hooks for enforcement (linting, code quality, static analysis), always use blocking behavior (exit 1 on failures) so Claude receives feedback and can fix the errors. Notification-only hooks (like ntfy.sh) should exit 0 since they don't require Claude to take action.