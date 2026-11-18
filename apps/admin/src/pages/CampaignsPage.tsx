import { Card, Field, Input } from '@nzt/ui';
import { Checkbox, Pill, Select, Textarea } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { SampleLabel, SoonActions, SoonButton, th, thead, tr } from '../components/Preview';
import { KIND_LABEL, STATUS_LABEL, describeAudience, progressPercent } from '../lib/campaigns';
import { formatDateTime } from '../lib/format';
import { SAMPLE_CAMPAIGNS, SAMPLE_PRODUCTS } from '../lib/sampleData';

export function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campagne"
        description="Comunicazioni email ai clienti. Prima dell'invio viene mostrato il pubblico destinatario."
      />
      <div>
        <SampleLabel />
      </div>
      <Card spotlight={false} className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Campagne (dati di esempio)</caption>
          <thead className={thead}>
            <tr>
              <th scope="col" className={th}>
                Oggetto
              </th>
              <th scope="col" className={th}>
                Tipo
              </th>
              <th scope="col" className={th}>
                Stato
              </th>
              <th scope="col" className={th}>
                Destinatari / inviate / fallite
              </th>
              <th scope="col" className={th}>
                Creata
              </th>
              <th scope="col" className={th}>
                Azioni
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CAMPAIGNS.map((c) => (
              <tr key={c.id} className={`${tr} align-top`}>
                <td className="px-4 py-3">
                  {c.subject}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Pubblico: {describeAudience(c)}
                  </p>
                </td>
                <td className="px-4 py-3">{KIND_LABEL[c.kind]}</td>
                <td className="px-4 py-3">
                  <Pill tone={c.status === 'draft' ? 'muted' : 'strong'}>
                    {STATUS_LABEL[c.status]}
                  </Pill>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {c.recipients} / {c.sent} / {c.failed}
                  {c.status !== 'draft' ? ` · ${progressPercent(c)}%` : ''}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                  {formatDateTime(c.created_at)}
                </td>
                <td className="px-4 py-3">
                  {c.status === 'draft' ? (
                    <SoonActions>
                      <SoonButton variant="secondary" size="sm">
                        Invia test a me
                      </SoonButton>
                      <SoonButton size="sm">Invia</SoonButton>
                    </SoonActions>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card spotlight={false} className="flex flex-col gap-6" aria-labelledby="campaign-form-title">
        <h2 id="campaign-form-title" className="text-h3 text-[var(--text-primary)]">
          Nuova campagna (bozza)
        </h2>
        <form onSubmit={(event) => event.preventDefault()} className="grid gap-5 sm:grid-cols-2">
          <Field id="c-kind" label="Tipo">
            {({ invalid, ...c }) => (
              <Select {...c} invalid={invalid} defaultValue="communication">
                <option value="communication">{KIND_LABEL.communication}</option>
                <option value="marketing">{KIND_LABEL.marketing}</option>
              </Select>
            )}
          </Field>
          <Field
            id="c-product"
            label="Prodotto (facoltativo)"
            hint="Solo per le comunicazioni: limita il pubblico a chi ha quel diritto attivo."
          >
            {({ invalid, ...c }) => (
              <Select {...c} invalid={invalid} defaultValue="">
                <option value="">Nessuno (tutti i clienti)</option>
                {SAMPLE_PRODUCTS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="c-subject" label="Oggetto" className="sm:col-span-2">
            {({ invalid, ...c }) => <Input {...c} invalid={invalid} />}
          </Field>
          <Field id="c-body" label="Testo" className="sm:col-span-2">
            {({ invalid, ...c }) => <Textarea {...c} invalid={invalid} />}
          </Field>
          <Checkbox
            className="sm:col-span-2"
            label="Ho verificato oggetto, testo e pubblico destinatario (conferma richiesta prima dell'invio)"
            disabled
          />
          <div className="flex items-center sm:col-span-2">
            <SoonActions>
              <SoonButton type="submit">Crea bozza</SoonButton>
            </SoonActions>
          </div>
        </form>
      </Card>
    </>
  );
}
