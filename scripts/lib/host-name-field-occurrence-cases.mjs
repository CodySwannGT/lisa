/** Repeated typed API fields must not hide an earlier unresolved prose file. */
export function hostNameFieldOccurrenceCases({ lisaCwd, lisa, relative }) {
  const prefix = 'cd "$D" && gh',
    endpoint = `repos/${lisa}/issues`,
    clean = `${lisaCwd}/body.md`,
    refusal = "BLOCKED: the working directory";
  const unknown = (name, command) => [name, lisaCwd, command, 2, {}, refusal];
  return [
    unknown(
      "expanded repeated field retains earlier relative prose file",
      `${prefix} "$N" ${endpoint} --field body=@body.md --field title=clean`
    ),
    unknown(
      "literal API repeated field retains earlier relative prose file",
      `${prefix} api ${endpoint} --field body=@body.md --field title=clean`
    ),
    unknown(
      "literal API repeated F before absolute clean field retains relative file",
      `${prefix} api ${endpoint} -F body=@body.md -F title=@${clean}`
    ),
    unknown(
      "expanded repeated F union retains unresolved file control",
      `${prefix} "$N" ${endpoint} -F body=@body.md -F title=@${clean}`
    ),
    unknown(
      "expanded repeated field body-last control",
      `${prefix} "$N" ${endpoint} --field title=clean --field body=@body.md`
    ),
    [
      "literal API repeated fields known cwd reads original prose file",
      lisaCwd,
      `cd '${relative}' && gh api ${endpoint} --field body=@body.md --field title=clean`,
      2,
    ],
    [
      "literal API repeated fields GET remains read-only",
      lisaCwd,
      `${prefix} api ${endpoint} -X GET --field body=@body.md --field title=clean -q "$FILTER"`,
      0,
    ],
    [
      "nonadditive body-file last value remains authoritative",
      lisaCwd,
      `${prefix} issue create --repo ${lisa} --body-file missing.md --body-file ${clean}`,
      0,
    ],
    unknown(
      "expanded mixed field aliases retain earlier relative file control",
      `${prefix} "$N" ${endpoint} --field body=@body.md -F title=@${clean}`
    ),
    unknown(
      "expanded repeated equal field retains earlier relative file",
      `${prefix} "$N" ${endpoint} --field=body=@body.md --field=title=clean`
    ),
    unknown(
      "literal API repeated attached F retains earlier relative file",
      `${prefix} api ${endpoint} -Fbody=@body.md -Ftitle=@${clean}`
    ),
  ];
}
