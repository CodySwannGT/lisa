#!/usr/bin/env python3
"""Classify the only heredoc forms whose payload is non-executable text.

SCOPE — read this before hardening anything here (issue #1993).

This module is a HEURISTIC RE-IMPLEMENTATION of bash's here-doc lexing, not an
adversary-resistant control. Every divergence between this Python model and real
bash is, by construction, a potential mis-classification, and five rounds of
fix-then-re-attack on issue #1958 plus three more here (#1993) established that
enumerating those divergences is an open-ended arms race. Treat the class as
CLOSED: a newly found member is documented, not chased, unless someone first
demonstrates it defeats the CONTENT GUARDS, which are the layer that matters.

The one hard guarantee, and the reason a mis-classification is survivable:

    Exit SAFE(0) is the ONLY path that strips payload text, and it requires the
    narrow, fully-quoted `gh issue|pr create/edit/comment` + `<<'EOF'` grammar in
    ``classify_safe``. EVERY other path — UNSUPPORTED(10) and MALFORMED(20) —
    hands the RAW, unmodified command to the content guards. So a here-doc the
    classifier mis-reads degrades to the guards; it does not bypass them. Any
    change here must preserve that property: widen ``classify_safe`` only with
    proof, and keep every other exit raw-pass-through.

Known accepted bypass class (measured, deliberately not chased further):
R5a — a trailing backslash on the last body line is a bash continuation that
swallows the terminator; R5b — an odd apostrophe in an unquoted body poisons a
flat quote scanner past the terminator; R5c — `<<\\DELIM` is a quoted delimiter
this parser did not model. All three are FIXED below, but they are members of a
family, not the family itself. Each requires deliberately-crafted input; none is
a shape an agent emits by accident; and post-#1982 every destructive class the
safety net exists to stop is independently blocked by the content guards on the
raw text.

The two bash invariants this file relies on — both measured directly against
/bin/bash, not inferred — so a future round starts from a spec:

1. UNQUOTED delimiter (`<<EOF`): the body performs NO quote or comment
   processing (`'`, `"`, `#` are literal data bytes) but STILL expands `$(...)`,
   backticks and parameters, and bash removes `\\<newline>` continuations BEFORE
   matching the delimiter. Measured: `cat <<EOF` / `foo\\` / `EOF` / `bar` emits
   `fooEOF\\nbar` — the here-doc never terminated.
2. QUOTED delimiter in any spelling (`<<'EOF'`, `<<"EOF"`, `<<\\EOF`): the body is
   fully literal, no expansion of any kind, and backslash is DATA rather than an
   escape — so the delimiter IS matched per physical line there. Measured: the
   same trailing-backslash shape under `<<'EOF'` emits `foo\\` and then fails on
   `bar: command not found`.

That asymmetry is why the continuation handling in ``terminator_line_index`` is
conditioned on ``Marker.quoted`` rather than applied uniformly.

``Marker.quoted`` means "bash makes this BODY literal" and nothing more. The
three spellings above are interchangeable for body semantics ONLY — they are NOT
interchangeable on the writer path. ``classify_safe`` still demands the literal
``<<'DELIM'`` spelling, so `<<"EOF"` and `<<\\EOF` can never reach SAFE(0); since
#1993 they additionally record a Marker, which arms the writer-owns-a-real-marker
and multi-marker rules and lands a `gh … <<\\EOF` writer on MALFORMED(20) where it
used to be UNSUPPORTED(10). That is a deliberate, test-pinned over-block: the
documented payload-strip workaround is spelled `<<'EOF'`. Widening
``classify_safe`` to admit other spellings is a separate change needing its own
proof — do not do it as a side effect of body-semantics work.
"""

from __future__ import annotations

import re
import shlex
import sys
from dataclasses import dataclass

SAFE = 0
UNSUPPORTED = 10
MALFORMED = 20

DELIMITER = r"(?P<delimiter>[A-Za-z_][A-Za-z0-9_]*)"
BODY_CAT_MARKER = re.compile(
    r"(?P<prefix>.*(?:^|\s)--body\s+)\"\$\(cat\s+<<'"
    + DELIMITER
    + r"'\s*$"
)
ALLOWED_GROUPS = {"issue", "pr"}
ALLOWED_ACTIONS = {"create", "edit", "comment"}


@dataclass(frozen=True)
class Marker:
    start: int
    end: int
    delimiter: str
    strip_tabs: bool
    # True ONLY when the whole delimiter token was wrapped in one full single-
    # or double-quote pair (<<'EOF' / <<"EOF") with nothing word-like attached
    # after the closing quote. That is the only form whose body this parser can
    # PROVE bash treats as non-expanding literal data (issue #1958).
    quoted: bool


