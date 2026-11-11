// src/components/interactive/ContactForm.tsx — Specifica Contenuti §3 Sezione 8
// Modulo validato con Zod (react-hook-form). La select "Su cosa vuoi intervenire?" è sincronizzata in entrambe le
// direzioni con selectedServiceStore: le CTA di servizi e prodotti la preimpostano prima di scorrere qui.
// Invio: l'endpoint email (Resend) arriva allo Step 6. Finché non c'è, a validazione superata il modulo lo
// dichiara apertamente e propone la stessa richiesta come email precompilata: nessun finto "messaggio inviato".
import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useStore } from '@nanostores/react';
import { selectedServiceStore } from '@/lib/stores/uiStore';
import { contactFormCopy, serviceOptions, site, type ServiceId } from '@/content/site';
import { buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const serviceValues = serviceOptions.map((option) => option.value) as [ServiceId, ...ServiceId[]];

const schema = z.object({
  name: z.string().trim().min(2, 'Inserisci nome e cognome.'),
  email: z.string().trim().email('Inserisci un indirizzo email valido.'),
  company: z.string().trim().min(2, 'Indica l’azienda o lo studio.'),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[+\d][\d\s./-]{5,}$/, 'Numero non valido.')
    .optional(),
  service: z.enum(serviceValues),
  // Facoltativo per il nuovo copy: chi scrive poco non va bloccato
  message: z.string().trim().max(4000, 'Testo troppo lungo (massimo 4000 caratteri).'),
});

type FormValues = z.infer<typeof schema>;

const isServiceId = (value: string): value is ServiceId =>
  (serviceValues as string[]).includes(value);

const fieldClass =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[var(--text-subtle)] transition-colors focus:border-[var(--border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 aria-[invalid=true]:border-red-400/60';

interface ContactFormProps {
  /** Servizio preimpostato dalla pagina (es. 'nzt-enterprise' sulla scheda prodotto) */
  defaultService?: ServiceId;
}

export function ContactForm({ defaultService }: ContactFormProps) {
  const uid = useId();
  const storeService = useStore(selectedServiceStore);
  const [mailtoHref, setMailtoHref] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
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

  const onSubmit = (values: FormValues) => {
    // TODO Step 6: POST all'endpoint email (Resend). Fino ad allora: email precompilata con gli stessi dati.
    const serviceLabel =
      serviceOptions.find((option) => option.value === values.service)?.label ?? values.service;
    const body = [
      `Nome e cognome: ${values.name}`,
      `Email: ${values.email}`,
      `Azienda / Studio: ${values.company}`,
      values.phone ? `Telefono: ${values.phone}` : null,
      `Su cosa intervenire: ${serviceLabel}`,
      values.message ? '' : null,
      values.message || null,
    ]
      .filter((line) => line !== null)
      .join('\n');
    const subject = `Richiesta dal sito — ${serviceLabel}`;
    setMailtoHref(
      `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
  };

  const id = (name: string) => `${uid}-${name}`;
  const errorId = (name: keyof FormValues) => (errors[name] ? `${id(name)}-error` : undefined);

  const FieldError = ({ name }: { name: keyof FormValues }) =>
    errors[name] ? (
      <p id={`${id(name)}-error`} className="mt-1.5 text-xs text-red-300">
        {errors[name]?.message}
      </p>
    ) : null;

  if (mailtoHref) {
    return (
      <div className="space-y-5" role="status">
        <p className="font-mono text-xs tracking-widest text-[#FAFAFA] uppercase">
          Richiesta pronta
        </p>
        <p className="leading-relaxed text-[var(--text-muted)]">
          L’invio diretto dal sito sarà attivo al lancio. Nel frattempo abbiamo preparato un’email
          con tutti i dati che hai inserito: aprila e premi invia, ti risponderà un nostro
          ingegnere.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={mailtoHref} className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Apri l’email precompilata
          </a>
          <button
            type="button"
            onClick={() => setMailtoHref(null)}
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
