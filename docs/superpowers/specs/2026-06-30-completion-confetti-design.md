# Completion-screen confetti — design

**Date:** 2026-06-30
**Status:** Approved, pending implementation plan

## Goal

Celebrate the end of a review session with a confetti burst on the completion
screen. The animation should feel like an explosion of particles and play once
when the user finishes a session that had cards to review.

## Trigger

Fire on the review **completion screen**, not on individual button taps.

- Fire only in the `total > 0` ("Done! 🎉") branch of `CompletionScreen`.
- Do **not** fire in the `total === 0` ("All caught up!") branch — an empty
  session (nothing was due) gets no celebration.
- Plays exactly once, on mount of the completion screen.

## Approach

Custom component built with Reanimated 4 + worklets. No new dependency.
Works on native and web (worklets fall back to JS on web).

Rejected alternatives:
- Third-party lib (e.g. `react-native-confetti-cannon`): compat risk with
  RN 0.85 / new architecture / Reanimated 4 / `react-native-web`; several are
  unmaintained.
- Animated-API emoji burst: less convincing as an "explosion".

## Components

### `src/components/confetti.tsx`

Self-contained overlay component.

- **Public API:** `<Confetti count?={number} duration?={number} />`.
  Defaults: `count = 50`, `duration = 1800` (ms).
- **Layout:** absolute-fill `View`, `pointerEvents="none"`, rendered above the
  completion-screen content so it never blocks the "Back home" button.
- **Animation:** a single shared `progress` value animates `0 → 1` via
  `withTiming` on mount. Each particle has its own `useAnimatedStyle` derived
  from `progress`:
  - horizontal travel: `cos(angle) * distance * progress`
  - vertical travel: `sin(angle) * distance * progress + gravity * progress²`
    (rises/spreads then falls)
  - rotation: `spin * progress`
  - opacity: full until ~70% of progress, then fades to 0
  - optional per-particle `delay` staggers the burst slightly
- Particle visuals: small rounded `View`s (a few px), colored from the palette.

### `makeParticles(count)` — pure helper

Lives in the same `confetti.tsx` file, exported for testing. Returns an array
of particle configs:

```ts
type Particle = {
  angle: number;      // radians, direction of travel
  distance: number;   // px of spread
  gravity: number;    // px of downward pull
  spin: number;       // total rotation in deg
  delay: number;      // ms stagger
  size: number;       // px
  color: string;      // from palette
};
```

Each field is randomized within sensible ranges. Keeping this as a pure function
(no React, no Reanimated) makes the particle distribution unit-testable; the
component only renders what the helper returns.

### Palette

Small festive set, reusing existing theme colors plus a few brights:
`#2eab63` (pass green), `#3c87f7` (primary blue), `#f7c83c`, `#f7553c`,
`#9b5cf7`. Final list finalized in implementation.

## Integration

In `src/app/(app)/review.tsx`, `CompletionScreen`:

- Render `<Confetti />` inside the `total > 0` branch only.
- Overlay sits above the existing content; existing layout unchanged.

## Testing

- Unit-test `makeParticles(count)`:
  - returns exactly `count` particles
  - every `color` is from the palette
  - numeric fields fall within their defined ranges
- The animated component itself is not unit-tested (RN animation timing is not
  meaningfully assertable in a unit test); correctness is verified by running the
  app and finishing a session.

## Addendum (2026-06-30): tap-to-replay + button fix

Two follow-up changes requested after the initial build:

1. **Tap the 🎉 to replay confetti (Done screen only).** The `🎉` in the
   "Done! 🎉" title becomes tappable; each tap re-fires the confetti. The
   "All caught up!" screen is unchanged (still no confetti, no emoji).
   Implemented by keying the overlay (`<Confetti key={burst} />`) and bumping a
   `burst` counter on tap — a key change remounts `Confetti`, which auto-plays
   on mount and regenerates fresh random particles. No change to `confetti.tsx`.

2. **Fix the "Back home" button height.** `styles.button` sets `flex: 1` (needed
   to split width in the review screen's dual-button row). On the completion
   screen's centered column that makes the lone button stretch the full screen
   height. Fix: give `PrimaryButton` an optional `style` prop and pass `flex: 0`
   for the completion button only; other `PrimaryButton`/dual-button usages keep
   `flex: 1`.

## Addendum 2 (2026-06-30): additive bursts + both completion states

Supersedes parts of Addendum 1 per follow-up requests:

1. **Both completion states get a tappable 🎉.** The empty-session screen now
   reads "All done! 🎉" with a tappable emoji that fires confetti; the reviewed
   screen keeps "Done! 🎉". The reviewed screen still auto-fires one burst on
   mount; the empty screen is tap-only (no auto-burst).

2. **Bursts are additive.** Tapping no longer remounts a single overlay (which
   discarded the in-flight burst). Instead `CompletionScreen` keeps a list of
   active burst ids and renders one `<Confetti>` per id, so taps stack and
   overlap. `Confetti` gains an `onDone` callback (fired after `duration`) so
   each instance removes itself from the list once finished — additive while
   live, bounded over time.

3. **"Back home" button centering.** `styles.button` was missing
   `justifyContent: 'center'`, leaving the label vertically off in a taller
   button; added it. The completion button uses `minHeight: 56` (replacing the
   earlier `paddingVertical` bump) for a consistent, comfortable height.

## Out of scope (YAGNI)

- Haptics / sound.
- Per-card confetti on individual passes.
- Configurable palette via props/theme beyond the built-in set.
