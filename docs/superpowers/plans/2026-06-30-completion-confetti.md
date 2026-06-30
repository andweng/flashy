# Completion-screen Confetti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a one-shot confetti burst on the review completion screen when a session with reviewed cards finishes.

**Architecture:** A self-contained `<Confetti />` overlay built with Reanimated 4. A single shared `progress` value animates `0 → 1` on mount; each particle's `useAnimatedStyle` worklet maps progress to outward spread + gravity fall + spin + fade. A pure `makeParticles(count)` helper generates per-particle config. The component is mounted only in the `total > 0` branch of `CompletionScreen`.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript (strict), `react-native-reanimated` 4.3.1 (+ `react-native-worklets` 0.8.3, babel plugin auto-wired by `babel-preset-expo`).

## Global Constraints

- Expo SDK 56 — consult the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before changing any Expo/RN API usage. Do not assume pre-v56 APIs.
- No new runtime or dev dependencies. Reanimated 4 + worklets are already installed and proven (see `src/components/ui/collapsible.tsx`).
- No test runner exists in this repo. The verification gate for every task is: `npx tsc --noEmit` passes AND `npm run lint` passes. The final task adds a manual app-run check.
- Reanimated import pattern: `import Animated, { ... } from 'react-native-reanimated';` (matches `collapsible.tsx`).
- Confetti fires ONLY on the `total > 0` ("Done! 🎉") completion branch. Never on the `total === 0` ("All caught up!") branch.
- Particle color palette (exact): `#2eab63`, `#3c87f7`, `#f7c83c`, `#f7553c`, `#9b5cf7`.
- Defaults: `count = 50`, `duration = 1800` ms.
- Path alias `@/*` maps to `./src/*` (see `tsconfig.json`).

---

### Task 1: Confetti component + `makeParticles` helper

**Files:**
- Create: `src/components/confetti.tsx`

**Interfaces:**
- Consumes: nothing (leaf component).
- Produces:
  - `export function Confetti(props: { count?: number; duration?: number }): JSX.Element` — default export-free named export; auto-plays once on mount.
  - `export type Particle = { angle: number; distance: number; gravity: number; spin: number; delay: number; size: number; color: string }`
  - `export function makeParticles(count: number): Particle[]`

- [ ] **Step 1: Create `src/components/confetti.tsx` with the full component**

```tsx
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const PALETTE = ['#2eab63', '#3c87f7', '#f7c83c', '#f7553c', '#9b5cf7'] as const;
const TAU = Math.PI * 2;

export type Particle = {
  angle: number; // radians, direction of initial travel
  distance: number; // px of outward spread
  gravity: number; // px of downward pull (applied as progress²)
  spin: number; // total rotation in degrees
  delay: number; // ms stagger before this particle starts
  size: number; // px (square side)
  color: string; // from PALETTE
};

// Pure: returns `count` randomized particle configs. Exported for reuse/testing.
// Color is assigned round-robin so every particle is guaranteed palette-valid
// and the colors stay evenly distributed.
export function makeParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      angle: Math.random() * TAU,
      distance: 120 + Math.random() * 160, // 120..280
      gravity: 240 + Math.random() * 200, // 240..440
      spin: (Math.random() * 4 - 2) * 360, // -720..720 deg
      delay: Math.random() * 120, // 0..120 ms
      size: 8 + Math.random() * 8, // 8..16 px
      color: PALETTE[i % PALETTE.length],
    });
  }
  return particles;
}

type ConfettiPieceProps = {
  particle: Particle;
  progress: SharedValue<number>;
  duration: number;
  originX: number;
  originY: number;
};

function ConfettiPiece({
  particle,
  progress,
  duration,
  originX,
  originY,
}: ConfettiPieceProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const delayFrac = particle.delay / duration;
    const raw = (progress.value - delayFrac) / (1 - delayFrac);
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const eased = 1 - (1 - p) * (1 - p); // easeOutQuad: shoot out, then slow
    const tx = Math.cos(particle.angle) * particle.distance * eased;
    const ty =
      Math.sin(particle.angle) * particle.distance * eased +
      particle.gravity * p * p; // gravity pulls down (positive y)
    const rot = particle.spin * p;
    const opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3; // fade last 30%
    return {
      opacity,
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotate: `${rot}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: originX,
          top: originY,
          width: particle.size,
          height: particle.size,
          backgroundColor: particle.color,
        },
        animatedStyle,
      ]}
    />
  );
}

