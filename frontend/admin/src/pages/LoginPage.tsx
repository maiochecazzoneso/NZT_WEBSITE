import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@nzt/ui';
import { describeError } from '../api/errors';
import { session } from '../auth/sessionInstance';
import { useSession } from '../auth/useSession';
import { AuthShell } from '../components/AuthShell';
import { LiveRegion } from '../components/LiveRegion';
import { looksLikeEmail } from '../lib/validation';

const NOTICES = {
  expired: 'La sessione è scaduta. Accedi di nuovo.',
  unavailable:
    'Impossibile verificare la sessione: il server non è raggiungibile. Riprova più tardi.',
} as const;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const { notice } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!looksLikeEmail(email)) errors.email = 'Inserisci un indirizzo email valido.';
    if (password.length === 0) errors.password = 'Inserisci la password.';
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) {
      document.getElementById(errors.email ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setPending(true);
    try {
      await session.login(email.trim(), password);
      // Il cambio di stato della sessione porta alla dashboard.
    } catch (error) {
      setFormError(describeError(error, 'login'));
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Accesso amministratore"
      description="Area riservata al personale NZT Solutions. Gli account clienti non possono accedere qui."
    >
      {notice ? <LiveRegion tone="info" message={NOTICES[notice]} className="mb-6" /> : null}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <Field id="login-email" label="Email" error={fieldErrors.email ?? null}>
          {({ invalid, ...control }) => (
            <Input
              {...control}
              invalid={invalid}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field id="login-password" label="Password" error={fieldErrors.password ?? null}>
          {({ invalid, ...control }) => (
            <Input
              {...control}
              invalid={invalid}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
          {pending ? 'Accesso in corso…' : 'Accedi'}
        </Button>
      </form>
    </AuthShell>
  );
}