def is_bash_blank(char: str) -> bool:
    """True only for a byte bash treats as a word separator here: space, tab,
    newline.

    Python ``str.isspace()`` is a strict SUPERSET of bash's word-separator set —
    it is also True for NBSP (``\\xa0``), the C0 separators FS/GS/RS/US
    (``\\x1c``–``\\x1f``), NEL (``\\x85``), VT/FF (``\\x0b``/``\\x0c``), CR
    (``\\r``), and the Unicode spaces (ideographic space ``\\u3000``, the
    ``\\u2000``–``\\u200a`` run, ``\\u202f``, ``\\u205f``, ``\\u2028``/``\\u2029``).
    Bash (C locale) treats NONE of these as a blank or a metacharacter, so a
    ``#`` preceded by one stays INSIDE the current word — it does NOT start a
    comment — and any ``$(...)`` / `` `...` `` in that word is still expanded and
    EXECUTED. Every comment-boundary walker here must therefore match bash's
    actual blank set, not Python's: using ``str.isspace()`` let the scanner call
    ``#`` a comment where bash does not, skip to the newline, and go blind to a
    live substitution — smuggling arbitrary command execution past the wall
    (issue #1958 Finding R2). This is the single shared home of that predicate so
    every walker stays in lockstep with bash's word-boundary rule; fail-closed on
    ambiguity means narrowing (fewer bytes counted as blank), never widening.
    """
    return char in " \t\n"


def bash_lines(text: str) -> list[str]:
    """Split into bash's notion of lines: on ``\\n`` ONLY.

    Python ``str.splitlines()`` is the same over-broad classifier as
    ``str.isspace()`` in disguise — it ALSO breaks on ``\\r``, VT/FF
    (``\\x0b``/``\\x0c``), the C0 separators FS/GS/RS (``\\x1c``–``\\x1e``), NEL
    (``\\x85``), and the Unicode line separators (``\\u2028``/``\\u2029``). Bash
    ends a line only at an unquoted ``\\n``, so ``splitlines()`` invents line
    breaks bash never sees. The concrete hole: ``strip_provably_literal_body``
    splits with ``splitlines()`` then rejoins with ``\\n``, so a ``echo X\\x1c#$(…)``
    argument gets normalised into ``echo X`` / ``#$(…)`` on separate lines — now
    the ``#`` sits at a real line start, is treated as a comment, and the live
    ``$(…)`` is smuggled past the wall exactly as the ``str.isspace()`` desync
    did (issue #1958 Finding R2, FS/ideographic-space variant). Splitting on
    ``\\n`` alone keeps this parser's lines in lockstep with bash and with the
    ``command.count("\\n", …)`` offset arithmetic the markers already rely on.
    """
    return text.split("\n")


def ansi_c_quote_end(text: str, dollar_index: int) -> int | None:
    """Index one past a bash ANSI-C ``$'...'`` token, or ``None``.

    When an *unquoted* ``$`` is immediately followed by ``'`` bash opens an
    ANSI-C-quoted string that ends at the first *unescaped* ``'``: a backslash
    escapes the next single character, so ``\\'`` is a literal quote (does NOT
    close the string) and ``\\\\`` is a literal backslash. Only literal
    single quotes act as delimiters — value-only escapes like ``\\x27`` /
    ``\\047`` / ``\\uHHHH`` decode to a quote *character* but never terminate
    the token, so scanning for the first unescaped ``'`` yields exactly bash's
    token boundary for every spelling.

    A naive single-quote scanner that ignores ``$'...'`` desyncs from bash on an
    odd number of ``\\'`` escapes: it reads three bare quotes as
    single→plain→single and ends in a phantom open single-quote, going blind to
    everything after it — including a live ``$(...)`` the following ``"`` really
    exposes (issue #1958 Finding R1). Consuming the whole inert token here keeps
    every shared walker in lockstep with bash.

    Returns the index just past the closing quote, or ``None`` for a
    non-``$'`` position or an unterminated token so callers fail closed. This is
    the single shared home of ANSI-C token boundaries; every quote-state walker
    consults it rather than re-deriving the rule.
    """
    if not text.startswith("$'", dollar_index):
        return None
    index = dollar_index + 2
    length = len(text)
    while index < length:
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "'":
            return index + 1
        index += 1
    return None


