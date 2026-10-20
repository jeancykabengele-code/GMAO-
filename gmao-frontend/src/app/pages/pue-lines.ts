/** Relevé du PUE de DC Pigeon : équipements du schéma unifilaire et conversions en kW.
 *  PUE = total site ÷ IT. Deux scénarios de saisie :
 *   - S1 : TGBT A + B et IT (UPS + redresseurs) mesurés ; le hors IT se déduit (total − IT) ;
 *   - S2 : IT (UPS + redresseurs) et hors IT (climatisation + charges tertiaires) mesurés ; le total se déduit (IT + hors IT).
 *  AVR et PDF sont facultatifs et identiques dans les deux scénarios : ils servent à contrôler les mesures.
 *  Miroir de `gmao/profiles/records/pue.py` : le serveur reste la référence, ce fichier sert à l'aperçu en direct. */

import type { ExcelSheetExport, ExportRowKind } from '../shared/excel-export.service';

export const PUE_SITE = 'Pigeon';
export const PUE_THRESHOLD = 1.8;
export const COS_PHI = 0.9;
export const AC_VOLTAGE = 400;
const KINSHASA_OFFSET_MINUTES = 60;

export type PueRole = 'avr' | 'it' | 'pdf' | 'cooling' | 'tertiary' | 'total';

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

export type PueScenario = 'S1' | 'S2';

export const PUE_SCENARIOS: Array<{ code: PueScenario; title: string; measured: string; deduced: string }> = [
  { code: 'S1', title: 'S1 — TGBT et IT', measured: 'TGBT A + B et IT', deduced: 'Hors IT' },
  { code: 'S2', title: 'S2 — IT et hors IT', measured: 'IT et hors IT', deduced: 'Total site' },
];

const TOTAL_SECTION: PueSection = { title: 'Total du site — TGBT', lines: [
  { code: 'tgbt_a', label: 'TGBT A (MDB A)', kind: 'ac', role: 'total' },
  { code: 'tgbt_b', label: 'TGBT B (MDB B)', kind: 'ac', role: 'total' },
] };

const IT_SECTION: PueSection = { title: 'IT — sorties des UPS et des redresseurs', lines: [
  { code: 'ups_a', label: 'UPS A', kind: 'ac', role: 'it' },
  { code: 'ups_b', label: 'UPS B', kind: 'ac', role: 'it' },
  { code: 'redresseurs_a', label: 'Redresseurs A', kind: 'dc', role: 'it' },
  { code: 'redresseurs_b', label: 'Redresseurs B', kind: 'dc', role: 'it' },
] };

const NON_IT_SECTION: PueSection = { title: 'Hors IT — climatisation et charges tertiaires', lines: [
  { code: 'clim_a', label: 'TDBT Climatisation A', kind: 'ac', role: 'cooling' },
  { code: 'clim_b', label: 'TDBT Climatisation B', kind: 'ac', role: 'cooling' },
  { code: 'tertiaire', label: 'Charges tertiaires', kind: 'ac', role: 'tertiary' },
] };

/** Toutes les sections de mesures principales, pour afficher un relevé d'avant les scénarios. */
export const PUE_ALL_MAIN_SECTIONS: PueSection[] = [TOTAL_SECTION, IT_SECTION, NON_IT_SECTION];

/** Mesures à saisir selon le scénario. */
export const PUE_MAIN_SECTIONS: Record<PueScenario, PueSection[]> = {
  S1: [TOTAL_SECTION, IT_SECTION],
  S2: [IT_SECTION, NON_IT_SECTION],
};

/** Détails facultatifs, identiques dans les deux scénarios. */
const AVR_SECTION: PueSection = { title: 'Amont — sorties des AVR (régulation de tension)', lines: [
  { code: 'avr_a', label: 'AVR A', kind: 'ac', role: 'avr' },
  { code: 'avr_b', label: 'AVR B', kind: 'ac', role: 'avr' },
] };

export const PUE_DETAIL_SECTIONS: PueSection[] = [
  AVR_SECTION,
  { title: 'IT — détail des PDF AC', lines: pdfLines('ac', 2) },
  { title: 'IT — détail des PDF DC', lines: pdfLines('dc', 4) },
];

export const PUE_LINES: PueLine[] = [
  ...AVR_SECTION.lines, ...IT_SECTION.lines,
  ...PUE_DETAIL_SECTIONS.slice(1).flatMap((section) => section.lines),
  ...NON_IT_SECTION.lines, ...TOTAL_SECTION.lines,
];

/** Équipements dont la mesure est obligatoire selon le scénario. */
export const PUE_REQUIRED: Record<PueScenario, Set<string>> = {
  S1: new Set(PUE_MAIN_SECTIONS.S1.flatMap((section) => section.lines.map((line) => line.code))),
  S2: new Set(PUE_MAIN_SECTIONS.S2.flatMap((section) => section.lines.map((line) => line.code))),
};

