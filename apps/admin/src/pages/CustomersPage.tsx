import { Card, Field, Input } from '@nzt/ui';
import { Pill } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { SampleLabel, SoonActions, SoonButton, th, thead, tr } from '../components/Preview';
import { formatDate } from '../lib/format';
import { SAMPLE_CUSTOMERS } from '../lib/sampleData';

export function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Clienti"
        description="Cerca i clienti, gestisci i diritti sui prodotti e attiva o disattiva gli account."
      />
      <Card spotlight={false} className="flex flex-col gap-4 p-5 sm:p-5">
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-3"
        >
          <Field id="customer-search" label="Cerca per email" className="min-w-64 flex-1">
            {({ invalid, ...control }) => (
              <Input
                {...control}
                invalid={invalid}
                type="search"
                name="q"
                placeholder="mario@…"
                disabled
              />
            )}
          </Field>
          <SoonActions>
            <SoonButton variant="secondary">Cerca</SoonButton>
          </SoonActions>
        </form>
      </Card>
      <div>
        <SampleLabel />
      </div>
      <Card spotlight={false} className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Elenco clienti (dati di esempio)</caption>
          <thead className={thead}>
            <tr>
              <th scope="col" className={th}>
                Cliente
              </th>
              <th scope="col" className={th}>
                Stato
              </th>
              <th scope="col" className={th}>
                Diritti
              </th>
              <th scope="col" className={th}>
                Registrato
              </th>
              <th scope="col" className={th}>
                Azioni
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CUSTOMERS.map((customer) => (
              <tr key={customer.id} className={`${tr} align-top`}>
                <td className="px-4 py-3 break-all">{customer.email}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Pill tone={customer.is_active ? 'strong' : 'muted'}>
                      {customer.is_active ? 'Attivo' : 'Disattivato'}
                    </Pill>
                    <Pill>{customer.is_verified ? 'Verificato' : 'Non verificato'}</Pill>
                    {customer.marketing_consent ? <Pill>Marketing</Pill> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {customer.entitlements.length === 0 ? (
                    <span className="text-[var(--text-muted)]">Nessuno</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {customer.entitlements.map((e) => (
                        <li key={e.product_code} className="font-mono text-xs">
                          {e.product_code}{' '}
                          <span className="text-[var(--text-muted)]">
                            · {e.is_enabled ? 'abilitato' : 'disabilitato'}
                            {e.valid_until ? ` fino al ${formatDate(e.valid_until)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                  {formatDate(customer.created_at)}
                </td>
                <td className="px-4 py-3">
                  <SoonActions>
                    <SoonButton variant="secondary" size="sm">
                      Diritti
                    </SoonButton>
                    <SoonButton variant="ghost" size="sm">
                      {customer.is_active ? 'Disattiva' : 'Attiva'}
                    </SoonButton>
                  </SoonActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Paginazione" className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">3 di 3 clienti (esempio)</p>
        <SoonActions>
          <SoonButton variant="secondary" size="sm">
            Precedente
          </SoonButton>
          <SoonButton variant="secondary" size="sm">
            Successiva
          </SoonButton>
        </SoonActions>
      </nav>
    </>
  );
}