def shell_tokens(prefix: str) -> list[str] | None:
    """Return literal simple-command tokens, rejecting executable shell syntax."""
    state = "plain"
    escaped = False
    index = 0
    while index < len(prefix):
        char = prefix[index]
        if escaped:
            escaped = False
        elif state == "single":
            if char == "'":
                state = "plain"
        elif state == "double":
            if char == '"':
                state = "plain"
            elif char == "\\":
                escaped = True
            elif char == "`" or (
                char == "$"
                and index + 1 < len(prefix)
                and prefix[index + 1] in "([{"):
                return None
        elif prefix.startswith("$'", index):
            end = ansi_c_quote_end(prefix, index)
            if end is None:
                return None
            index = end
            continue
        elif char == "'":
            state = "single"
        elif char == '"':
            state = "double"
        elif char == "\\":
            escaped = True
        elif char == "#" and (index == 0 or is_bash_blank(prefix[index - 1])):
            return None
        elif char in ";|&()<>`\n\r":
            return None
        elif char == "$" and index + 1 < len(prefix) and prefix[index + 1] in "([{":
            return None
        index += 1

    if state != "plain" or escaped:
        return None
    try:
        return shlex.split(prefix, comments=False, posix=True)
    except ValueError:
        return None


def is_allowed_gh(tokens: list[str]) -> bool:
    return (
        len(tokens) >= 3
        and tokens[0] == "gh"
        and tokens[1] in ALLOWED_GROUPS
        and tokens[2] in ALLOWED_ACTIONS
    )


def line_has_allowed_writer(line: str) -> bool:
    """Find a writer after shell quote-concatenation and control operators."""
    try:
        lexer = shlex.shlex(line, posix=True, punctuation_chars=";&|()")
        lexer.whitespace_split = True
        lexer.commenters = "#"
        tokens = list(lexer)
    except ValueError:
        return False
    return any(
        is_allowed_gh(tokens[index : index + 3])
        for index in range(max(0, len(tokens) - 2))
    )


def has_body_file_stdin(tokens: list[str]) -> bool:
    return "--body-file=-" in tokens or any(
        tokens[index : index + 2] == ["--body-file", "-"]
        for index in range(len(tokens) - 1)
    )


def exact_terminator(lines: list[str], delimiter: str, start: int) -> int | None:
    for index in range(start, len(lines)):
        if lines[index] == delimiter:
            return index
    return None


def only_whitespace(lines: list[str], start: int) -> bool:
    return all(not line.strip() for line in lines[start:])


def classify_safe(command: str) -> str | None:
    lines = bash_lines(command)
    if len(lines) < 2 or "\x00" in command or "\r" in command:
        return None

    header = lines[0]
    body_cat = BODY_CAT_MARKER.search(header)
    if body_cat is not None:
        tokens = shell_tokens(body_cat.group("prefix"))
        if tokens is None or not is_allowed_gh(tokens):
            return None
        terminator = exact_terminator(lines, body_cat.group("delimiter"), 1)
        if terminator is None:
            raise ValueError("unclosed body cat heredoc")
        if terminator + 1 >= len(lines) or lines[terminator + 1].strip() != ')"':
            raise ValueError("body cat substitution is not closed exactly")
        if not only_whitespace(lines, terminator + 2):
            raise ValueError("command follows body cat heredoc")
        return body_cat.group("prefix") + '"<heredoc-text>"'

    header_markers = top_level_markers(header)
    if len(header_markers) != 1:
        return None
    direct = header_markers[0]
    raw_marker = header[direct.start : direct.end]
    if raw_marker != f"<<'{direct.delimiter}'" or header[direct.end :].strip():
        return None
    prefix = header[: direct.start]
    tokens = shell_tokens(prefix)
    if tokens is None or not is_allowed_gh(tokens) or not has_body_file_stdin(tokens):
        return None
    terminator = exact_terminator(lines, direct.delimiter, 1)
    if terminator is None:
        raise ValueError("unclosed direct heredoc")
    if not only_whitespace(lines, terminator + 1):
        raise ValueError("command follows direct heredoc")
    return prefix.rstrip()


def top_level_markers(command: str) -> list[Marker]:
    """Find conservative top-level markers for malformed/duplicate detection."""
    markers: list[Marker] = []
    lines = bash_lines(command)
    offset = 0
    for line in lines:
        state = "plain"
        escaped = False
        index = 0
        while index < len(line):
            char = line[index]
            if escaped:
                escaped = False
            elif state == "single":
                if char == "'":
                    state = "plain"
            elif state == "double":
                if char == '"':
                    state = "plain"
                elif char == "\\":
                    escaped = True
            elif line.startswith("$'", index):
                end = ansi_c_quote_end(line, index)
                if end is None:
                    break
                index = end
                continue
            elif char == "'":
                state = "single"
            elif char == '"':
                state = "double"
            elif char == "\\":
                escaped = True
            elif char == "#" and (index == 0 or is_bash_blank(line[index - 1])):
                break
            elif line.startswith("<<", index) and not line.startswith("<<<", index):
                marker = parse_marker(line, index, offset)
                if marker is not None:
                    markers.append(marker)
                    index = marker.end - offset - 1
            index += 1
        offset += len(line) + 1
    return markers


