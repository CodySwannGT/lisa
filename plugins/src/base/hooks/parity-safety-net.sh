#!/usr/bin/env bash
# Retired in #4672. Kept callable for persisted and already-loaded hooks.
# The Lisa plugin and every unrelated guard remain enabled.
# The shared parser remains for active instruction guards and legacy copies.
# No input parsing, command execution, dependencies, or policy refusals.
# Retained source-profile metadata for compatibility with build tooling. The
# retired hook never uses this profile to classify a command.
readonly SCRATCH_SUPERVISOR_SHA256='76ccf8ca6f98b214361f02ebf6ad58041129b76ed29128455e810095db6c292f'
readonly SCRATCH_SUPERVISOR_CLEANUP_COUNT='7'
# Drain hook input with bounded Bash builtins so native writers do not hit a
# closed pipe. Nothing in the input is interpreted or executed.
while IFS= read -r -n 8192 _lisa_retired_chunk || [ -n "$_lisa_retired_chunk" ]; do :; done
exit 0
