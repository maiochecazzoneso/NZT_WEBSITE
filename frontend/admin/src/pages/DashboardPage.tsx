import { Card } from '@nzt/ui';
import { BarChart } from '../components/BarChart';
import { PageHeader } from '../components/PageHeader';
import { SampleLabel, SoonActions, SoonButton } from '../components/Preview';
import { formatNumber, productShares } from '../lib/stats';
import { SAMPLE_STATS as data } from '../lib/sampleData';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card spotlight={false} className="flex flex-col gap-1 p-5 sm:p-5">
      <p className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className="text-3xl font-medium tracking-tight text-[var(--text-primary)]">
        {formatNumber(value)}
      </p>
    </Card>
  );
}

export function DashboardPage() {
  const shares = productShares(data.downloads_by_product);
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Panoramica di utenti, download e campagne."
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
      <section
        aria-label="Statistiche (dati di esempio)"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <StatCard label="Utenti" value={data.users_total} />
        <StatCard label="Verificati" value={data.users_verified} />
        <StatCard label="Nuovi 7 giorni" value={data.users_new_7d} />
        <StatCard label="Nuovi 30 giorni" value={data.users_new_30d} />
        <StatCard label="Consensi marketing" value={data.marketing_consents} />
        <StatCard label="Download totali" value={data.downloads_total} />
        <StatCard label="Download 7 giorni" value={data.downloads_7d} />
        <StatCard label="Campagne inviate" value={data.campaigns_sent} />
      </section>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card spotlight={false} className="flex flex-col gap-4" aria-labelledby="chart-title">
          <h2 id="chart-title" className="text-h3 text-[var(--text-primary)]">
            Download per giorno
          </h2>
          <p className="text-xs text-[var(--text-muted)]">Ultimi 14 giorni · dati di esempio.</p>
          <BarChart points={data.downloads_per_day} label="Download (esempio)" />
        </Card>
        <Card spotlight={false} className="flex flex-col gap-4" aria-labelledby="by-product">
          <h2 id="by-product" className="text-h3 text-[var(--text-primary)]">
            Download per prodotto
          </h2>
          <ul className="flex flex-col gap-3">
            {shares.map((item) => (
              <li key={item.product_code} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-mono break-all text-[var(--text-primary)]">
                    {item.product_code}
                  </span>
                  <span className="text-[var(--text-muted)]">{formatNumber(item.count)}</span>
                </div>
                <svg
                  viewBox="0 0 100 4"
                  preserveAspectRatio="none"
                  className="h-1.5 w-full text-white"
                  aria-hidden="true"
                >
                  <rect width="100" height="4" fill="currentColor" fillOpacity="0.1" />
                  <rect width={item.percent} height="4" fill="currentColor" fillOpacity="0.85" />
                </svg>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