def unquoted_code_and_comment(line: str) -> tuple[str, str]:
    """Return executable text and any shell comment, hiding quoted prose."""
    code: list[str] = []
    state = "plain"
    escaped = False
    index = 0
    while index < len(line):
        char = line[index]
        if escaped:
            code.append(" ")
            escaped = False
        elif state == "single":
            code.append(" ")
            if char == "'":
                state = "plain"
        elif state == "double":
            code.append(" ")
            if char == '"':
                state = "plain"
            elif char == "\\":
                escaped = True
        elif line.startswith("$'", index):
            end = ansi_c_quote_end(line, index)
            if end is None:
                code.append(" ")
                index += 1
                continue
            code.append(" " * (end - index))
            index = end
            continue
        elif char == "'":
            code.append(" ")
            state = "single"
        elif char == '"':
            code.append(" ")
            state = "double"
        elif char == "\\":
            code.append(" ")
            escaped = True
        elif char == "#" and (index == 0 or is_bash_blank(line[index - 1])):
            return "".join(code), line[index + 1 :]
        else:
            code.append(char)
        index += 1
    return "".join(code), ""


def collapse_line_continuations(command: str) -> str:
    """Remove Bash backslash-newline pairs outside single-quoted text."""
    result: list[str] = []
    state = "plain"
    escaped = False
    index = 0
    while index < len(command):
        char = command[index]
        if escaped:
            result.append(char)
            escaped = False
        elif state == "single":
            result.append(char)
            if char == "'":
                state = "plain"
        elif char == "\\" and command.startswith("\n", index + 1):
            index += 2
            continue
        elif char == "\\":
            result.append(char)
            escaped = True
        elif state == "plain" and command.startswith("$'", index):
            end = ansi_c_quote_end(command, index)
            if end is None:
                result.append(char)
            else:
                # Preserve the whole inert ANSI-C token verbatim so its bytes
                # stay a single quoted unit to every downstream walker; a
                # backslash-newline inside it is part of the token, not a line
                # continuation to strip.
                result.append(command[index:end])
                index = end
                continue
        elif char == "'" and state == "plain":
            result.append(char)
            state = "single"
        elif char == '"':
            result.append(char)
            state = "plain" if state == "double" else "double"
        else:
            result.append(char)
        index += 1
    return "".join(result)


def writer_owns_real_marker(command: str, markers: list[Marker]) -> bool:
    """Detect a supported writer on a line containing a real heredoc marker."""
    logical_command = collapse_line_continuations(command)
    logical_markers = (
        markers if logical_command == command else top_level_markers(logical_command)
    )
    lines = bash_lines(logical_command)
    for marker in logical_markers:
        line_index = logical_command.count("\n", 0, marker.start)
        if line_has_allowed_writer(lines[line_index]):
            return True
    return False


def writer_has_commented_marker_and_following_code(command: str) -> bool:
    """Reject fake writer markers whose following lines would execute."""
    lines = bash_lines(command)
    for index, line in enumerate(lines):
        _code, comment = unquoted_code_and_comment(line)
        if (
            line_has_allowed_writer(line)
            and "<<" in comment
            and any(candidate.strip() for candidate in lines[index + 1 :])
        ):
            return True
    return False


def has_active_command_substitution(command: str) -> bool:
    """Detect substitutions outside single-quoted text and shell comments."""
    state = "plain"
    escaped = False
    index = 0
    while index < len(command):
        char = command[index]
        if escaped:
            escaped = False
        elif state == "single":
            if char == "'":
                state = "plain"
        elif state == "double":
            if char == '"':
                state = "plain"
            elif char == "\\":
                escaped = True
            elif char == "`" or command.startswith("$(", index):
                return True
        elif command.startswith("$'", index):
            end = ansi_c_quote_end(command, index)
            if end is None:
                return True
            index = end
            continue
        elif char == "'":
            state = "single"
        elif char == '"':
            state = "double"
        elif char == "\\":
            escaped = True
        elif char == "#" and (
            index == 0 or is_bash_blank(command[index - 1])
        ):
            newline = command.find("\n", index)
            if newline < 0:
                return False
            index = newline
        elif char == "`" or command.startswith("$(", index):
            return True
        index += 1
    return False


