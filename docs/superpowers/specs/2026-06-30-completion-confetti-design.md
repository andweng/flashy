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

## Out of scope (YAGNI)

- Haptics / sound.
- Per-card confetti on individual passes.
- Confetti on the "All caught up!" empty-session screen.
- Configurable palette via props/theme beyond the built-in set.
