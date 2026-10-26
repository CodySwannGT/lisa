/** Actual-wrapper regressions for the independently reproduced T7 findings. */
export function hostNameReviewCases({
  hostCwd,
  lisaCwd,
  body,
  cdStart,
  cdSearch,
  cdHost,
  fixtureName,
  lisa,
  host,
}) {
  const cases = [
    [
      "CDPATH inherited lookup cannot certify a host target",
      cdStart,
      `cd target && gh issue create --body ${fixtureName}`,
      2,
      { CDPATH: cdSearch },
    ],
    [
      "CDPATH export lookup cannot certify a host target",
      cdStart,
      `export CDPATH='${cdSearch}'; cd target && gh issue create --body ${fixtureName}`,
      2,
    ],
    [
      "CDPATH command assignment cannot certify a host target",
      cdStart,
      `CDPATH='${cdSearch}' cd target && gh issue create --body ${fixtureName}`,
      2,
    ],
    [
      "CDPATH standalone assignment cannot certify a host target",
      cdStart,
      `CDPATH='${cdSearch}'; cd target && gh issue create --body ${fixtureName}`,
      2,
    ],
    [
      "CDPATH relative body must not be read from the wrong directory",
      cdStart,
      `cd target && gh issue create --repo ${lisa} --body-file body.md`,
      2,
      { CDPATH: cdSearch },
      "BLOCKED: the working directory",
    ],
    [
      "uncertain CDPATH export cannot certify relative body location",
      cdStart,
      `export CDPATH="$SEARCH_PATH"; cd target && gh issue create --repo ${lisa} --body-file body.md`,
      2,
      { SEARCH_PATH: cdSearch },
      "BLOCKED: the working directory",
    ],
    [
      "dot relative cd bypasses CDPATH lookup",
      cdStart,
      `cd ./target && gh issue create --body ${fixtureName}`,
      0,
      { CDPATH: cdSearch },
    ],
    [
      "parent relative cd bypasses CDPATH lookup",
      cdHost,
      `cd ../target && gh issue create --body ${fixtureName}`,
      0,
      { CDPATH: cdSearch },
    ],
    [
      "absolute cd bypasses CDPATH lookup",
      cdStart,
      `cd '${cdHost}' && gh issue create --body ${fixtureName}`,
      0,
      { CDPATH: cdSearch },
    ],
    [
      "empty CDPATH preserves literal relative cd",
      cdStart,
      `cd target && gh issue create --body ${fixtureName}`,
      0,
    ],
    [
      "unquoted argv expansion cannot add an unseen winning repo",
      hostCwd,
      `gh issue comment 1 --repo ${host} $ROUTING --body ${fixtureName}`,
      2,
      { ROUTING: `--repo ${lisa}` },
    ],
    [
      "nonliteral consumed option value cannot earn target exemption",
      hostCwd,
      `gh issue create --repo ${host} --title "$TITLE" --body ${fixtureName}`,
      2,
      { TITLE: "Unresolved title" },
    ],
    [
      "literal numeric selector keeps explicit host target",
      lisaCwd,
      `gh issue comment 1 --repo ${host} --body ${fixtureName}`,
      0,
    ],
    [
      "standalone unexported repository assignment cannot certify a target",
      lisaCwd,
      `GH_REPO=${host}; gh issue create --body ${fixtureName}`,
      2,
    ],
    [
      "API input alone defaults to inspected POST",
      hostCwd,
      `gh api repos/${lisa}/issues --input '${body}'`,
      2,
    ],
    [
      "API input explicit POST remains inspected",
      hostCwd,
      `gh api repos/${lisa}/issues --method POST --input '${body}'`,
      2,
    ],
    [
      "API input explicit GET remains read only",
      hostCwd,
      `gh api repos/${lisa}/issues --method GET --input '${body}'`,
      0,
    ],
    [
      "API input to verified host remains allowed",
      lisaCwd,
      `gh api repos/${host}/issues --input '${body}'`,
      0,
    ],
    [
      "mixed host and Lisa issue URLs retain protection",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://github.com/${lisa}/issues/2 --body ${fixtureName}`,
      2,
    ],
    [
      "host URL and numeric selectors select the common host",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 2 --body ${fixtureName}`,
      0,
    ],
    [
      "same-host URL selectors select the common host",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://github.com/${host}/issues/2 --body ${fixtureName}`,
      0,
    ],
    [
      "host URL batch outranks conflicting Lisa repo flag",
      lisaCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://github.com/${host}/issues/2 --repo ${lisa} --body ${fixtureName}`,
      0,
    ],
    [
      "host URL with numeric selector outranks Lisa repo flag",
      lisaCwd,
      `gh issue edit https://github.com/${host}/issues/1 2 --repo ${lisa} --body ${fixtureName}`,
      0,
    ],
    [
      "numeric selector before host URL inherits the URL repository",
      lisaCwd,
      `gh issue edit 2 https://github.com/${host}/issues/1 --repo ${lisa} --body ${fixtureName}`,
      0,
    ],
    [
      "protected URL batch outranks conflicting host repo flag",
      hostCwd,
      `gh issue edit https://github.com/${lisa}/issues/1 https://github.com/${lisa}/issues/2 --repo ${host} --body ${fixtureName}`,
      2,
    ],
    [
      "protected URL with numeric selector outranks host repo flag",
      hostCwd,
      `gh issue edit https://github.com/${lisa}/issues/1 '#2' --repo ${host} --body ${fixtureName}`,
      2,
    ],
    [
      "numeric-only issue batch retains explicit host fallback",
      lisaCwd,
      `gh issue edit 1 2 --repo ${host} --body ${fixtureName}`,
      0,
    ],
    [
      "numeric-only issue batch retains protected fallback",
      hostCwd,
      `gh issue edit 1 2 --repo ${lisa} --body ${fixtureName}`,
      2,
    ],
    [
      "same owner and repository on different URL hosts stay unknown",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://other.example/${host}/issues/2 --body ${fixtureName}`,
      2,
    ],
    [
      "issue URL repository suffixes remain distinct batch identities",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://github.com/${host}.git/issues/2 --body ${fixtureName}`,
      2,
    ],
    [
      "invalid selector cannot inherit a host URL repository",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 not-an-issue --body ${fixtureName}`,
      2,
    ],
    [
      "nonliteral batch selector cannot inherit a host URL repository",
      hostCwd,
      `gh issue edit https://github.com/${host}/issues/1 $ISSUE_NUMBERS --body ${fixtureName}`,
      2,
      { ISSUE_NUMBERS: "2" },
    ],
    [
      "issue comment retains single-selector boundary",
      hostCwd,
      `gh issue comment https://github.com/${host}/issues/1 https://github.com/${host}/issues/2 --body ${fixtureName}`,
      2,
    ],
    [
      "PR edit retains single-selector boundary",
      hostCwd,
      `gh pr edit https://github.com/${host}/pull/1 https://github.com/${host}/pull/2 --body ${fixtureName}`,
      2,
    ],
    [
      "unanimous host URL batch compares repository case insensitively",
      lisaCwd,
      `gh issue edit https://github.com/${host}/issues/1 https://github.com/${host.toUpperCase()}/issues/2 --repo ${lisa} --body ${fixtureName}`,
      0,
    ],
  ];
  for (const noun of ["issue", "pr"])
    for (const verb of ["comment", "edit"]) {
      const kind = noun === "issue" ? "issues" : "pull";
      cases.push(
        [
          `${noun} ${verb} positional Lisa URL outranks host origin`,
          hostCwd,
          `gh ${noun} ${verb} https://github.com/${lisa}/${kind}/1 --body ${fixtureName}`,
          2,
        ],
        [
          `${noun} ${verb} positional Lisa URL outranks host repo flag`,
          hostCwd,
          `gh ${noun} ${verb} https://github.com/${lisa}/${kind}/1 --repo ${host} --body ${fixtureName}`,
          2,
        ],
        [
          `${noun} ${verb} positional host URL outranks Lisa repo flag`,
          lisaCwd,
          `gh ${noun} ${verb} https://github.com/${host}/${kind}/1 --repo ${lisa} --body ${fixtureName}`,
          0,
        ]
      );
    }
  return cases;
}