def collapse_body_continuations(body: str) -> str:
    """Remove bash ``\\<newline>`` line continuations under heredoc-body rules.

    An UNQUOTED here-doc body performs NO quote processing (``'``/``"``/``#`` are
    literal bytes), but bash STILL removes an unescaped ``\\<newline>`` — the
    bash manual: for an unquoted here-doc "the character sequence ``\\newline`` is
    ignored". The whole-command ``collapse_line_continuations`` applies a FLAT
    shell quote state, so a single body apostrophe flips it into a phantom
    single-quoted string and it REFUSES to join a ``$\\<newline>(`` continuation,
    leaving ``$`` and ``(`` on separate lines where the per-line substitution
    scan sees neither — smuggling a live ``$(...)`` past the wall (issue #1958
    Finding R4). The body window has no quote state to get wrong, so this joins
    continuations with backslash-only semantics: a backslash escapes the next
    single byte (so ``\\\\`` is a literal backslash whose following newline is
    real, and ``\\$`` cannot start a substitution), and a backslash directly
    before a newline is dropped together with that newline. Feed the joined body
    to ``body_line_has_substitution`` so a split ``$(`` is scanned as the one
    contiguous token bash will execute. Fail-closed: a trailing lone backslash is
    kept verbatim (it can start no substitution).
    """
    result: list[str] = []
    index = 0
    length = len(body)
    while index < length:
        char = body[index]
        if char == "\\":
            if index + 1 < length and body[index + 1] == "\n":
                index += 2
                continue
            result.append(body[index : index + 2])
            index += 2
            continue
        result.append(char)
        index += 1
    return "".join(result)


def trailing_continuation(line: str) -> str | None:
    """Strip a bash ``\\<newline>`` continuation backslash, or ``None``.

    A here-doc body line ends in a continuation exactly when it ends in an ODD
    run of backslashes: each pair is one escaped literal backslash, so a leftover
    single backslash is the one that escapes the following newline. Parity of the
    TRAILING run is sufficient — any backslash earlier in the line is separated
    from the run by a non-backslash byte, which ends that escape.
    """
    stripped = line.rstrip("\\")
    if (len(line) - len(stripped)) % 2 == 0:
        return None
    return line[:-1]


def terminator_line_index(command: str, marker: Marker) -> int | None:
    """Index of the physical line that closes ``marker``, or ``None``.

    THE single home of "where does this here-doc body end", consulted by the
    closure check, the body scanner, the literal-body strip and the body
    neutraliser so no two of them can ever disagree about the window (issue
    #1993 R5a).

    Bash removes ``\\<newline>`` continuations from an UNQUOTED here-doc body
    BEFORE it matches the delimiter, so a trailing backslash on the last body
    line JOINS that line to the delimiter line and the here-doc is NOT closed
    there — the real body swallows the apparent terminator and keeps consuming
    following lines, where a ``$(...)`` the classifier believed was ordinary
    post-here-doc text is expanded and EXECUTED. Matching the delimiter per
    PHYSICAL line therefore under-reads the body window for unquoted delimiters.
    Measured ground truth: ``cat <<EOF`` / ``foo\\`` / ``EOF`` / ``bar`` prints
    ``fooEOF\\nbar`` (never terminated), while the same shape with ``<<'EOF'``
    prints ``foo\\`` and then fails on ``bar: command not found``.

    A QUOTED (or backslash-quoted) delimiter makes the body fully literal —
    backslash is DATA there, not an escape — so those markers keep the exact
    per-physical-line match, which the same measurement proves correct.
    """
    lines = bash_lines(command)
    marker_line = command.count("\n", 0, marker.start)
    pending: list[str] = []
    for index in range(marker_line + 1, len(lines)):
        line = lines[index]
        if not marker.quoted:
            continued = trailing_continuation(line)
            if continued is not None:
                pending.append(continued)
                continue
        candidate = "".join(pending) + line
        pending = []
        if marker.strip_tabs:
            candidate = candidate.lstrip("\t")
        if candidate == marker.delimiter:
            return index
    return None


