import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner } from '../components/ErrorBanner';
import { GoogleIcon } from '../components/icons';
import { PillButton } from '../components/PillButton';
import { TextField } from '../components/TextField';
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from '../lib/appleSignIn';
import type { SignInScreenProps } from '../navigation/types';
import { useSession, type Result, type SignOutReason } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
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
  const { t } = useLingui();
  const { name: theme } = useTheme();
  const { requestCode, verifyCode, signInWithGoogle, signInWithApple, state } = useSession();

  /** Why this device is here, when it did not choose to be. One line, never two. */
  function noticeFor(reason: SignOutReason): string {
    switch (reason) {
      case 'revoked':
        return t({
          comment: 'Above the sign-in form after this device was signed out from another one. Keep it to one line.',
          message: 'You were signed out on another device.',
        });
      case 'deleted':
        return t({
          comment: 'Above the sign-in form after the account was deleted. Keep it to one line.',
          message: 'Your account was deleted.',
        });
    }
  }
  const notice = state.status === 'signedOut' && state.reason ? noticeFor(state.reason) : null;

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

  const address = email.trim();
  const resend = t({ comment: 'A link under the code field: emails a new code.', message: 'Resend code' });
  const startAgain = t({
    comment: 'A link under the code field: goes back to type a different email address.',
    message: 'Use a different email',
  });

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

  // Google's and Apple's buttons. The guard is what blocks a second press: Apple's native button has
  // no `disabled` prop.
  async function continueWith(signIn: () => Promise<Result>) {
    if (pending) return;

    setPending(true);
    setError(null);

    const { error: failure } = await signIn();

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
      {notice && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      {phase === 'email' ? (
        <>
          <Text style={styles.title}>
            <Trans context="heading" comment="Title of the sign-in screen (heading), above the email field.">
              Sign in
            </Trans>
          </Text>
          <Text style={styles.hint}>
            <Trans comment="Under the sign-in title: how signing in works.">
              We'll email you a six-digit code. No password needed.
            </Trans>
          </Text>

          {error ? <ErrorBanner message={error} style={styles.error} /> : null}

          <TextField
            style={styles.field}
            value={email}
            onChangeText={setEmail}
            placeholder={t({
              comment: 'Placeholder of the email field: an example address. Localize it if your language has a usual example, keeping it a valid address.',
              message: 'you@example.com',
            })}
            accessibilityLabel={t({ comment: 'The label of the email field on the sign-in screen.', message: 'Email address' })}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={send}
          />

          <PillButton
            label={t({
              comment: 'Button: emails a sign-in code to the address typed. A full-width button.',
              message: 'Send code',
            })}
            variant="filled"
            size="lg"
            disabled={!canSend}
            onPress={send}
            style={styles.action}
          />

          {/*
            Apple draws the inside — logo, words in the device's language, font — and `style` may not
            set `backgroundColor` or `borderRadius`. The app picks the type, the colour per resolved
            theme, the corners and the size: the `lg` pill's (task 26 step 1).
          */}
          {Platform.OS === 'ios' && (
            <AppleAuthenticationButton
              buttonType={AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                theme === 'night'
                  ? AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={26}
              accessibilityLabel={t({
                comment:
                  "VoiceOver only: Apple's own sign-in button, whose visible words Apple draws in the device's language. Use Apple's wording for this button.",
                message: 'Continue with Apple',
              })}
              onPress={() => void continueWith(signInWithApple)}
              style={[styles.action, styles.apple]}
            />
          )}

          {Platform.OS !== 'web' && (
            <PillButton
              label={t({
                comment: "Button that signs in with a Google account. Use Google's usual wording for this button.",
                message: 'Continue with Google',
              })}
              size="lg"
              icon={<GoogleIcon />}
              disabled={pending}
              onPress={() => void continueWith(signInWithGoogle)}
              style={styles.action}
            />
          )}
        </>
      ) : (
        <>
          <Text style={styles.title}>
            <Trans comment="Title of the screen where the person types the code that was emailed to them.">
              Check your email
            </Trans>
          </Text>
          <Text style={styles.hint}>
            {t({
              comment: 'Under the title. {address} is the email address the person typed, inserted as typed.',
              message: `We sent a six-digit code to ${address}.`,
            })}
          </Text>

          {error ? <ErrorBanner message={error} style={styles.error} /> : null}

          <TextField
            style={[styles.field, styles.codeField]}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            accessibilityLabel={t({ comment: 'The label of the field where the emailed six-digit code is typed.', message: 'Six-digit code' })}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={verify}
          />

          <PillButton
            label={t({
              context: 'button',
              comment: 'Button (verb) under the code field: signs in with the code typed. A full-width button.',
              message: 'Sign in',
            })}
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
            accessibilityLabel={resend}
            accessibilityState={{ disabled: !canResend }}
            disabled={!canResend}
            onPress={send}
            hitSlop={4}
            style={[styles.link, styles.firstLink]}>
            <Text style={[styles.linkText, !canResend && styles.linkTextDisabled]}>
              {cooldown > 0
                ? t({
                    comment:
                      'A link that is waiting before it can send another code. # is a countdown in seconds; "s" abbreviates seconds.',
                    message: plural(cooldown, { other: 'Resend code in #s' }),
                  })
                : resend}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={startAgain}
            onPress={startOver}
            hitSlop={4}
            style={[styles.link, styles.lastLink]}>
            <Text style={styles.linkText}>{startAgain}</Text>
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
  // The native button has no intrinsic size: without a height it does not appear at all.
  apple: {
    height: 52,
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
