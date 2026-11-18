// src/components/interactive/ContactForm.tsx — Specifica Contenuti §3 Sezione 8
// Modulo validato con Zod (react-hook-form). La select "Su cosa vuoi intervenire?" è sincronizzata in entrambe le
// direzioni con selectedServiceStore: le CTA di servizi e prodotti la preimpostano prima di scorrere qui.
// Invio: POST a /api/contact (Resend), protetto da Cloudflare Turnstile + honeypot + rate limit lato server.
// Se il server non può inviare (configurazione mancante, Resend giù, rete assente) il modulo lo dichiara
// apertamente e propone la stessa richiesta come email precompilata: nessun finto "messaggio inviato".
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useStore } from '@nanostores/react';
import { PUBLIC_TURNSTILE_SITE_KEY } from 'astro:env/client';
import { selectedServiceStore } from '@/lib/stores/uiStore';
import { contactFormCopy, serviceOptions, site, type ServiceId } from '@/content/site';
import {
  contactSchema,
  serviceLabel,
  serviceValues,
  type ContactValues,
} from '@/lib/contact-schema';
import { TURNSTILE_CONTACT_ACTION } from '@/lib/turnstile';
import { buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { Turnstile, type TurnstileHandle } from './Turnstile';
import type { ContactResponse } from '@/pages/api/contact';

type FormValues = ContactValues;

const isServiceId = (value: string): value is ServiceId =>
  (serviceValues as string[]).includes(value);

const buildMailto = (values: FormValues) => {
  const label = serviceLabel(values.service);
  const body = [
    `Nome e cognome: ${values.name}`,
    `Email: ${values.email}`,
    `Azienda / Studio: ${values.company}`,
    values.phone ? `Telefono: ${values.phone}` : null,
    `Su cosa intervenire: ${label}`,
    values.message ? '' : null,
    values.message || null,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const subject = `Richiesta dal sito — ${label}`;
  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

type Outcome = { kind: 'sent' } | { kind: 'fallback'; href: string; reason: string };

const fieldClass =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[var(--text-subtle)] transition-colors focus:border-[var(--border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 aria-[invalid=true]:border-red-400/60';

interface ContactFormProps {
  /** Servizio preimpostato dalla pagina (es. 'nzt-enterprise' sulla scheda prodotto) */
  defaultService?: ServiceId;
}

export function ContactForm({ defaultService }: ContactFormProps) {
  const uid = useId();
  const storeService = useStore(selectedServiceStore);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: '',
      email: '',
      company: '',
      phone: '',
      service: defaultService ?? 'generale',
      message: '',
    },
  });

  // La pagina prodotto parte con il proprio servizio, salvo scelta già fatta dall'utente
  useEffect(() => {
    if (defaultService && selectedServiceStore.get() === 'generale') {
      selectedServiceStore.set(defaultService);
    }
  }, [defaultService]);

  // Store → select (CTA cliccate prima o dopo l'idratazione)
  useEffect(() => {
    if (isServiceId(storeService)) setValue('service', storeService);
  }, [storeService, setValue]);

  const serviceField = register('service', {
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
      selectedServiceStore.set(event.target.value),
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);

    if (PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken) {
      if (turnstileFailed) {
        // Cloudflare irraggiungibile (rete, blocco script): non lasciamo l'utente senza via d'uscita
        setOutcome({
          kind: 'fallback',
          href: buildMailto(values),
          reason: 'Non siamo riusciti a completare la verifica anti-bot dal tuo browser.',
        });
      } else {
        setFormError('Attendi un istante: stiamo completando la verifica anti-bot, poi riprova.');
      }
      return;
    }

    let result: ContactResponse;
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          turnstileToken: turnstileToken ?? undefined,
          website: honeypotRef.current?.value || undefined,
        }),
      });
      result = (await res.json()) as ContactResponse;
    } catch {
      result = { ok: false, error: 'unavailable' };
    } finally {
      // Il token Turnstile è monouso, anche quando l'invio fallisce
      turnstileRef.current?.reset();
    }

    if (result.ok) {
      setOutcome({ kind: 'sent' });
      return;
    }

    switch (result.error) {
      case 'captcha':
        setFormError('La verifica anti-bot non è andata a buon fine. Riprova tra qualche secondo.');
        break;
      case 'invalid':
        setFormError('Alcuni dati non sono validi. Controlla i campi e riprova.');
        break;
      case 'rate_limited':
        setOutcome({
          kind: 'fallback',
          href: buildMailto(values),
          reason: 'Hai inviato diverse richieste in pochi minuti.',
        });
        break;
      default:
        setOutcome({
          kind: 'fallback',
          href: buildMailto(values),
          reason: 'In questo momento l’invio diretto dal sito non è disponibile.',
        });
    }
  };

  const id = (name: string) => `${uid}-${name}`;
  const errorId = (name: keyof FormValues) => (errors[name] ? `${id(name)}-error` : undefined);

  const FieldError = ({ name }: { name: keyof FormValues }) =>
    errors[name] ? (
      <p id={`${id(name)}-error`} className="mt-1.5 text-xs text-red-300">
        {errors[name]?.message}
      </p>
    ) : null;

  if (outcome?.kind === 'sent') {
    return (
      <div className="space-y-5" role="status">
        <p className="font-mono text-xs tracking-widest text-[#FAFAFA] uppercase">
          Richiesta inviata
        </p>
        <p className="leading-relaxed text-[var(--text-muted)]">
          Grazie, abbiamo ricevuto la tua richiesta. Ti risponderà un nostro ingegnere all’indirizzo
          email che hai indicato.
        </p>
      </div>
    );
  }

  if (outcome?.kind === 'fallback') {
    return (
      <div className="space-y-5" role="status">
        <p className="font-mono text-xs tracking-widest text-[#FAFAFA] uppercase">
          Richiesta pronta
        </p>
        <p className="leading-relaxed text-[var(--text-muted)]">
          {outcome.reason} Abbiamo preparato un’email con tutti i dati che hai inserito: aprila e
          premi invia, ti risponderà un nostro ingegnere.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={outcome.href} className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Apri l’email precompilata
          </a>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className={buttonVariants({ variant: 'ghost', size: 'md' })}
          >
            Modifica i dati
          </button>
        </div>
        <p className="text-xs text-[var(--text-subtle)]">
          Oppure scrivici a{' '}
          <a href={`mailto:${site.email}`} className="text-[var(--text-muted)] underline">
            {site.email}
          </a>
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Honeypot: invisibile e fuori dal tab order, lo compilano solo i bot */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={id('website')}>Sito web</label>
        <input
          ref={honeypotRef}
          id={id('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={id('name')} className="mb-1.5 block text-sm text-[#FAFAFA]">
            Nome e Cognome
          </label>
          <input
            id={id('name')}
            type="text"
            autoComplete="name"
            aria-invalid={errors.name ? 'true' : 'false'}
            aria-describedby={errorId('name')}
            className={fieldClass}
            {...register('name')}
          />
          <FieldError name="name" />
        </div>
        <div>
          <label htmlFor={id('email')} className="mb-1.5 block text-sm text-[#FAFAFA]">
            Email Aziendale
          </label>
          <input
            id={id('email')}
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? 'true' : 'false'}
            aria-describedby={errorId('email')}
            className={fieldClass}
            {...register('email')}
          />
          <FieldError name="email" />
        </div>
        <div>
          <label htmlFor={id('company')} className="mb-1.5 block text-sm text-[#FAFAFA]">
            {contactFormCopy.companyLabel}
          </label>
          <input
            id={id('company')}
            type="text"
            autoComplete="organization"
            aria-invalid={errors.company ? 'true' : 'false'}
            aria-describedby={errorId('company')}
            className={fieldClass}
            {...register('company')}
          />
          <FieldError name="company" />
        </div>
        <div>
          <label htmlFor={id('phone')} className="mb-1.5 block text-sm text-[#FAFAFA]">
            Telefono{' '}
            <span className="text-[var(--text-subtle)]">({contactFormCopy.phoneHint})</span>
          </label>
          <input
            id={id('phone')}
            type="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? 'true' : 'false'}
            aria-describedby={errorId('phone')}
            className={fieldClass}
            {...register('phone')}
          />
          <FieldError name="phone" />
        </div>
      </div>

      <div>
        <label htmlFor={id('service')} className="mb-1.5 block text-sm text-[#FAFAFA]">
          {contactFormCopy.serviceLabel}
        </label>
        <select id={id('service')} className={cn(fieldClass, 'appearance-auto')} {...serviceField}>
          {serviceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('message')} className="mb-1.5 block text-sm text-[#FAFAFA]">
          {contactFormCopy.messageLabel}{' '}
          <span className="text-[var(--text-subtle)]">(opzionale)</span>
        </label>
        <textarea
          id={id('message')}
          rows={5}
          placeholder={contactFormCopy.messagePlaceholder}
          aria-invalid={errors.message ? 'true' : 'false'}
          aria-describedby={errorId('message')}
          className={cn(fieldClass, 'resize-y')}
          {...register('message')}
        />
        <FieldError name="message" />
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
        Inviando la richiesta dichiari di aver letto la{' '}
        <a href="/privacy-policy" className="text-[var(--text-muted)] underline">
          Privacy Policy
        </a>
        . Useremo i tuoi dati solo per rispondere a questa richiesta.
      </p>

      {PUBLIC_TURNSTILE_SITE_KEY && (
        <Turnstile
          ref={turnstileRef}
          siteKey={PUBLIC_TURNSTILE_SITE_KEY}
          action={TURNSTILE_CONTACT_ACTION}
          onToken={(token) => {
            setTurnstileToken(token);
            if (token) {
              setTurnstileFailed(false);
              setFormError(null);
            }
          }}
          onError={() => setTurnstileFailed(true)}
        />
      )}

      {formError && (
        <p role="alert" className="text-sm text-red-300">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={buttonVariants({
          variant: 'primary',
          size: 'lg',
          className: 'w-full sm:w-auto',
        })}
      >
        {contactFormCopy.submitLabel}
      </button>
    </form>
  );
}
