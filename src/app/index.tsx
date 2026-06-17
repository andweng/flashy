import { Link, Redirect, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import type { Child } from '@/types/domain';

export default function ProfilePicker() {
  const { ready, signedIn, signOut } = useAuth();
  const router = useRouter();
  const { setChild } = useCurrentChild();
  const [children, setChildren] = useState<Child[] | null>(null);

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
          <Pressable onPress={signOut}>
            <ThemedText themeColor="textSecondary">Sign out</ThemedText>
          </Pressable>
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
});
