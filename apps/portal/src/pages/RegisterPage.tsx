import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@nzt/ui';
import { describeError } from '../api/errors';
import { session } from '../auth/sessionInstance';
import { AuthShell } from '../components/AuthShell';
import { LiveRegion } from '../components/LiveRegion';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_RULES,
  looksLikeEmail,
  passwordPolicyViolations,
} from '../lib/passwordPolicy';
import { Link } from '../lib/router';

interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
}

function PasswordRules({ password }: { password: string }) {
  const violations = new Set(passwordPolicyViolations(password));
  return (
    <ul className="flex flex-col gap-1">
      {PASSWORD_RULES.map(({ rule, label }) => {
        const ok = password.length > 0 && !violations.has(rule);
        return (
          <li key={rule} className={ok ? 'text-[var(--text-primary)]' : undefined}>
            <span aria-hidden="true" className="inline-block w-4 font-mono">
              {ok ? '✓' : '·'}
            </span>
            {label}
            <span className="sr-only">
              {ok ? ': requisito soddisfatto' : ': non ancora soddisfatto'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!looksLikeEmail(email)) errors.email = 'Inserisci un indirizzo email valido.';
    const violations = passwordPolicyViolations(password);
    if (violations.includes('maxLength')) {
      errors.password = `La password può contenere al massimo ${PASSWORD_MAX_LENGTH} caratteri.`;
    } else if (violations.length > 0) {
      errors.password = 'La password non rispetta tutti i requisiti indicati.';
    }
    if (confirm !== password) errors.confirm = 'Le due password non coincidono.';
    setFieldErrors(errors);
    setFormError(null);
    const first = errors.email
      ? 'reg-email'
      : errors.password
        ? 'reg-password'
        : errors.confirm
          ? 'reg-confirm'
          : null;
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setPending(true);
    try {
      await session.register(email.trim(), password);
    } catch (error) {
      setFormError(describeError(error, 'register'));
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Crea un account"
      footer={
        <>
          Hai già un account?{' '}
          <Link
            to="/accedi"
            className="font-medium text-[var(--text-primary)] underline underline-offset-4"
          >
            Accedi
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <Field id="reg-email" label="Email" error={fieldErrors.email ?? null}>
          {({ invalid, ...control }) => (
            <Input
              {...control}
              invalid={invalid}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field
          id="reg-password"
          label="Password"
          hint={<PasswordRules password={password} />}
          error={fieldErrors.password ?? null}
        >
          {({ invalid, ...control }) => (
            <Input
              {...control}
              invalid={invalid}
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field id="reg-confirm" label="Conferma password" error={fieldErrors.confirm ?? null}>
          {({ invalid, ...control }) => (
            <Input
              {...control}
              invalid={invalid}
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          )}
        </Field>
        <LiveRegion message={formError} />
        <Button
          type="submit"
          className="w-full"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? 'Creazione in corso…' : 'Crea account'}
        </Button>
      </form>
    </AuthShell>
  );
}