def neutralize_heredoc_bodies(command: str, markers: list[Marker]) -> str:
    """Blank every real here-doc body window, preserving offsets.

    ``has_active_command_substitution`` runs ONE flat single/double-quote state
    machine across the whole command — including here-doc bodies, where bash
    applies NO quote processing at all. An odd apostrophe in an unquoted body
    (``it's fine``) therefore opens a phantom single-quoted string in the flat
    scanner that persists PAST the terminator, hiding a live ``$(...)`` on a
    FOLLOWING command line that bash happily executes (issue #1993 R5b). The
    trigger is precisely an odd ``'`` count: an even ``''``, an odd ``"``, a
    ``#``, an ANSI-C ``$'a`` and a lone trailing backslash all leave the flat
    state correct, which is what pins the defect to this one branch.

    ``strip_provably_literal_body`` cannot fix this: it bails whenever the marker
    is unquoted, so the poisoning body is exactly the one it never touches. So
    blank the body window of EVERY marker bash really treats as a here-doc
    redirection before the flat scan runs. Bytes are replaced with spaces and
    newlines are preserved, so marker offsets and line numbering stay valid for
    every later walker.

    Blanking loses nothing: a substitution INSIDE an unquoted body is still
    caught by ``unquoted_heredoc_body_has_substitution`` (scanned with correct
    here-doc-body semantics), and a quoted body is genuinely inert to bash. A
    marker that is not closed blanks to end of command — that command is
    MALFORMED on the closure check regardless, and its trailing region is still
    body-scanned. As everywhere else, a marker nested inside an open quoted
    string is NOT a here-doc to bash and is skipped, so its "body" stays fully
    visible to the flat scan (issue #1958 Finding 1).
    """
    lines = bash_lines(command)
    blanked = list(lines)
    for marker in markers:
        if cross_line_quote_state(command, marker.start) != "plain":
            continue
        marker_line = command.count("\n", 0, marker.start)
        end = terminator_line_index(command, marker)
        stop = len(lines) if end is None else end
        for index in range(marker_line + 1, stop):
            blanked[index] = " " * len(lines[index])
    return "\n".join(blanked)


def body_line_has_substitution(line: str) -> bool:
    """True if an unquoted-heredoc-body line contains an active substitution.

    In an unquoted-delimiter heredoc body bash suppresses ALL quote and comment
    processing — ``'``, ``"`` and ``#`` are literal bytes — but keeps
    parameter/command/arithmetic expansion active, so ``$(...)`` and `` `...` ``
    still EXECUTE. The only in-body metacharacter is the backslash, which escapes
    the following ``$``, `` ` ``, ``\\`` or newline; every other byte (including
    the quotes and ``#`` that blind the flat scanner) is inert text. So scan the
    body raw, honouring only that escaping, and flag a bare ``$(`` or backtick —
    the same command-substitution tokens ``has_active_command_substitution``
    detects elsewhere, just without the quote/comment state machine that is wrong
    for this region (issue #1958 Finding R3).
    """
    index = 0
    length = len(line)
    while index < length:
        char = line[index]
        if char == "\\":
            index += 2
            continue
        if char == "`" or line.startswith("$(", index):
            return True
        index += 1
    return False


def unquoted_heredoc_body_has_substitution(
    command: str, markers: list[Marker]
) -> bool:
    """Detect a live substitution inside an unquoted top-level heredoc body.

    ``has_active_command_substitution`` applies flat shell quote/comment
    semantics to the whole command, but an UNQUOTED ``<<EOF`` body follows
    different rules (see ``body_line_has_substitution``): a lone apostrophe or
    ``#`` in the body flips the flat scanner's state and hides a live
    ``$(...)``/backtick that bash nonetheless expands, smuggling execution past
    the wall (issue #1958 Finding R3). This complements the flat scan by walking
    only the body window of each unquoted, top-level, closed heredoc with
    heredoc-body semantics.

    A quoted-delimiter body (``Marker.quoted``) is genuinely inert to bash and is
    skipped — that is the whole point of the Finding-1 literal-payload win.
    Before scanning, the marker is re-verified to sit at bash top level under
    CROSS-LINE quote tracking (mirroring ``strip_provably_literal_body``): a
    heredoc-shaped ``<<EOF`` nested inside an open single-quoted string is not a
    real heredoc — its body is literal string data bash never expands — so
    scanning it would over-block ordinary quoted prose; and one nested inside an
    open double-quoted string has its ``$(...)`` already caught by the flat scan.
    Either way, only markers bash actually treats as top-level heredoc
    redirections get the body scan.
    """
    lines = bash_lines(command)
    for marker in markers:
        if marker.quoted:
            continue
        if cross_line_quote_state(command, marker.start) != "plain":
            continue
        marker_line = command.count("\n", 0, marker.start)
        end = terminator_line_index(command, marker)
        stop = len(lines) if end is None else end
        body_lines = lines[marker_line + 1 : stop]
        # Join the raw body window under bash's unquoted-here-doc ``\<newline>``
        # removal BEFORE scanning, so a ``$(`` a caller split across a line
        # continuation is seen as the one contiguous token bash executes. The
        # window itself comes from ``terminator_line_index``, which applies that
        # SAME removal before matching the delimiter — because bash does (issue
        # #1993 R5a). An earlier revision matched the terminator per physical
        # line here on the belief that bash matches the delimiter before
        # continuation processing; that is false for an unquoted delimiter, and
        # it let a trailing backslash on the last body line swallow the
        # terminator so this scan stopped short of the region bash still treats
        # as body. This does not rely on ``collapse_line_continuations`` — whose
        # flat quote state a body apostrophe corrupts — which is the whole point
        # of Finding R4.
        body = collapse_body_continuations("\n".join(body_lines))
        if body_line_has_substitution(body):
            return True
    return False


