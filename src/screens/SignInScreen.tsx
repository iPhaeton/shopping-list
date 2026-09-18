import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SignInScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { colors, radius, spacing } from '../theme';

/** Supabase allows one code request per minute; the countdown makes that visible. */
const RESEND_COOLDOWN_SECONDS = 60;

const CODE_LENGTH = 6;

/**
 * Two phases in one screen: email, then the code that lands in the inbox. There is no separate
 * sign-up screen — `requestCode` creates the account when the address is new.
 *
 * Takes `navigation` as a prop per convention even though it never navigates: `RootNavigator`
 * swaps the whole stack when the session state changes, which unmounts this screen.
 */
export function SignInScreen(_props: SignInScreenProps) {
  const { requestCode, verifyCode, signInWithGoogle } = useSession();

  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const canSend = email.trim().length > 0 && !pending;
  const canVerify = code.trim().length === CODE_LENGTH && !pending;
  const canResend = cooldown === 0 && !pending;

  async function send() {
    if (!canSend) return;

    setPending(true);
    setError(null);

    const { error: failure } = await requestCode(email);

    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }

    setPhase('code');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function verify() {
    if (!canVerify) return;

    setPending(true);
    setError(null);

    const { error: failure } = await verifyCode(email, code);

    // Only touched on failure: success flips the session state, which unmounts this screen.
    // Leaving `pending` set also blocks a second submit while that swap happens.
    if (failure) {
      setPending(false);
      setError(failure);
      setCode('');
    }
  }

  async function continueWithGoogle() {
    if (pending) return;

    setPending(true);
    setError(null);

    const { error: failure } = await signInWithGoogle();

    // Unlike verify(), always cleared: a cancelled sheet returns `{ error: null }` with no state
    // change, and success unmounts this screen anyway, so clearing here is a harmless no-op.
    setPending(false);
    if (failure) setError(failure);
  }

  function startOver() {
    setPhase('email');
    setCode('');
    setError(null);
    setCooldown(0);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        {phase === 'email' ? (
          <>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.hint}>We'll email you a six-digit code. No password needed.</Text>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={send}
            />

            <PrimaryButton label="Send code" enabled={canSend} onPress={send} />

            {Platform.OS !== 'web' && (
              <PrimaryButton
                label="Continue with Google"
                enabled={!pending}
                onPress={continueWithGoogle}
              />
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.hint}>We sent a six-digit code to {email.trim()}.</Text>

            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Six-digit code"
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={verify}
            />

            <PrimaryButton label="Sign in" enabled={canVerify} onPress={verify} />

            {/*
              The a11y label stays "Resend code" while the visible text counts down, so the
              countdown cannot break a query the way a composed label would.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend code"
              accessibilityState={{ disabled: !canResend }}
              disabled={!canResend}
              onPress={send}
              style={styles.link}>
              <Text style={[styles.linkText, !canResend && styles.linkTextDisabled]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use a different email"
              onPress={startOver}
              style={styles.link}>
              <Text style={styles.linkText}>Use a different email</Text>
            </Pressable>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({
  label,
  enabled,
  onPress,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        !enabled && styles.buttonDisabled,
        pressed && enabled && styles.buttonPressed,
      ]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  card: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    fontSize: 15,
    color: colors.textMuted,
  },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
  },
  codeInput: {
    letterSpacing: 6,
    fontSize: 20,
  },
  button: {
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  linkText: {
    color: colors.accent,
    fontSize: 15,
  },
  linkTextDisabled: {
    color: colors.textMuted,
  },
  error: {
    color: colors.error,
    fontSize: 15,
  },
});