/** Lignes affichées dans le scénario (mesures principales + détails) : les autres ne sont pas envoyées. */
export function visibleCodes(scenario: PueScenario): Set<string> {
  return new Set([...PUE_MAIN_SECTIONS[scenario], ...PUE_DETAIL_SECTIONS].flatMap((section) => section.lines.map((line) => line.code)));
}

/** Colonnes du tableau « Détails » : AVR, UPS et redresseurs un par un ; les PDF sont additionnés par voie. */
export const PUE_TABLE_LINES: PueLine[] = [...AVR_SECTION.lines, ...IT_SECTION.lines];

/** Colonnes de somme des PDF par voie, pour le tableau des détails. */
export const PUE_PDF_GROUPS: Array<{ label: string; codes: string[] }> = [
  { label: 'PDF AC A', codes: ['pdf_ac_a1', 'pdf_ac_a2'] },
  { label: 'PDF AC B', codes: ['pdf_ac_b1', 'pdf_ac_b2'] },
  { label: 'PDF DC A', codes: ['pdf_dc_a1', 'pdf_dc_a2', 'pdf_dc_a3', 'pdf_dc_a4'] },
  { label: 'PDF DC B', codes: ['pdf_dc_b1', 'pdf_dc_b2', 'pdf_dc_b3', 'pdf_dc_b4'] },
];

