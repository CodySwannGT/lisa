#!/bin/bash
# Extract the &phase-path run script verbatim from npm-updater.yml and run it under bash.
WT="$1"; N=/Users/codysai/.local/share/mise/installs/node/22.23.3/bin/node
echo "HEAD under test: $(cd "$WT" && git rev-parse HEAD)"
echo "bash: /bin/bash => $BASH_VERSION"
SCRIPT=/tmp/v4741-verify/phase-path-step.sh
$N -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").split("\n");
const i=lines.findIndex(l=>/- &phase-path$/.test(l));
const r=lines.findIndex((l,k)=>k>i&&/^\s+run: \|$/.test(l));
const ind=lines[r+1].match(/^\s*/)[0];
const out=[];for(let k=r+1;k<lines.length&&lines[k].startsWith(ind);k++)out.push(lines[k].slice(ind.length));
require("fs").writeFileSync(process.argv[2],out.join("\n")+"\n");' "$WT/.github/workflows/npm-updater.yml" "$SCRIPT"
echo "---- extracted run script ----"; cat "$SCRIPT"; echo "---- end ----"
run() {
  local label="$1" value="$2" env=/tmp/v4741-verify/ghenv
  : > "$env"
  local out; out=$(LISA_NPM_DIRECTORY="$value" GITHUB_ENV="$env" RUNNER_TEMP=/tmp/rt /bin/bash "$SCRIPT" 2>&1); local code=$?
  printf '%-10s exit=%s NPM_ARTIFACT_SUFFIX=[%s] stdout=%s\n' "$label" "$code" "$(grep '^NPM_ARTIFACT_SUFFIX=' "$env" | cut -d= -f2-)" "\"$out\""
}
run '"."' "."
run '"externals"' "externals"
run '"a/b"' "a/b"
run '"a_/b"' "a_/b"
run '"a/_b"' "a/_b"
run '"../x"' "../x"
run '"x/"' "x/"
run '"a\nB=1"' "$(printf 'a\nB=1')"
echo "== distinctness of a_/b vs a/_b"
A=$(LISA_NPM_DIRECTORY='a_/b' GITHUB_ENV=/tmp/v4741-verify/e1 RUNNER_TEMP=/tmp/rt /bin/bash "$SCRIPT"; grep '^NPM_ARTIFACT_SUFFIX=' /tmp/v4741-verify/e1 | cut -d= -f2-; rm -f /tmp/v4741-verify/e1)
B=$(LISA_NPM_DIRECTORY='a/_b' GITHUB_ENV=/tmp/v4741-verify/e2 RUNNER_TEMP=/tmp/rt /bin/bash "$SCRIPT"; grep '^NPM_ARTIFACT_SUFFIX=' /tmp/v4741-verify/e2 | cut -d= -f2-; rm -f /tmp/v4741-verify/e2)
echo "a_/b -> $A ; a/_b -> $B ; distinct=$([ "$A" != "$B" ] && echo yes || echo NO)"
echo "== bite control: the prior '__' mapping on the same two inputs"
echo "a_/b -> dir-$(v='a_/b'; echo "${v//\//__}") ; a/_b -> dir-$(v='a/_b'; echo "${v//\//__}") (collide under the old mapping)"
echo "== concurrency group line"
grep -n 'group: lisa-npm-' "$WT/.github/workflows/npm-updater.yml"
