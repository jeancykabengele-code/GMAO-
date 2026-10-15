/** Relevé journalier du PUE de DC Pigeon : équipements du schéma unifilaire et conversions en kW.
 *  Miroir de `gmao/profiles/records/pue.py` : le serveur reste la référence, ce fichier sert à l'aperçu en direct. */

export const PUE_SITE = 'Pigeon';
export const PUE_THRESHOLD = 1.8;
export const COS_PHI = 0.9;
export const AC_VOLTAGE = 400;
const KINSHASA_OFFSET_MINUTES = 60;

export type PueRole = 'it' | 'pdf' | 'cooling' | 'tertiary' | 'total';

export interface PueLine { code: string; label: string; kind: 'ac' | 'dc'; role: PueRole; }
export interface PueInput { kwLus: number | null; a: number | null; v: number | null; cosPhi?: number | null; }
export interface PueLineResult { kw: number | null; origine: 'Lu' | 'Calculé' | ''; ecart: number | null; }
export interface PueSection { title: string; lines: PueLine[]; }

const pdfLines = (kind: 'ac' | 'dc', count: number): PueLine[] =>
  ['a', 'b'].flatMap((voie) => Array.from({ length: count }, (_, index) => ({
    code: `pdf_${kind}_${voie}${index + 1}`,
    label: `PDF ${kind.toUpperCase()} ${voie.toUpperCase()}${index + 1}`,
    kind,
    role: 'pdf' as const,
  })));

export const PUE_SECTIONS: PueSection[] = [
  { title: 'IT — sorties des UPS et des redresseurs', lines: [
    { code: 'ups_a', label: 'UPS A', kind: 'ac', role: 'it' },
    { code: 'ups_b', label: 'UPS B', kind: 'ac', role: 'it' },
    { code: 'redresseurs_a', label: 'Redresseurs A', kind: 'dc', role: 'it' },
    { code: 'redresseurs_b', label: 'Redresseurs B', kind: 'dc', role: 'it' },
  ] },
  { title: 'IT — détail des PDF AC (contrôle)', lines: pdfLines('ac', 2) },
  { title: 'IT — détail des PDF DC (contrôle)', lines: pdfLines('dc', 4) },
  { title: 'Hors IT — climatisation et tertiaire', lines: [
    { code: 'clim_a', label: 'TDBT Climatisation A', kind: 'ac', role: 'cooling' },
    { code: 'clim_b', label: 'TDBT Climatisation B', kind: 'ac', role: 'cooling' },
    { code: 'tertiaire', label: 'ATS Charges tertiaires', kind: 'ac', role: 'tertiary' },
  ] },
  { title: 'Total du site', lines: [
    { code: 'tgbt_a', label: 'TGBT A (MDB A)', kind: 'ac', role: 'total' },
    { code: 'tgbt_b', label: 'TGBT B (MDB B)', kind: 'ac', role: 'total' },
  ] },
];

export const PUE_LINES: PueLine[] = PUE_SECTIONS.flatMap((section) => section.lines);

/** Contrôle : la somme des PDF d'une voie doit rester proche de la sortie de l'UPS ou des redresseurs correspondants. */
export const PUE_CHECKS: Array<{ label: string; output: string; parts: string[] }> = [
  { label: 'UPS A', output: 'ups_a', parts: ['pdf_ac_a1', 'pdf_ac_a2'] },
  { label: 'UPS B', output: 'ups_b', parts: ['pdf_ac_b1', 'pdf_ac_b2'] },
  { label: 'Redresseurs A', output: 'redresseurs_a', parts: ['pdf_dc_a1', 'pdf_dc_a2', 'pdf_dc_a3', 'pdf_dc_a4'] },
  { label: 'Redresseurs B', output: 'redresseurs_b', parts: ['pdf_dc_b1', 'pdf_dc_b2', 'pdf_dc_b3', 'pdf_dc_b4'] },
];

export type PueInputs = Record<string, PueInput>;

