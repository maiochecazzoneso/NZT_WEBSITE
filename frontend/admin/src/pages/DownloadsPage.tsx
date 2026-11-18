import { Card, Field, Input } from '@nzt/ui';
import { Checkbox, Pill } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { SampleLabel, SoonActions, SoonButton, th, thead, tr } from '../components/Preview';
import { formatDate } from '../lib/format';
import { SAMPLE_PRODUCTS } from '../lib/sampleData';

export function DownloadsPage() {
  return (
    <>
      <PageHeader title="Download" description="Catalogo dei prodotti scaricabili dai clienti." />
      <div>
        <SampleLabel />
      </div>
      <Card spotlight={false} className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Catalogo prodotti (dati di esempio)</caption>
          <thead className={thead}>
            <tr>
              <th scope="col" className={th}>
                Codice
              </th>
              <th scope="col" className={th}>
                Prodotto
              </th>
              <th scope="col" className={th}>
                Versione
              </th>
              <th scope="col" className={th}>
                File nel bucket
              </th>
              <th scope="col" className={th}>
                Stato
              </th>
              <th scope="col" className={th}>
                Creato
              </th>
              <th scope="col" className={th}>
                Azioni
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_PRODUCTS.map((p) => (
              <tr key={p.code} className={`${tr} align-top`}>
                <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.version}</td>
                <td className="px-4 py-3 font-mono text-xs break-all text-[var(--text-muted)]">
                  {p.object_key}
                  <br />
                  sha256: {p.sha256.slice(0, 12)}…
                </td>
                <td className="px-4 py-3">
                  <Pill tone={p.is_active ? 'strong' : 'muted'}>
                    {p.is_active ? 'Attivo' : 'Non attivo'}
                  </Pill>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                  {formatDate(p.created_at)}
                </td>
                <td className="px-4 py-3">
                  <SoonActions>
                    <SoonButton variant="secondary" size="sm">
                      Modifica
                    </SoonButton>
                  </SoonActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card spotlight={false} className="flex flex-col gap-6" aria-labelledby="product-form-title">
        <div className="flex flex-col gap-2">
          <h2 id="product-form-title" className="text-h3 text-[var(--text-primary)]">
            Aggiungi o aggiorna un prodotto
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Il file deve essere già stato caricato nel bucket: qui si registra solo la voce di
            catalogo (l'upload dal pannello arriverà in una fase successiva). Un codice esistente
            viene aggiornato.
          </p>
        </div>
        <form onSubmit={(event) => event.preventDefault()} className="grid gap-5 sm:grid-cols-2">
          <Field id="p-code" label="Codice" hint="2-64 caratteri: minuscole, cifre, underscore.">
            {({ invalid, ...c }) => <Input {...c} invalid={invalid} placeholder="launcher_core" />}
          </Field>
          <Field id="p-name" label="Nome">
            {({ invalid, ...c }) => <Input {...c} invalid={invalid} placeholder="NZT Launcher" />}
          </Field>
          <Field id="p-version" label="Versione">
            {({ invalid, ...c }) => <Input {...c} invalid={invalid} placeholder="1.2.0" />}
          </Field>
          <Field id="p-filename" label="Nome file">
            {({ invalid, ...c }) => (
              <Input {...c} invalid={invalid} placeholder="NZT-Launcher.exe" />
            )}
          </Field>
          <Field
            id="p-key"
            label="Percorso nel bucket"
            hint="Inizia con binaries/; solo lettere, cifre e . _ / -"
            className="sm:col-span-2"
          >
            {({ invalid, ...c }) => (
              <Input
                {...c}
                invalid={invalid}
                placeholder="binaries/launcher/1.2.0/NZT-Launcher.exe"
              />
            )}
          </Field>
          <Field
            id="p-sha"
            label="SHA-256"
            hint="64 caratteri esadecimali minuscoli."
            className="sm:col-span-2"
          >
            {({ invalid, ...c }) => <Input {...c} invalid={invalid} className="font-mono" />}
          </Field>
          <Checkbox label="Prodotto attivo (scaricabile dai clienti)" defaultChecked />
          <div className="flex items-center sm:col-span-2">
            <SoonActions>
              <SoonButton type="submit">Salva prodotto</SoonButton>
            </SoonActions>
          </div>
        </form>
      </Card>
    </>
  );
}
