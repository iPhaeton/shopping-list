import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner } from '../components/ErrorBanner';
import { GoogleIcon } from '../components/icons';
import { PillButton } from '../components/PillButton';
import { TextField } from '../components/TextField';
import type { SignInScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

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
  const styles = useStyles();
  const { requestCode, verifyCode, signInWithGoogle, state } = useSession();
  const revoked = state.status === 'signedOut' && state.reason === 'revoked';

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
    <AuthFrame>
      {revoked && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>You were signed out on another device.</Text>
        </View>
      )}

      {phase === 'email' ? (
        <>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.hint}>We'll email you a six-digit code. No password needed.</Text>

          {error ? <ErrorBanner message={error} style={styles.error} /> : null}

          <TextField
            style={styles.field}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={send}
          />

          <PillButton
            label="Send code"
            variant="filled"
            size="lg"
            disabled={!canSend}
            onPress={send}
            style={styles.action}
          />

          {Platform.OS !== 'web' && (
            <PillButton
              label="Continue with Google"
              size="lg"
              icon={<GoogleIcon />}
              disabled={pending}
              onPress={continueWithGoogle}
              style={styles.action}
            />
          )}
        </>
      ) : (
        <>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.hint}>We sent a six-digit code to {email.trim()}.</Text>

          {error ? <ErrorBanner message={error} style={styles.error} /> : null}

          <TextField
            style={[styles.field, styles.codeField]}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            accessibilityLabel="Six-digit code"
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={verify}
          />

          <PillButton
            label="Sign in"
            variant="filled"
            size="lg"
            disabled={!canVerify}
            onPress={verify}
            style={styles.action}
          />

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
            hitSlop={4}
            style={[styles.link, styles.firstLink]}>
            <Text style={[styles.linkText, !canResend && styles.linkTextDisabled]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use a different email"
            onPress={startOver}
            hitSlop={4}
            style={[styles.link, styles.lastLink]}>
            <Text style={styles.linkText}>Use a different email</Text>
          </Pressable>
        </>
      )}
    </AuthFrame>
  );
}

// Inside `AuthFrame`'s card. Measured off the two sign-in mockups: the title's capitals 31pt below
// the card's top edge, the field at y 507, each 52pt pill 14pt below the one above.
const useStyles = themedStyles((colors) => ({
  notice: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.bannerSurface,
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
  },
  hint: {
    marginTop: 8,
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  error: {
    marginHorizontal: 0,
    marginTop: spacing.lg,
  },
  field: {
    marginTop: 20,
  },
  // The mockup's digits: the field's own 17pt, 22pt apart. `TextField` resets the spacing to 0 for
  // every other field, since iOS recycles native inputs.
  codeField: {
    textAlign: 'center',
    letterSpacing: 12,
  },
  action: {
    marginTop: 14,
  },
  link: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  firstLink: {
    marginTop: 18,
  },
  lastLink: {
    marginTop: 4,
    marginBottom: 2,
  },
  linkText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
    fontSize: 15.5,
    lineHeight: 22,
  },
  linkTextDisabled: {
    fontFamily: fonts.sans,
    color: colors.textMuted,
  },
}));
