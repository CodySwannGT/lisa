#!/bin/bash
# Re-verification of CodySwannGT/lisa#4741 checks (a)-(c) via the real CLI.
# Usage: run-cli.sh <worktree> <outdir>
set -u
WT="$1"; OUT="$2"
NODEBIN=/Users/codysai/.local/share/mise/installs/node/22.23.3/bin
CLI="$WT/all/copy-overwrite/scripts/lisa-npm-updater.mjs"
BASE=/tmp/v4741-verify/work
rm -rf "$BASE"; mkdir -p "$BASE/shim" "$OUT"
cat > "$BASE/shim/npm" <<EOF
#!/bin/bash
echo "npm \$*" >> "$BASE/npm-shim.log"
exec "$NODEBIN/npm" "\$@"
EOF
chmod +x "$BASE/shim/npm"
export PATH="$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin"
# git lives in /usr/bin or homebrew
command -v git >/dev/null || export PATH="$PATH:/opt/homebrew/bin"

mkhost() {
  local root="$1"; local cwd="$root/host"
  mkdir -p "$cwd/externals"
  for pair in "$cwd:fixture-root" "$cwd/externals:fixture-externals"; do
    d="${pair%%:*}"; n="${pair##*:}"
    printf '{"name":"%s","version":"1.0.0","private":true,"dependencies":{"is-number":"6.0.0"}}' "$n" > "$d/package.json"
    (cd "$d" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1)
  done
  printf '# root project lock, owned by the root project\n' > "$cwd/bun.lock"
  cat > "$cwd/.lisa.config.json" <<'EOF'
{"tracker":"github","github":{"org":"fixture","repo":"host"},"automationProvenance":{"enabled":true,"repository":"fixture/host"},"npmUpdater":[{"version":1,"repository":"fixture/host","target":"main","maintainer":"Fixture","lisaOwner":"absent","packages":[{"name":"is-number","version":"7.0.0"}],"directory":"."},{"version":1,"repository":"fixture/host","target":"main","maintainer":"Fixture","lisaOwner":"absent","packages":[{"name":"is-number","version":"7.0.0"}],"directory":"externals"}]}
EOF
  (cd "$cwd" && git init -q -b main && git add --all && git -c user.name=Fixture -c user.email=fixture@example.test commit -qm fixture)
}

runcase() {
  local name="$1" dir="$2" shim="$3" file="$4"
  local root="$BASE/$name"; mkhost "$root"; local cwd="$root/host"
  local log="$BASE/npm-shim.log"; : > "$log"
  {
    echo "HEAD under test: $(cd "$WT" && git rev-parse HEAD)"
    echo "\$ node -v => $(node -v); npm -v => $(npm -v)"
    local P="$PATH"; [ "$shim" = yes ] && P="$BASE/shim:$PATH"
    echo "\$ which npm => $(PATH="$P" command -v npm)"
    echo "\$ (cd $cwd && LISA_NPM_DIRECTORY='$dir' node $CLI prepare $cwd $root/phase)"
    (cd "$cwd" && PATH="$P" NPM_SHIM_LOG="$log" LISA_NPM_DIRECTORY="$dir" node "$CLI" prepare "$cwd" "$root/phase" 2>&1); echo "exit=$?"
    echo "phase dir exists: $([ -d "$root/phase" ] && echo yes || echo no)"
    [ "$shim" = yes ] && { echo "npm invocations logged by shim: $(wc -l < "$log" | tr -d ' ')"; sed 's/^/  /' "$log"; }
    if [ -f "$root/phase/proposal.json" ]; then
      echo "== proposal summary"
      node -e '
        const p=require(process.argv[1]);
        const f=Object.keys(p.files).sort();
        console.log(JSON.stringify({directory:p.directory,files:f,hasBunLockSha256:Object.hasOwn(p,"bunLockSha256"),updates:p.updates,
          externalsName:JSON.parse(p.files["externals/package.json"]).name,
          lockIsNumber:JSON.parse(p.files["externals/package-lock.json"]).packages["node_modules/is-number"].version},null,1));
        if (JSON.stringify(f)!==JSON.stringify(["externals/package-lock.json","externals/package.json"])) {console.log("FILES MISMATCH");process.exit(3)}
      ' "$root/phase/proposal.json"; echo "summary-check exit=$?"
      echo "== root bun.lock: working tree sha256 vs HEAD blob sha256"
      (cd "$cwd" && shasum -a 256 bun.lock && git show HEAD:bun.lock | shasum -a 256 && cmp bun.lock <(git show HEAD:bun.lock) && echo "bun.lock byte-identical: yes")
      echo "== git status --porcelain (empty = untouched)"
      (cd "$cwd" && git status --porcelain); echo "[end status]"
    fi
  } > "$OUT/$file" 2>&1
}

runcase a externals yes cli-a-externals-prepare.txt
runcase b missing yes cli-b-missing.txt
runcase c ../escape yes cli-c-escape.txt
echo done
