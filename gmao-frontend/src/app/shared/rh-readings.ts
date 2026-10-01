export interface RhReading { site?: string; groupeCode?: string; periode?: string; rhActuel?: number | string; }

export interface GroupRhStatus {
  code: string;
  hasCurrent: boolean;
  hasPrevious: boolean;
  /** Heures du mois (relevé du mois - dernier relevé antérieur), ou null si un relevé manque ou si le compteur recule. */
  hours: number | null;
}

/** Même règle que le backend : relevé du mois + dernier relevé antérieur du groupe. */
export function groupRhStatus(readings: RhReading[], site: string, code: string, periode: string): GroupRhStatus {
  const own = readings.filter((row) => row.site === site && row.groupeCode === code && !!row.periode);
  const current = own.find((row) => row.periode === periode);
  const previous = own
    .filter((row) => String(row.periode) < periode)
    .sort((left, right) => String(right.periode).localeCompare(String(left.periode)))[0];
  const hours = current && previous && Number(current.rhActuel) >= Number(previous.rhActuel)
    ? Number(current.rhActuel) - Number(previous.rhActuel)
    : null;
  return { code, hasCurrent: !!current, hasPrevious: !!previous, hours };
}

/** Message expliquant quel relevé RH saisir, ou '' si tout est présent. */
export function rhMissingMessage(status: GroupRhStatus, periode: string): string {
  if (!status.hasCurrent && !status.hasPrevious) return `Relevés RH de ${status.code} manquants pour ${periode} et pour un mois précédent.`;
  if (!status.hasCurrent) return `Relevé RH de ${status.code} manquant pour ${periode}.`;
  if (!status.hasPrevious) return `Relevé RH de ${status.code} manquant pour un mois antérieur à ${periode}.`;
  if (status.hours === null) return `Le compteur RH de ${status.code} est inférieur à celui du relevé précédent.`;
  return '';
}
