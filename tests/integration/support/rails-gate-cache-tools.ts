/** Recording command stand-ins for the Rails gate cache fixture. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLE = `#!/bin/sh
if [ "$1" = "-v" ]; then echo "Bundler version 2.6.0"; exit 0; fi
printf 'bundle %s workers=%s\\n' "$*" "\${LISA_ADMITTED_WORKERS:-none}" >> "$EVENT_LOG"
if [ -n "$STUB_FAIL" ]; then case " $* " in *" $STUB_FAIL "*) exit 1;; esac; fi
exit 0
`;

const NPM = `#!/bin/sh
case "$*" in
  'exec --yes --package=@ast-grep/cli@'*' -- ast-grep --version') printf 'ast-grep %s\\n' "\${3##*@}" ;;
  'exec --yes --package=@ast-grep/cli@'*' -- ast-grep scan') echo 'npm ast-grep scan' >> "$EVENT_LOG" ;;
  *) exit 91 ;;
esac
`;

/**
 * Place recording tools and the real Lisa entry point on the fixture's PATH.
 * @param bin - Executable directory in the fixture.
 * @param cli - Built Lisa CLI.
 */
export function writeRailsGateCacheTools(bin: string, cli: string): void {
  const tools = {
    bundle: BUNDLE,
    npm: NPM,
    ruby: "#!/bin/sh\necho 'ruby 3.4.0'\n",
    lisa: `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} "$@"\n`,
  };
  for (const [name, script] of Object.entries(tools))
    writeFileSync(join(bin, name), script, { mode: 0o755 });
}
