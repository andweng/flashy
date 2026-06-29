import { Link, Redirect, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { getEffectiveToday } from '@/lib/today';
import type { Child } from '@/types/domain';

export default function ProfilePicker() {
  const { ready, signedIn, signOut } = useAuth();
  const router = useRouter();
  const { setChild } = useCurrentChild();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [dueByChild, setDueByChild] = useState<Record<string, number>>({});

  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      let cancelled = false;
      void (async () => {
        const parent = await db.getCurrentParent();
        if (!parent) {
          if (!cancelled) setChildren([]);
          return;
        }
        const list = await db.listChildren(parent.id);
        if (!cancelled) setChildren(list);

        // Tally each child's cards due today for the "needs review" dot.
        // Due counts compare against the real calendar day; each deck's schedule is
        // pre-positioned per (child, deck), so there's no per-child read-time offset.
        const counts = await Promise.all(
          list.map((c) =>
            db
              .countDueCardsForChild(c.id, getEffectiveToday(parent.timezone))
              .catch(() => 0),
          ),
        );
        if (!cancelled) {
          setDueByChild(Object.fromEntries(list.map((c, i) => [c.id, counts[i]])));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [signedIn]),
  );

  if (!ready) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={[styles.safe, styles.centered]}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="title">Who&apos;s playing?</ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/account')}>
              <ThemedText themeColor="textSecondary">Settings</ThemedText>
            </Pressable>
            <ThemedText themeColor="textSecondary">|</ThemedText>
            <Pressable onPress={signOut}>
              <ThemedText themeColor="textSecondary">Sign out</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.children}>
          {children?.map((c) => (
            <Pressable
              key={c.id}
              style={styles.childCard}
              onPress={() => {
                setChild(c);
                router.push('/home');
              }}>
              <ThemedView type="backgroundElement" style={styles.avatarTile}>
                <ThemedText style={styles.avatar}>{c.avatar ?? '🙂'}</ThemedText>
                {dueByChild[c.id] > 0 && (
                  <View style={styles.badge}>
                    <ThemedText style={styles.badgeText}>
                      {dueByChild[c.id] > 99 ? '99+' : dueByChild[c.id]}
                    </ThemedText>
                  </View>
                )}
              </ThemedView>
              <ThemedText type="subtitle">{c.display_name}</ThemedText>
            </Pressable>
          ))}
          <Link href="/add-child" asChild>
            <Pressable style={styles.childCard}>
              <ThemedView type="backgroundElement" style={styles.avatarTile}>
                <ThemedText style={styles.avatarPlus}>+</ThemedText>
              </ThemedView>
              <ThemedText themeColor="textSecondary">Add</ThemedText>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.five },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  children: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    justifyContent: 'center',
  },
  childCard: { alignItems: 'center', gap: Spacing.three },
  avatarTile: {
    width: 140,
    height: 140,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { fontSize: 72 },
  avatarPlus: { fontSize: 56, opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: '#d2433f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
});
