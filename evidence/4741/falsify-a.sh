#!/bin/bash
# Falsify the two (a) checks: files-set equality and root bun.lock byte identity.
N=/Users/codysai/.local/share/mise/installs/node/22.23.3/bin/node
W=/tmp/v4741-verify/work/a
echo "HEAD under test: $1"
echo "== falsify files check: inject bun.lock into a copy of proposal.json"
$N -e 'const p=require(process.argv[1]);p.files["bun.lock"]="x";require("fs").writeFileSync(process.argv[2],JSON.stringify(p))' "$W/phase/proposal.json" "$W/tampered.json"
$N -e 'const p=require(process.argv[1]);const f=Object.keys(p.files).sort();console.log(JSON.stringify(f));if(JSON.stringify(f)!==JSON.stringify(["externals/package-lock.json","externals/package.json"])){console.log("FILES MISMATCH");process.exit(3)}' "$W/tampered.json"
echo "check exit=$? (expect 3)"
echo "== same check on the real proposal"
$N -e 'const p=require(process.argv[1]);const f=Object.keys(p.files).sort();console.log(JSON.stringify(f));if(JSON.stringify(f)!==JSON.stringify(["externals/package-lock.json","externals/package.json"])){console.log("FILES MISMATCH");process.exit(3)}' "$W/phase/proposal.json"
echo "check exit=$? (expect 0)"
echo "== falsify bun.lock identity check: append one byte to a copy"
cp "$W/host/bun.lock" "$W/tampered.bun.lock"; printf x >> "$W/tampered.bun.lock"
cmp "$W/tampered.bun.lock" "$W/host/bun.lock"; echo "cmp exit=$? (expect 1)"
