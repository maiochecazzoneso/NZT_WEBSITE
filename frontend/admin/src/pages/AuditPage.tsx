import { Card } from '@nzt/ui';
import { PageHeader } from '../components/PageHeader';
import { SampleLabel, SoonActions, SoonButton, th, thead, tr } from '../components/Preview';
import { formatDateTime } from '../lib/format';
import { SAMPLE_AUDIT } from '../lib/sampleData';

export function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Ultime 100 azioni degli amministratori."
        actions={
          <SoonActions>
            <SoonButton variant="secondary" size="sm">
              Aggiorna
            </SoonButton>
          </SoonActions>
        }
      />
      <div>
        <SampleLabel />
      </div>
      <Card spotlight={false} className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            Audit log delle azioni amministrative (dati di esempio)
          </caption>
          <thead className={thead}>
            <tr>
              <th scope="col" className={th}>
                Data
              </th>
              <th scope="col" className={th}>
                Amministratore
              </th>
              <th scope="col" className={th}>
                Azione
              </th>
              <th scope="col" className={th}>
                Destinazione
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_AUDIT.map((entry) => (
              <tr key={`${entry.at}-${entry.target}`} className={tr}>
                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                  {formatDateTime(entry.at)}
                </td>
                <td className="px-4 py-3 break-all">{entry.admin_email}</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                <td className="px-4 py-3 font-mono text-xs break-all text-[var(--text-muted)]">
                  {entry.target}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