def parse_marker(line: str, start: int, offset: int) -> Marker | None:
    index = start + 2
    strip_tabs = False
    if index < len(line) and line[index] == "-":
        strip_tabs = True
        index += 1
    while index < len(line) and line[index] in " \t":
        index += 1
    if index >= len(line):
        return None
    quote = line[index] if line[index] in "'\"" else None
    quoted = False
    if quote:
        index += 1
        end = line.find(quote, index)
        if end < 0:
            return None
        delimiter = line[index:end]
        final = end + 1
        # Deliberate POSIX divergence, fail-safe: POSIX makes the body
        # non-expanding when ANY part of the delimiter is quoted. Partial forms
        # like `<<EO'F'` stay unmodelled (mis-tokenized as delimiter EO, so the
        # terminator never matches and the command fails closed as MALFORMED).
        # Only a delimiter this parser can PROVE was one full quote pair earns
        # quoted=True, and trailing word characters after the closing quote
        # (`<<'EOF'X` — real bash delimiter EOFX) keep it conservative too: the
        # next character must end the token.
        quoted = final >= len(line) or line[final] in " \t;&|)<>#"
    elif line[index] == "\\":
        # `<<\DELIM` is a BACKSLASH-quoted delimiter: bash and POSIX make its
        # body fully literal, exactly like `<<'DELIM'` (measured: `cat <<\EOF`
        # with body `it's $(echo RAN)` prints that text verbatim, unexpanded).
        # This spelling used to record NO Marker at all, on the rationale that an
        # unmodelled body stays raw-visible to every content guard. That covers
        # the body's own contents but NOT the body's ability to corrupt the flat
        # scanner's quote state for text AFTER the terminator: an apostrophe in
        # an invisible body still opened a phantom string that hid a live
        # `$(...)` on a following line (issue #1993 R5c). Recording it as the
        # quoted marker bash actually treats it as is both more faithful and
        # what brings it under `neutralize_heredoc_bodies`. The same
        # token-must-end discipline as the quote-pair branch applies, so exotic
        # spellings (`<<\EOF'x'` — real bash delimiter EOFx) stay conservative.
        # quoted=True here is a statement about BODY semantics only. Recording a
        # Marker where there was none also arms the writer-owns-a-real-marker and
        # multi-marker rules, so `gh issue create --body-file - <<\EOF` and
        # `cat <<\A <<B` now fail closed at MALFORMED instead of passing through
        # at UNSUPPORTED. Both are valid, harmless bash, so that is a real
        # over-block — accepted and test-pinned, because `classify_safe` requires
        # the literal `<<'DELIM'` spelling and `<<\EOF` can never reach SAFE
        # anyway. The documented payload-strip workaround is `<<'EOF'`.
        index += 1
        match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", line[index:])
        if match is None:
            return None
        delimiter = match.group(0)
        final = index + len(delimiter)
        quoted = final >= len(line) or line[final] in " \t;&|)<>#"
    else:
        match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", line[index:])
        if match is None:
            return None
        delimiter = match.group(0)
        final = index + len(delimiter)
    if not delimiter:
        return None
    return Marker(offset + start, offset + final, delimiter, strip_tabs, quoted)


def cross_line_quote_state(command: str, offset: int) -> str:
    """Return the single/double/plain quote state bash sees at ``offset``.

    Unlike ``top_level_markers`` (which re-initialises quote state at the start
    of every line), this walks the whole command with a SINGLE cross-line state
    machine — the same quote/escape/comment model ``has_active_command_substitution``
    uses. It answers "is this position inside an open single- or double-quoted
    string?" so a heredoc-shaped token can be checked against bash's real parse.
    """
    state = "plain"
    escaped = False
    index = 0
    limit = min(offset, len(command))
    while index < limit:
        char = command[index]
        if escaped:
            escaped = False
        elif state == "single":
            if char == "'":
                state = "plain"
        elif state == "double":
            if char == '"':
                state = "plain"
            elif char == "\\":
                escaped = True
        elif command.startswith("$'", index):
            end = ansi_c_quote_end(command, index)
            if end is None or end > limit:
                # The offset sits inside (or an unterminated) ANSI-C token: bash
                # is not at plain top level there, so any heredoc-shaped marker
                # is inert. Report a non-plain state so the strip gate refuses.
                return "single"
            index = end
            continue
        elif char == "'":
            state = "single"
        elif char == '"':
            state = "double"
        elif char == "\\":
            escaped = True
        elif char == "#" and (index == 0 or is_bash_blank(command[index - 1])):
            newline = command.find("\n", index)
            if newline < 0 or newline >= limit:
                return state
            index = newline
            continue
        index += 1
    return state