export function emptyInputs(): PueInputs {
  return Object.fromEntries(PUE_LINES.map((line) => [line.code, { kwLus: null, a: null, v: null, cosPhi: null }]));
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function kwFromAmps(line: PueLine, amps: number, volts: number, cosPhi: number | null = null): number {
  return line.kind === 'dc' ? (amps * volts) / 1000 : (Math.sqrt(3) * volts * amps * (cosPhi ?? COS_PHI)) / 1000;
}

/** Le cos φ saisi doit être dans ]0 ; 1] ; sinon la valeur par défaut s'applique à l'aperçu (le serveur refuse l'enregistrement). */
const validCosPhi = (value: unknown): number | null => {
  const number = toNumber(value);
  return number !== null && number > 0 && number <= 1 ? number : null;
};

export function isCosPhiInvalid(value: unknown): boolean {
  const number = toNumber(value);
  return number !== null && !(number > 0 && number <= 1);
}

export function computeLine(line: PueLine, input: PueInput | undefined): PueLineResult {
  const kwRead = toNumber(input?.kwLus);
  const amps = toNumber(input?.a);
  const volts = toNumber(input?.v) ?? (line.kind === 'ac' ? AC_VOLTAGE : null);
  const calculated = amps !== null && volts !== null ? kwFromAmps(line, amps, volts, line.kind === 'ac' ? validCosPhi(input?.cosPhi) : null) : null;
  const ecart = kwRead !== null && calculated !== null && calculated > 0
    ? Math.round(((kwRead - calculated) / calculated) * 1000) / 10
    : null;
  if (kwRead !== null) return { kw: kwRead, origine: 'Lu', ecart };
  if (calculated !== null) return { kw: Math.round(calculated * 1000) / 1000, origine: 'Calculé', ecart: null };
  return { kw: null, origine: '', ecart: null };
}

export interface PueSummary { complete: boolean; missing: string[]; itKw: number; totalKw: number; pue: number | null; }

export function summarize(inputs: PueInputs): PueSummary {
  const results = Object.fromEntries(PUE_LINES.map((line) => [line.code, computeLine(line, inputs[line.code])]));
  const missing = PUE_LINES.filter((line) => results[line.code].kw === null).map((line) => line.label);
  const sum = (role: PueRole) => PUE_LINES.filter((line) => line.role === role)
    .reduce((total, line) => total + (results[line.code].kw ?? 0), 0);
  const itKw = sum('it');
  const totalKw = sum('total');
  return { complete: missing.length === 0, missing, itKw, totalKw, pue: itKw > 0 && totalKw >= itKw ? totalKw / itKw : null };
}

/** Heure de Kinshasa (UTC+1, sans heure d'été), quel que soit le fuseau de l'ordinateur. */
export function kinshasaNow(now: Date = new Date()): { date: string; hour: number; minute: number } {
  const local = new Date(now.getTime() + KINSHASA_OFFSET_MINUTES * 60000);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

export interface PueRow {
  id?: string;
  site: string;
  dateReleve: string;
  heureReleve: string;
  mesures: Record<string, Partial<PueInput> & { kw?: number; origine?: string; ecart?: number | null }>;
  itKw: number;
  totalKw: number;
  pue: number;
}

/** Le PUE d'une période est le rapport des sommes, jamais la moyenne des PUE journaliers. */
export function periodPue(rows: Array<Pick<PueRow, 'itKw' | 'totalKw'>>): number {
  const it = rows.reduce((total, row) => total + Number(row.itKw || 0), 0);
  const total = rows.reduce((sum, row) => sum + Number(row.totalKw || 0), 0);
  return it > 0 ? total / it : 0;
}

export function inputsFromRow(row: PueRow): PueInputs {
  const inputs = emptyInputs();
  for (const line of PUE_LINES) {
    const saved = row.mesures?.[line.code];
    if (saved) inputs[line.code] = { kwLus: saved.kwLus ?? null, a: saved.a ?? null, v: saved.v ?? null, cosPhi: saved.cosPhi ?? null };
  }
  return inputs;
}

export function lineLabel(code: string): string {
  return PUE_LINES.find((line) => line.code === code)?.label ?? code;
}
