---
name: phaser-asset-sourcing
description: This skill should be used when a Phaser 4 game needs actual art or audio and none exists yet — deciding WHERE game art comes from before it can be packed. Covers the priority order (curated CC0 packs → deriving/editing CC0 art → asking the human for bespoke/paid work), the strict license gate (CC0-or-equivalent only, recorded with an exact license quote + evidence URL in assets/LICENSES.md), the provenance requirement (a committed ingest script or committed raw sources), why procedural generateTexture placeholders are tracked art debt and never a best practice, and the expectation that characters ship real idle+walk animation. Use it BEFORE phaser-asset-pipeline (which only packs art that already exists). Pairs with phaser-asset-pipeline, the official animations skill, and the art-director / audio-director personas.
---

# Phaser 4 Asset Sourcing

## Why this skill exists

The `phaser-asset-pipeline` skill is **packing-only**: it assumes raw art already
sits in `assets/src` and turns it into atlases + typed keys. It never says where
that art comes from. Left to fill the gap, agents reach for the path of least
resistance — `this.add.graphics().generateTexture(...)` white rectangles — and
ship a wireframe that *typechecks and boots* but looks like programmer art.

**Procedural placeholders are art debt, not an art strategy.** A shipped game
needs real, licensed, cohesive assets. This skill is the missing step: how to
**get** the art before you pack it. Read it *before* `phaser-asset-pipeline`.

## The sourcing decision, in priority order

Work top-down. Only fall to the next tier when the one above genuinely can't
serve the need.

### 1. Curated CC0 sources (default — reach here first)

Real, cohesive, commercially-usable art exists for free under CC0. These are the
recommended starting points; all are CC0 or CC0-equivalent (verify per pack —
see the license gate below):

- **[Kenney.nl](https://kenney.nl/assets)** — hundreds of packs (top-down,
  platformer, UI, tiles, isometric, audio), **all CC0**. The single best
  first stop for cohesive, atlas-friendly art.
- **Pixel-boy & AAA — [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)**
  — a full CC0 JRPG kit: characters with directional idle/walk/attack strips,
  monsters, tilesets, UI, portraits, FX, and music. Ideal for top-down /
  RPG-shaped games (this is what the reference implementation uses).
