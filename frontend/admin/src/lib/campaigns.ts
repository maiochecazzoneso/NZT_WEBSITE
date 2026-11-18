import type { Campaign, CampaignKind, CampaignStatus } from '../api/types';

export const KIND_LABEL: Record<CampaignKind, string> = {
  communication: 'Comunicazione di servizio',
  marketing: 'Marketing',
};

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Bozza',
  sending: 'In invio',
  sent: 'Inviata',
};

/** Descrizione del pubblico destinatario, mostrata nella conferma di invio. */
export function describeAudience(campaign: Pick<Campaign, 'kind' | 'product_code'>): string {
  if (campaign.kind === 'marketing') {
    return campaign.product_code
      ? `solo i clienti con consenso marketing (filtro prodotto: ${campaign.product_code})`
      : 'solo i clienti con consenso marketing';
  }
  return campaign.product_code
    ? `tutti i clienti verificati e attivi con diritto attivo su “${campaign.product_code}”`
    : 'tutti i clienti verificati e attivi';
}

export function isSending(campaigns: readonly Pick<Campaign, 'status'>[] | null): boolean {
  return campaigns?.some((c) => c.status === 'sending') ?? false;
}

/** Percentuale di avanzamento (inviate + fallite su destinatari), 0-100. */
export function progressPercent(c: Pick<Campaign, 'recipients' | 'sent' | 'failed'>): number {
  if (c.recipients <= 0) return 0;
  return Math.min(100, Math.round(((c.sent + c.failed) / c.recipients) * 100));
}