/** Contrôle : la somme des PDF d'une voie doit rester proche de la sortie de l'UPS ou des redresseurs correspondants. */
export const PUE_CHECKS: Array<{ label: string; partsLabel: string; output: string; parts: string[] }> = [
  { label: 'UPS A', partsLabel: 'Somme des PDF', output: 'ups_a', parts: ['pdf_ac_a1', 'pdf_ac_a2'] },
  { label: 'UPS B', partsLabel: 'Somme des PDF', output: 'ups_b', parts: ['pdf_ac_b1', 'pdf_ac_b2'] },
  { label: 'Redresseurs A', partsLabel: 'Somme des PDF', output: 'redresseurs_a', parts: ['pdf_dc_a1', 'pdf_dc_a2', 'pdf_dc_a3', 'pdf_dc_a4'] },
  { label: 'Redresseurs B', partsLabel: 'Somme des PDF', output: 'redresseurs_b', parts: ['pdf_dc_b1', 'pdf_dc_b2', 'pdf_dc_b3', 'pdf_dc_b4'] },
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

export interface PueSummary {
  complete: boolean;
  missing: string[];
  /** Total site : TGBT A + B (S1) ou IT + hors IT (S2). */
  totalKw: number;
  /** Hors IT : total − IT (S1) ou climatisation + charges tertiaires (S2). */
  nonItKw: number;
  /** IT : UPS + redresseurs. */
  itKw: number;
  pue: number | null;
}

export function summarize(inputs: PueInputs, scenario: PueScenario): PueSummary {
  const results = Object.fromEntries(PUE_LINES.map((line) => [line.code, computeLine(line, inputs[line.code])]));
  const required = PUE_LINES.filter((line) => PUE_REQUIRED[scenario].has(line.code));
  const missing = required.filter((line) => results[line.code].kw === null).map((line) => line.label);
  const sum = (role: PueRole) => PUE_LINES.filter((line) => line.role === role)
    .reduce((total, line) => total + (results[line.code].kw ?? 0), 0);
  const itKw = sum('it');
  const measuredTotal = sum('total');
  const totalKw = scenario === 'S1' ? measuredTotal : itKw + sum('cooling') + sum('tertiary');
  const nonItKw = scenario === 'S1' ? totalKw - itKw : sum('cooling') + sum('tertiary');
  // S1 : l'IT ne peut pas dépasser le total mesuré aux TGBT.
  const consistent = itKw > 0 && totalKw > 0 && (scenario === 'S2' || itKw <= totalKw);
  return { complete: missing.length === 0, missing, totalKw, nonItKw, itKw, pue: consistent ? totalKw / itKw : null };
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
  scenario?: PueScenario | '';
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

/** Hors IT d'un relevé = total site − IT. */
export const nonItKw = (row: Pick<PueRow, 'itKw' | 'totalKw'>): number =>
  Math.round((Number(row.totalKw) - Number(row.itKw)) * 1000) / 1000;

/** kW retenus d'un équipement dans un relevé ; null si la ligne n'a pas été renseignée (ou n'existait pas encore). */
export function lineKw(row: PueRow, code: string): number | null {
  const value = row.mesures?.[code]?.kw;
  return typeof value === 'number' ? value : null;
}

export const pueState = (pue: number): string => (pue <= PUE_THRESHOLD ? '≤ 1,8' : '> 1,8');

// ---------------------------------------------------------------------------------------------------------------------
// Fiche d'un relevé : copie fidèle de la feuille de saisie (mêmes sections, mêmes colonnes, mêmes résultats et contrôles).
// Sert à l'onglet « Détails » de la page PUE et à la feuille / section « Détails » des exports Excel et PDF.
// ---------------------------------------------------------------------------------------------------------------------

export interface FicheLine {
  label: string;
  kind: 'ac' | 'dc';
  kwLus: number | null;
  a: number | null;
  v: number | null;
  cosPhi: number | null;
  kw: number | null;
  origine: string;
  ecart: number | null;
}
export interface FicheSection { title: string; lines: FicheLine[]; }
export interface FicheCheck { label: string; partsLabel: string; output: number | null; parts: number | null; gap: number | null; }

export interface Fiche {
  row: PueRow;
  date: string;
  heure: string;
  scenario: PueScenario | '';
  mainSections: FicheSection[];
  detailSections: FicheSection[];
  totalKw: number;
  nonItKw: number;
  itKw: number;
  pue: number;
  /** Ce qui a été déduit et non mesuré : le hors IT (S1) ou le total site (S2). */
  deduced: 'nonIt' | 'total' | null;
  checks: FicheCheck[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Contrôles de la feuille : somme des AVR ↔ total du site, somme des PDF ↔ sortie des UPS et des redresseurs. */
export function controlChecks(kwOf: (code: string) => number | null, totalKw: number): FicheCheck[] {
  const sumOf = (codes: string[]): number | null => {
    const values = codes.map(kwOf);
    return values.some((value) => value === null) ? null : values.reduce((sum: number, value) => sum + (value ?? 0), 0);
  };
  const gapOf = (parts: number | null, output: number | null): number | null =>
    output !== null && parts !== null && output > 0 ? round1(((parts - output) / output) * 100) : null;

  // Les AVR alimentent les TGBT : leur somme doit rester proche du total du site (l'écart correspond aux pertes).
  const total = totalKw > 0 ? totalKw : null;
  const avrParts = sumOf(['avr_a', 'avr_b']);
  const checks: FicheCheck[] = [{ label: 'Total site', partsLabel: 'AVR A + B', output: total, parts: avrParts, gap: gapOf(avrParts, total) }];
  for (const check of PUE_CHECKS) {
    const output = kwOf(check.output);
    const parts = sumOf(check.parts);
    checks.push({ label: check.label, partsLabel: check.partsLabel, output, parts, gap: gapOf(parts, output) });
  }
  return checks;
}

const FICHE_SCENARIO_LABELS: Record<PueScenario, string> = {
  S1: 'Scénario S1 — TGBT et IT mesurés, hors IT déduit',
  S2: 'Scénario S2 — IT et hors IT mesurés, total déduit',
};

export function ficheScenarioLabel(scenario: PueScenario | ''): string {
  return scenario ? FICHE_SCENARIO_LABELS[scenario] : 'Relevé antérieur aux scénarios';
}

export function buildFiche(row: PueRow): Fiche {
  const scenario: PueScenario | '' = row.scenario === 'S1' || row.scenario === 'S2' ? row.scenario : '';
  const toLine = (line: PueLine): FicheLine => {
    const saved = row.mesures?.[line.code];
    return {
      label: line.label,
      kind: line.kind,
      kwLus: toNumber(saved?.kwLus),
      a: toNumber(saved?.a),
      v: toNumber(saved?.v),
      cosPhi: toNumber(saved?.cosPhi),
      kw: typeof saved?.kw === 'number' ? saved.kw : null,
      origine: saved?.origine ?? '',
      ecart: typeof saved?.ecart === 'number' ? saved.ecart : null,
    };
  };
  // Un relevé d'avant les scénarios n'a pas de feuille de référence : on n'affiche que les lignes qui ont été saisies.
  const sections = (definitions: PueSection[]): FicheSection[] => definitions
    .map((section) => ({ title: section.title, lines: section.lines.map(toLine).filter((line) => scenario || line.kw !== null) }))
    .filter((section) => section.lines.length);
  const kwOf = (code: string): number | null => {
    const kw = row.mesures?.[code]?.kw;
    return typeof kw === 'number' ? kw : null;
  };
  return {
    row,
    date: row.dateReleve,
    heure: row.heureReleve?.slice(0, 5) ?? '',
    scenario,
    mainSections: sections(scenario ? PUE_MAIN_SECTIONS[scenario] : PUE_ALL_MAIN_SECTIONS),
    detailSections: sections(PUE_DETAIL_SECTIONS),
    totalKw: Number(row.totalKw),
    nonItKw: nonItKw(row),
    itKw: Number(row.itKw),
    pue: Number(row.pue),
    deduced: scenario === 'S1' ? 'nonIt' : scenario === 'S2' ? 'total' : null,
    checks: controlChecks(kwOf, Number(row.totalKw)),
  };
}

// ---- Mise à plat d'une fiche en lignes de tableau, pour les exports Excel et PDF ----

export interface FicheExportRow { kind: ExportRowKind; cells: Array<string | number | null>; }

export const FICHE_COLUMNS = ['Équipement', 'kW lus', 'A', 'V', 'cos φ', 'kW retenus', 'Origine', 'Écart'];

const frNumber = (value: number, digits = 1): string =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value);
const frDate = (iso: string): string => iso.split('-').reverse().join('/');

export function ficheExportRows(fiches: Fiche[]): FicheExportRow[] {
  const blank = (count: number) => Array.from({ length: count }, () => null);
  const rows: FicheExportRow[] = [];
  const text = (kind: ExportRowKind, label: string) => rows.push({ kind, cells: [label, ...blank(FICHE_COLUMNS.length - 1)] });
  const sectionRows = (sections: FicheSection[]) => {
    for (const section of sections) {
      text('section', section.title);
      for (const line of section.lines) {
        rows.push({ kind: 'line', cells: [
          line.label, line.kwLus, line.a, line.v, line.kind === 'ac' ? line.cosPhi : '—',
          line.kw, line.origine || '—', line.ecart !== null ? `${frNumber(line.ecart)} %` : '—',
        ] });
      }
    }
  };

  fiches.forEach((fiche, index) => {
    if (index > 0) text('spacer', '');
    text('title', `Relevé du ${frDate(fiche.date)} à ${fiche.heure} — ${ficheScenarioLabel(fiche.scenario)}`);

    text('step', '1 — Mesures principales');
    sectionRows(fiche.mainSections);

    text('step', '2 — Résultat du jour');
    const result = (label: string, value: number, digits: number, status: string) =>
      rows.push({ kind: 'result', cells: [label, '', '', '', '', Math.round(value * 10 ** digits) / 10 ** digits, status, ''] });
    result('Total site (kW)', fiche.totalKw, 1, fiche.deduced === 'total' ? 'déduit' : 'mesuré');
    result('Hors IT (kW)', fiche.nonItKw, 1, fiche.deduced === 'nonIt' ? 'déduit' : 'mesuré');
    result('IT (kW)', fiche.itKw, 1, 'mesuré');
    result('PUE du jour', fiche.pue, 3, `seuil ${frNumber(PUE_THRESHOLD)}`);

    text('step', '3 — Détails et contrôles');
    sectionRows(fiche.detailSections);
    text('section', 'Contrôles');
    for (const check of fiche.checks) {
      const detail = check.gap === null || check.parts === null || check.output === null
        ? '—'
        : `${frNumber(check.parts)} kW pour ${frNumber(check.output)} kW`;
      rows.push({ kind: 'check', cells: [`${check.partsLabel} ↔ ${check.label} : ${detail}`, ...blank(6), check.gap !== null ? `${frNumber(check.gap)} %` : '—'] });
    }
  });
  return rows;
}

/** Classeur d'export du PUE : une feuille « PUE » (synthèse) et une feuille « Détails » (une fiche par relevé). Utilisé par la page PUE et par Documentations. */
export function pueExportSheets(rows: PueRow[]): Array<ExcelSheetExport<any>> {
  const common = [
    { header: 'Date', value: (row: PueRow) => row.dateReleve },
    { header: 'Heure', value: (row: PueRow) => row.heureReleve?.slice(0, 5) },
    { header: 'Scénario', value: (row: PueRow) => row.scenario || '' },
  ];
  return [
    {
      title: `Suivi du PUE — ${PUE_SITE}`,
      sheetName: 'PUE',
      pdfOrientation: 'portrait',
      rows,
      columns: [
        ...common,
        { header: 'IT (kW)', value: (row: PueRow) => row.itKw },
        { header: 'Hors IT (kW)', value: (row: PueRow) => nonItKw(row) },
        { header: 'Total site (kW)', value: (row: PueRow) => row.totalKw },
        { header: 'PUE', value: (row: PueRow) => row.pue },
        { header: 'État', value: (row: PueRow) => pueState(row.pue) },
      ],
    },
    {
      title: `Détails du PUE — ${PUE_SITE} (fiches de relevé)`,
      sheetName: 'Détails',
      pdfOrientation: 'portrait',
      rows: ficheExportRows(rows.map(buildFiche)),
      columns: FICHE_COLUMNS.map((header, index) => ({ header, value: (row: FicheExportRow) => row.cells[index] })),
      rowKind: (row: FicheExportRow) => row.kind,
    },
  ];
}