def strip_provably_literal_body(command: str, markers: list[Marker]) -> str:
    """Drop the body window of a single fully-quoted, closed heredoc.

    A fully-quoted delimiter (Marker.quoted) makes the body literal data to
    bash, so substitution tokens inside it must not flip the classification to
    MALFORMED (issue #1958). The exclusion is deliberately narrow: EXACTLY one
    marker, provably quoted, provably closed, and — critically — a marker bash
    actually treats as a top-level heredoc redirection. ``top_level_markers``
    resets quote state per line, so a ``<<'DELIM'`` line nested inside an open
    multi-line single/double-quoted string is mis-recorded as a top-level
    quoted heredoc. To bash there is NO heredoc there — the whole thing is one
    string, and a ``$(...)`` inside a double-quoted string is EXECUTED. Excluding
    that fake "body" window would delete the live substitution before the scan
    runs, smuggling arbitrary command execution past the wall (issue #1958
    Finding 1). So before excluding, re-verify the marker sits at bash top level
    (quote state ``plain``) under CROSS-LINE quote tracking; if it is inside an
    open quote, strip nothing and let ``has_active_command_substitution`` see the
    real substitution. Anything else returns the command unchanged so the scan
    stays fail-closed. Only the body lines are removed; the header line,
    terminator line, and everything after remain, so a substitution on the
    command line proper is still detected. The raw payload itself still reaches
    every content guard because this classifier returns UNSUPPORTED (raw
    pass-through) for the target class, never SAFE.
    """
    if len(markers) != 1 or not markers[0].quoted:
        return command
    marker = markers[0]
    if cross_line_quote_state(command, marker.start) != "plain":
        return command
    lines = bash_lines(command)
    marker_line = command.count("\n", 0, marker.start)
    end = terminator_line_index(command, marker)
    if end is None:
        return command
    return "\n".join(lines[: marker_line + 1] + lines[end:])


def marker_is_closed(command: str, marker: Marker) -> bool:
    """True when bash really terminates this here-doc inside the command.

    Delegates to ``terminator_line_index`` so the closure verdict and the body
    window are decided by one rule. For an unquoted delimiter that rule removes
    ``\\<newline>`` continuations first, so a trailing backslash on the last body
    line correctly reads as NOT closed — which is what bash does, and what makes
    the swallowed-terminator shape fail closed as MALFORMED (issue #1993 R5a).
    """
    return terminator_line_index(command, marker) is not None


def main() -> int:
    command = sys.stdin.read()
    if "<<" not in command:
        print(command, end="")
        return SAFE
    try:
        sanitized = classify_safe(command)
    except ValueError:
        return MALFORMED
    if sanitized is not None:
        print(sanitized, end="")
        return SAFE

    logical_command = collapse_line_continuations(command)
    markers = top_level_markers(logical_command)
    if writer_has_commented_marker_and_following_code(logical_command):
        return MALFORMED
    if writer_owns_real_marker(logical_command, markers):
        return MALFORMED
    # Textual operators inside quotes or comments are not heredocs. Leave the
    # raw command unchanged so ordinary guard matching proceeds normally.
    if not markers and not has_active_command_substitution(logical_command):
        return UNSUPPORTED

    # A supported writer that failed the exact safe grammar is ambiguous: do
    # not let chaining, alternate redirects, or an expanding delimiter turn a
    # would-be payload exemption into a bypass.
    if bash_lines(logical_command) and line_has_allowed_writer(
        bash_lines(logical_command)[0]
    ):
        return MALFORMED

    # Nested substitution plus a heredoc is executable shell syntax unless it
    # matched the one exact quoted `--body "$(cat ...)"` form above. Here-doc
    # bodies are neutralised before the flat scan: bash applies NO quote
    # processing inside a body, so leaving those bytes in a flat quote state
    # machine let an odd body apostrophe poison the scanner PAST the terminator
    # and hide a live substitution on a following command line (issue #1993
    # R5b). Neutralising preserves offsets, so the narrower literal-body strip
    # still applies on top; the text outside every body window is still scanned,
    # and in-body substitutions are covered by the body-semantics scan below.
    if has_active_command_substitution(
        strip_provably_literal_body(
            neutralize_heredoc_bodies(logical_command, markers), markers
        )
    ) or unquoted_heredoc_body_has_substitution(logical_command, markers):
        return MALFORMED
    if len(markers) > 1:
        return MALFORMED
    if markers and not marker_is_closed(logical_command, markers[0]):
        return MALFORMED
    return UNSUPPORTED


if __name__ == "__main__":
    raise SystemExit(main())
