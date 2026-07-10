---
name: phaser-i18n
description: "localizing a Phaser 4 game — a…"
---

# Phaser 4 Internationalization

## Overview

No user-facing string is hardcoded in a scene. All player-visible text comes from
a **typed string catalog** keyed by typed constants, so a missing or misspelled
key is a compile error and every string has a home for translation. The catalog
is a small typed wrapper (no heavy dependency required); locale switching
re-renders any open text. Announced strings ([[phaser-accessibility]]) and
service messages ([[phaser-services]]) draw from the same catalog.

## The typed catalog

One module owns the locales and the lookup. The key type is derived from the
default locale so every locale must cover the same keys:

```ts
// src/i18n/catalog.ts
const en = {
  "menu.play": "Play",
  "menu.settings": "Settings",
  "hud.score": "Score: {score}",
  "result.cleared": "Level {level} cleared!",
  "lives": "{n} life|{n} lives",     // singular|plural
} as const;

const es: Record<keyof typeof en, string> = {
  "menu.play": "Jugar", "menu.settings": "Ajustes",
  "hud.score": "Puntos: {score}", "result.cleared": "¡Nivel {level} superado!",
  "lives": "{n} vida|{n} vidas",
};

export type StringKey = keyof typeof en;
const locales = { en, es } as const;
export type Locale = keyof typeof locales;
```

## The `t()` function: interpolation + pluralization

```ts
// src/i18n/i18n.ts
let current: Locale = "en";
export function setLocale(l: Locale) { current = l; EventCenter.emit(GameEvent.LocaleChanged); }
export function getLocale() { return current; }

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = (locales[current][key] ?? locales.en[key]) as string;   // fall back to en, never crash
  if (s.includes("|") && params && "n" in params)                 // pick plural form
    s = (Number(params.n) === 1 ? s.split("|")[0] : s.split("|")[1]);
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`));
}
```

Usage is always `t(...)` with a typed key — never a raw string in a scene:

```ts
this.add.bitmapText(x, y, Font.UI, t("hud.score", { score: 0 }));
this.announce(t("result.cleared", { level }));  // [[phaser-accessibility]] live region
```

The plural/interpolation rules are pure functions — put them in `src/logic/**`
so Vitest covers them ([[phaser-testing]]).

## Locale switching at runtime

Changing language must update text that is already on screen. Emit a
`LocaleChanged` event on the EventsCenter ([[phaser-services]]); each scene with
visible text subscribes and re-applies `t()` to its labels, then removes the
listener in `shutdown` (the on/off discipline).

```ts
create() {
  const refresh = () => this.scoreText.setText(t("hud.score", { score: this.score }));
  EventCenter.on(GameEvent.LocaleChanged, refresh);
  this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => EventCenter.off(GameEvent.LocaleChanged, refresh));
}
```

Persist the chosen locale via SaveService and apply it on boot; default from
`navigator.language` when there is no saved choice.

## BitmapText vs Text — the localization trade-off

The performance advice "use BitmapText for hot text" (the official `game-object-components` skill)
collides with i18n: a bitmap font only contains the glyphs it was generated with.

- **BitmapText** — fastest, but the BMFont must include every glyph the locale
  needs. Fine for digits/Latin HUD; generate per-script font pages
  ([[phaser-asset-pipeline]]) if you ship CJK/Cyrillic/etc. via BitmapText.
- **Text** (canvas) — renders any glyph the loaded web font supports, handles
  diacritics and combining marks, and is the safe choice for arbitrary
  translated body text and user-generated content. Cost is rasterization per
  change, so it is for static/low-churn strings.

Rule of thumb: BitmapText for high-churn numeric/short HUD with a covered glyph
set; Text for translated prose and any locale whose script the bitmap font does
not include. For RTL locales (Arabic/Hebrew), use canvas `Text` with
`rtl: true`/right alignment and lay out mirrored — BitmapText does not shape RTL.

## Project conventions

- Every player-facing string is a `t(StringKey, …)` call — no inline literals in
  scenes/entities (this mirrors the no-raw-string-keys discipline).
- The default locale defines the key type; other locales must satisfy it
  (compile error on a missing key).
- Interpolation/plural logic lives in `src/logic/**`; the catalog and `t()` live
  in `src/i18n/**`.
- Locale persists via SaveService and is announced through the live region for
  screen-reader users ([[phaser-accessibility]]).

## Verification

Verified by switching locale at runtime and confirming on-screen text updates
live (no reload), a missing key fails `bun run typecheck`, and pluralization unit
tests pass for n=0/1/many. For non-Latin locales, confirm glyphs render (no tofu
boxes) — that is the signal you need a per-script BMFont page or canvas Text.
</content>
