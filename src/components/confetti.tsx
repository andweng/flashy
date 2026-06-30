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
    const raw = delayFrac >= 1 ? 1 : (progress.value - delayFrac) / (1 - delayFrac);
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
