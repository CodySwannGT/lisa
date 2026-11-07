#!/usr/bin/env bash
# Retired native safety-net adapter (#4672). Old agy registrations stay valid.
# Does not require the formerly delegated parity-safety-net.sh sibling.
while IFS= read -r -n 8192 _lisa_retired_chunk || [ -n "$_lisa_retired_chunk" ]; do :; done
printf '{"decision":"allow"}\n'
exit 0