export function Confetti({
  count = 50,
  duration = 1800,
}: {
  count?: number;
  duration?: number;
}) {
  const { width, height } = useWindowDimensions();
  const particles = useMemo(() => makeParticles(count), [count]);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration, easing: Easing.linear });
  }, [duration, progress]);

  const originX = width / 2;
  const originY = height * 0.35; // burst from upper third so it rains down

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((particle, i) => (
        <ConfettiPiece
          key={i}
          particle={particle}
          progress={progress}
          duration={duration}
          originX={originX}
          originY={originY}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', borderRadius: 2 },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors. (Confirms Reanimated types, `SharedValue` import, and the worklet style object all typecheck.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `src/components/confetti.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/confetti.tsx
git commit -m "Add Confetti overlay component with makeParticles helper"
```

---

### Task 2: Render Confetti on the completion screen

**Files:**
- Modify: `src/app/(app)/review.tsx` (`CompletionScreen`, ~lines 248-278)

**Interfaces:**
- Consumes: `Confetti` from `@/components/confetti` (Task 1).
- Produces: nothing new (wiring only).

- [ ] **Step 1: Import `Confetti`**

In `src/app/(app)/review.tsx`, add to the existing component imports (near the
`themed-text` / `themed-view` imports at the top):

```tsx
import { Confetti } from '@/components/confetti';
```

- [ ] **Step 2: Render `<Confetti />` in the `total > 0` branch**

In `CompletionScreen`, the current `return` is:

```tsx
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        {total === 0 ? (
          <>
            <ThemedText type="title">All caught up!</ThemedText>
            <ThemedText themeColor="textSecondary">Nothing was due. Come back tomorrow.</ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="title">Done! 🎉</ThemedText>
            <ThemedText type="subtitle">
              {passes} passed · {fails} missed
            </ThemedText>
          </>
        )}
        <PrimaryButton label="Back home" onPress={onDone} />
      </SafeAreaView>
    </ThemedView>
  );
```

Replace it with (adds the overlay as a sibling AFTER `SafeAreaView`, so it draws
on top; `pointerEvents="none"` inside `Confetti` keeps the button tappable):

```tsx
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        {total === 0 ? (
          <>
            <ThemedText type="title">All caught up!</ThemedText>
            <ThemedText themeColor="textSecondary">Nothing was due. Come back tomorrow.</ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="title">Done! 🎉</ThemedText>
            <ThemedText type="subtitle">
              {passes} passed · {fails} missed
            </ThemedText>
          </>
        )}
        <PrimaryButton label="Back home" onPress={onDone} />
      </SafeAreaView>
      {total > 0 && <Confetti />}
    </ThemedView>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual run verification**

Run: `npm run web` (fastest loop; or `npm run ios` / `npm run android`).
Verify, in order:
1. Start a review session for a child who has cards due, grade through every
   card to reach the completion screen. **Expect:** "Done! 🎉" appears and a
   confetti burst fires once from the upper-middle and falls/fades over ~1.8s.
2. The "Back home" button is still tappable while/after the confetti plays
   (confirms `pointerEvents="none"`).
3. Reach the completion screen with nothing due (the "All caught up!" state, e.g.
   open review when no cards are due). **Expect:** NO confetti.

If any check fails, fix before committing (do not commit a broken animation).

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/review.tsx
git commit -m "Fire confetti on completed review session"
```

---

### Task 3: Tap-to-replay confetti + fix Back-home button height

**Files:**
- Modify: `src/app/(app)/review.tsx` (`CompletionScreen` ~lines 249-280; `PrimaryButton` ~lines 322-328; `styles`)

**Interfaces:**
- Consumes: `Confetti` from `@/components/confetti` (already imported in Task 2).
  `ThemedText` (from `@/components/themed-text`) forwards `onPress` to the
  underlying RN `Text` (it spreads `...rest`), so a nested `<ThemedText onPress>`
  is a valid tap target.
- Produces: nothing new (behavior + style change only).

**Behavior:**
- Tapping the `🎉` on the "Done! 🎉" completion screen re-fires the confetti.
  The "All caught up!" (`total === 0`) screen is untouched.
- The "Back home" button no longer stretches to full screen height.

- [ ] **Step 1: Add `StyleProp` / `ViewStyle` type imports**

In `src/app/(app)/review.tsx`, change the `react-native` import:

```tsx
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
```

to:

```tsx
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
```

(`useState` is already imported from `react` at the top — no change there.)

- [ ] **Step 2: Add an optional `style` prop to `PrimaryButton`**

Replace the current `PrimaryButton`:

```tsx
function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.button, styles.primary]} onPress={onPress}>
      <ThemedText style={styles.buttonText}>{label}</ThemedText>
    </Pressable>
  );
}
```

with:

```tsx
function PrimaryButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable style={[styles.button, styles.primary, style]} onPress={onPress}>
      <ThemedText style={styles.buttonText}>{label}</ThemedText>
    </Pressable>
  );
}
```

The optional `style` is applied last so callers can override. Existing callers
(`Show answer`, `Check`) pass no `style`, so they keep `flex: 1` unchanged.

- [ ] **Step 3: Update `CompletionScreen` — burst counter, tappable emoji, keyed + style**

Replace the whole `CompletionScreen` body return (currently keyed off `total`):

```tsx
function CompletionScreen({
  passes,
  fails,
  onDone,
}: {
  passes: number;
  fails: number;
  onDone: () => void;
}) {
  const total = passes + fails;
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        {total === 0 ? (
          <>
            <ThemedText type="title">All caught up!</ThemedText>
            <ThemedText themeColor="textSecondary">Nothing was due. Come back tomorrow.</ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="title">Done! 🎉</ThemedText>
            <ThemedText type="subtitle">
              {passes} passed · {fails} missed
            </ThemedText>
          </>
        )}
        <PrimaryButton label="Back home" onPress={onDone} />
      </SafeAreaView>
      {total > 0 && <Confetti />}
    </ThemedView>
  );
}
```

with:

```tsx
function CompletionScreen({
  passes,
  fails,
  onDone,
}: {
  passes: number;
  fails: number;
  onDone: () => void;
}) {
  const total = passes + fails;
  const [burst, setBurst] = useState(0);
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        {total === 0 ? (
          <>
            <ThemedText type="title">All caught up!</ThemedText>
            <ThemedText themeColor="textSecondary">Nothing was due. Come back tomorrow.</ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="title">
              Done!{' '}
              <ThemedText type="title" onPress={() => setBurst((b) => b + 1)}>
                🎉
              </ThemedText>
            </ThemedText>
            <ThemedText type="subtitle">
              {passes} passed · {fails} missed
            </ThemedText>
          </>
        )}
        <PrimaryButton label="Back home" onPress={onDone} style={styles.completionButton} />
      </SafeAreaView>
      {total > 0 && <Confetti key={burst} />}
    </ThemedView>
  );
}
```

Notes:
- `burst` starts at 0, so the initial mount auto-plays the first burst exactly as
  before. Each tap increments `burst`, which changes the `<Confetti>` `key`,
  remounting it — `Confetti` auto-plays on mount with freshly randomized
  particles, so every tap is a new explosion.
- The inner `<ThemedText type="title" onPress=...>` keeps the title font size (48)
  so the emoji doesn't shrink; only the emoji is the tap target.

- [ ] **Step 4: Add the `completionButton` style**

In the `styles` `StyleSheet.create({ ... })` block (the one that holds `button`,
`primary`, etc.), add:

```tsx
  completionButton: { flex: 0 },
```

In React Native `flex: 0` sizes the element to its content (no grow/shrink),
overriding the `flex: 1` from `styles.button` so the button is its natural height
and width instead of filling the centered column.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/review.tsx
git commit -m "Tap the Done emoji to replay confetti; fix Back-home button height"
```

- [ ] **Step 8: Manual run verification (controller/user, not the implementer)**

Finish a session with reviewed cards. **Expect:** confetti auto-fires once;
tapping the `🎉` re-fires it each tap; the "Back home" button is a normal-height
button (not full-screen), still tappable. The "All caught up!" screen still shows
no confetti.

---

## Notes for the implementer

- `Math.*` and string-template construction are valid inside Reanimated worklets;
  `useAnimatedStyle` callbacks are auto-workletized by `babel-preset-expo` — do
  NOT add a manual `'worklet'` directive or a `babel.config.js`.
- Positive `translateY` moves a view DOWN in React Native, which is why gravity
  adds to `ty`.
- Particle count is fixed for the component's lifetime (`useMemo` on `count`), so
  calling `useAnimatedStyle` once per particle via the `ConfettiPiece` child does
  not violate the rules of hooks.
