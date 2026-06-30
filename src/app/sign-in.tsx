import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type Mode = 'sign_in' | 'sign_up';

const USE_MOCK = (process.env.EXPO_PUBLIC_USE_MOCK ?? 'true') === 'true';

export default function SignInScreen() {
  const { signedIn } = useAuth();
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // If we're already signed in (real session or mock), bounce home.
  if (signedIn) return <Redirect href="/" />;

  async function submit() {
    if (USE_MOCK) {
      setError('Mock mode — sign-in is disabled. Set EXPO_PUBLIC_USE_MOCK=false to use Supabase.');
      return;
    }
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'sign_up') {
        // Without emailRedirectTo, Supabase builds the confirmation link from the
        // dashboard Site URL (defaults to http://localhost:3000). createURL('/')
        // resolves to the running origin: https://flashy.weng.dev/ in web prod,
        // localhost in web dev, the flashy:// scheme on native. The target must
        // also be allow-listed in Supabase Auth → URL Configuration.
        const { data, error: e } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: Linking.createURL('/') },
        });
        if (e) throw e;
        if (!data.session) {
          setInfo('Check your email to confirm your account, then sign in.');
          setMode('sign_in');
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.copy}>
          <ThemedText type="title">{mode === 'sign_in' ? 'Welcome back' : 'Create account'}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {mode === 'sign_in'
              ? "Sign in to manage your kids' decks."
              : 'One account per parent.'}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            editable={!pending}
            style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            autoComplete="password"
            editable={!pending}
            onSubmitEditing={submit}
            style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {info && <ThemedText themeColor="textSecondary">{info}</ThemedText>}

          <Pressable
            style={[styles.submit, pending && styles.submitDisabled]}
            onPress={submit}
            disabled={pending}>
            <ThemedText style={styles.submitText}>
              {pending ? '…' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in');
              setError(null);
              setInfo(null);
            }}>
            <ThemedText themeColor="textSecondary" style={styles.toggle}>
              {mode === 'sign_in' ? 'No account yet? Create one' : 'Have an account? Sign in'}
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.four, justifyContent: 'center' },
  copy: { gap: Spacing.two },
  form: { gap: Spacing.three },
  input: {
    fontSize: 18,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  submit: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  error: { color: '#d2433f' },
  toggle: { textAlign: 'center' },
});