- **ansimuz (Luis Zuno) — [CC0 packs](https://ansimuz.itch.io/)** — parallax
  backdrops, environments, effects. Check each pack's license: the base packs
  are typically CC0; some have paid add-ons that are **not**.
- **[OpenGameArt.org](https://opengameart.org/)**, **filtered to CC0**
  (`CC0` in the license facet). Great breadth; licenses are per-submission, so
  you MUST verify each asset individually — OGA also hosts CC-BY, CC-BY-SA, and
  GPL art that the license gate rejects.
- **[itch.io](https://itch.io/game-assets/assets-cc0)** game assets filtered to
  the CC0 license.

Prefer one or two packs with a shared visual language over a magpie mix — a
single Kenney pack reads more cohesive than ten sources stitched together (the
art-director persona will flag the mismatch otherwise).

### 2. Deriving / editing CC0 art (allowed freely)

CC0 waives all rights, so you may recolor, crop, re-slice, retag, upscale
(nearest-neighbor for pixel art), and recombine freely. This is usually how a
pack becomes *this game's* assets: slice a sprite sheet into per-frame PNGs,
rename frames to your content refs, restitch strips. Record exactly how in the
ingest script (below) so the derivation is reproducible.

### 3. Ask the human (bespoke quality, paid tools, commissioning)

When the art bible demands a bespoke look no CC0 pack delivers — a signature
character, a specific illustrated style, licensed audio — **stop and ask the
human**. Do not silently downgrade to placeholders and do not buy/commission on
your own. Surface the decision:

> "The art direction calls for `<X>`. No CC0 source covers it. Options: (a) adapt
> the closest CC0 pack `<Y>` and accept the style delta, (b) you provide/approve
> a paid pack or commission, (c) ship a tracked `generateTexture` placeholder
> against issue `#NNN` until real art lands. Which?"

Paid assets, CC-BY with attribution, or any non-CC0 license are allowed **only
with explicit human approval**, recorded in `assets/LICENSES.md` with the terms.

## Hard rules

### License gate — CC0 or equivalent only

- **Accept**: CC0 1.0, public domain dedication, or an explicit "use freely in
  commercial games, no attribution required" grant equivalent to CC0.
- **Reject** (unless the human explicitly approves and the terms are recorded):
  CC-BY (attribution burden), CC-BY-SA / GPL (copyleft — forces your project's
  license), CC-NC (no commercial), "free for personal use", and anything
  unlicensed or license-unknown.
- For **every** pack, record in `assets/LICENSES.md`: the pack name, author,
  source URL, the exact license, a **verbatim license quote**, and the
  **evidence URL** where that quote lives (the itch page, the in-pack
  `LICENSE.txt`, the OGA submission). "It looked free" is not evidence.

```md
| Pack | Author | Source | License | Evidence |
|------|--------|--------|---------|----------|
| Ninja Adventure – Asset Pack | Pixel-boy & AAA | https://pixel-boy.itch.io/ninja-adventure-asset-pack | CC0 1.0 | In-pack `LICENSE.txt` (full CC0 text); itch page "Creative Commons Zero v1.0 Universal" |
```

### Provenance — the source must be reproducible

The packs themselves are often large and need not be committed, but **how you
got from a pack to `assets/src` must be**. Two acceptable patterns:

- **Committed ingest script** (`scripts/ingest-assets.mjs`) that records, per
  frame, which pack / file / cell it came from and re-slices deterministically.
  Re-running it against a fresh download reproduces `assets/src` byte-for-byte.
  This is the provenance record — it documents the source layout (e.g. "Ninja
  Adventure character `Idle.png` is 64×16 = 4 direction cells; `Walk.png` is
  64×64 = 4 direction columns × 4 walk rows") and doubles as the derivation log.
- **Committed raw sources** under `assets/src` directly, when the art is small,
  hand-authored, or already per-frame.

Either way: `assets/LICENSES.md` + a reproducible path from source to
`assets/src`. Adding art from a **new** source requires both, every time.

### Procedural `generateTexture` placeholders are TRACKED ART DEBT

A scene MAY ship `generateTexture` / `graphics`-drawn placeholder art **only**
when it is tracked by a linked art-debt issue. It is never the finished state,
and it is never described as a best practice. In particular:

- **Never** write comments like "zero binary assets, zero licensing risk" as if
  placeholders were the goal. They are a temporary stand-in, and that framing is
  exactly what produced wireframe games.
- Keep a visible ledger of the debt (e.g. a `LEGACY_GENERATED_TEXTURE_KEYS` map
  in the pack script, or a checklist in the issue) and delete each entry the
  moment the real asset lands.
- The art-director persona treats a placeholder-only scene as a **blocking**
  finding (see its review checklist).

### Characters get real animation

Static single-frame sprites are a placeholder smell. A character/creature ships
at minimum an **idle** and a **walk** cycle; most CC0 character packs already
provide directional idle/walk/attack strips, so there is no excuse to ship a
frozen frame. Name frames so the pipeline and the official **`animations`**
skill can build the animation from them (e.g. `<ref>/walk-<dir>-<n>`), and drive
them with `anims.create` / `anims.play`, not a static texture. The asset-pipeline
skill covers frame naming; the official `animations` skill covers playback.

## Verification

- Every entry in `assets/LICENSES.md` is CC0-or-equivalent (or human-approved
  with terms recorded) and carries a verbatim quote + evidence URL.
- `assets/src` is reproducible from a committed ingest script or is itself
  committed raw source.
- No scene ships `generateTexture` placeholder art without a linked art-debt
  issue; the debt ledger matches reality.
- Characters render with a playing idle/walk animation, not a static frame —
  confirm in the **real browser** (the art-director persona reviews rendered
  screenshots, not code).

Once the art exists in `assets/src`, hand off to **`phaser-asset-pipeline`** to
pack it and codegen the typed keys.
