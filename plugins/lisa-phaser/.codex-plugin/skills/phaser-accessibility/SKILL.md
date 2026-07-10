---
name: phaser-accessibility
description: "making a Phaser 4 game…"
---

# Phaser 4 Accessibility

## Overview

The canvas is opaque to assistive tech, so accessibility is something you build
in, not get for free. Five pillars carry most of the value: respect
`prefers-reduced-motion`, pause when the window loses focus, make menus fully
keyboard-navigable with visible focus, use colorblind-safe palettes, and mirror
game state into a DOM **live region** for screen readers. These wire through the
shared services ([[phaser-services]]) and use translated strings ([[phaser-i18n]]).

## prefers-reduced-motion

Read the media query once and gate non-essential motion (screen shake, parallax,
big tweens, particle bursts) behind it. Reduced motion means "convey the same
information with less movement", not "remove feedback".

```ts
// src/services/a11y.ts
export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// in a scene
if (!reduceMotion) this.cameras.main.shake(120, 0.004);
this.tweens.add({ targets: panel, alpha: 1, duration: reduceMotion ? 0 : 250 });
```

Expose it as a togglable setting too (some players want it on regardless of OS),
stored via SaveService ([[phaser-services]]).

## Pause on blur

A game that keeps running while the tab is hidden drains battery, desyncs audio,
and is hostile to players who switch away. Phaser already exposes blur/focus
events — pause the loop and audio, resume on focus.

```ts
this.game.events.on(Phaser.Core.Events.BLUR, () => { this.scene.pause(); this.sound.pauseAll(); });
this.game.events.on(Phaser.Core.Events.FOCUS, () => { this.scene.resume(); this.sound.resumeAll(); });
```

Set `Phaser.Types.Core.GameConfig.autoFocus` and `disableContextMenu` as needed.
(These are listeners — remove them in `shutdown` per the on/off discipline in
[[phaser-services]].) For competitive/timed play, pausing on blur is also the
fair behavior.

## Keyboard navigation and visible focus

Every menu must be operable without a pointer: arrow keys / Tab move focus, Enter
or Space activates, Escape backs out. Keep a focus index over a typed list of
items and render an unmistakable focus indicator (outline/scale, not color alone).

```ts
private items: MenuItem[] = [];
private focus = 0;

private move(delta: number) {
  this.items[this.focus].setFocused(false);
  this.focus = Phaser.Math.Wrap(this.focus + delta, 0, this.items.length);
  this.items[this.focus].setFocused(true);          // visible outline + announce
  this.announce(this.items[this.focus].label);
}
create() {
  this.input.keyboard!.on("keydown-DOWN", () => this.move(1));
  this.input.keyboard!.on("keydown-UP",   () => this.move(-1));
  this.input.keyboard!.on("keydown-ENTER",() => this.items[this.focus].activate());
}
```

Use the semantic InputService actions ([[phaser-services]]) so the same bindings
serve gamepad and touch. Never rely on hover-only affordances.

## Colorblind-safe palettes

Never encode meaning in hue alone — pair every color cue with a shape, icon,
label, or pattern (red enemy *and* a spike icon; green/red status *and* a check/x).
Choose palettes that stay distinguishable across deuteranopia/protanopia
/tritanopia, and offer a colorblind palette option in settings.

```ts
// src/logic/palette.ts — pure, testable, no phaser import
export const palettes = {
  default: { ally: 0x2e7d32, enemy: 0xc62828, neutral: 0xf9a825 },
  deuter:  { ally: 0x0072b2, enemy: 0xd55e00, neutral: 0xf0e442 }, // Okabe–Ito, CB-safe
} as const;
```

Keep palette selection in `src/logic/**` so contrast/choice logic is unit-tested,
and store the player's choice via SaveService.

## Screen-reader live region

Mirror important state changes into an ARIA live region in the DOM (outside the
canvas) so screen readers announce them. One polite region for status, one
assertive for urgent events.

```html
<!-- index.html, alongside the game container -->
<div id="sr-status" aria-live="polite"   class="sr-only"></div>
<div id="sr-alert"  aria-live="assertive" class="sr-only"></div>
```

```ts
// src/services/a11y.ts
const status = document.getElementById("sr-status")!;
export function announce(msg: string, urgent = false) {
  const el = urgent ? document.getElementById("sr-alert")! : status;
  el.textContent = ""; el.textContent = msg; // clear+set so identical repeats re-announce
}
```

Announce menu focus, score milestones, level changes, and game-over. Messages
come from the i18n catalog ([[phaser-i18n]]) — never hardcoded — and `.sr-only`
keeps the region visually hidden but readable by AT.

## Project conventions

- A11y plumbing lives in `src/services/a11y.ts`; palette/choice logic lives in
  `src/logic/**` (unit-tested).
- Accessibility settings (reduced motion, colorblind palette) persist via
  SaveService and apply on boot ([[phaser-services]]).
- All announced/visible text comes from the i18n catalog ([[phaser-i18n]]).

## Verification

Verified by manual passes that double as runtime checks: tab through every menu
with the pointer unplugged and confirm visible focus + activation; set the OS to
reduce-motion and confirm shake/parallax stop while feedback remains; blur the
tab and confirm the game pauses and audio stops; and run a screen reader (VoiceOver
/NVDA) to confirm the live region announces menu focus and game state.
</content>
