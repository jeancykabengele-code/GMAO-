import { FICHE_COLUMNS, PueRow, buildFiche, controlChecks, ficheExportRows, pueExportSheets } from './pue-lines';

const line = (kwLus: number | null, a: number | null, v: number | null, cosPhi: number | null, kw: number, origine: string, ecart: number | null = null) =>
  ({ kwLus, a, v, cosPhi, kw, origine, ecart });

/** Un relevé S2 : IT 80 kW (UPS + redresseurs), hors IT 24 kW, total déduit 104 kW. */
function s2Reading(overrides: Partial<PueRow> = {}): PueRow {
  return {
    id: 'r2', site: 'Pigeon', dateReleve: '2026-10-19', heureReleve: '15:30:00', scenario: 'S2',
    itKw: 80, totalKw: 104, pue: 1.3,
    mesures: {
      ups_a: line(30, null, null, null, 30, 'Lu'),
      ups_b: line(null, 28.9, 400, 0.95, 19.03, 'Calculé'),
      redresseurs_a: line(15, 280, 53.5, null, 15, 'Lu', 0.1),
      redresseurs_b: line(15, null, null, null, 15, 'Lu'),
      clim_a: line(10, null, null, null, 10, 'Lu'),
      clim_b: line(10, null, null, null, 10, 'Lu'),
      tertiaire: line(4, null, null, null, 4, 'Lu'),
      avr_a: line(54, null, null, null, 54, 'Lu'),
      avr_b: line(51, null, null, null, 51, 'Lu'),
      pdf_ac_a1: line(14, null, null, null, 14, 'Lu'),
      pdf_ac_a2: line(16, null, null, null, 16, 'Lu'),
    },
    ...overrides,
  };
}

describe('PUE fiche (copy of the entry sheet)', () => {
  it('follows the sheet of its scenario: same sections, in the same order, with every saved column', () => {
    const fiche = buildFiche(s2Reading());
    expect(fiche.scenario).toBe('S2');
    expect(fiche.mainSections.map((section) => section.title)).toEqual([
      'IT — sorties des UPS et des redresseurs',
      'Hors IT — climatisation et charges tertiaires',
    ]);
    expect(fiche.detailSections.map((section) => section.title)).toEqual([
      'Amont — sorties des AVR (régulation de tension)', 'IT — détail des PDF AC', 'IT — détail des PDF DC',
    ]);
    const upsB = fiche.mainSections[0].lines[1];
    expect(upsB).toMatchObject({ label: 'UPS B', kwLus: null, a: 28.9, v: 400, cosPhi: 0.95, kw: 19.03, origine: 'Calculé' });
    // une ligne du scénario que personne n'a renseignée reste affichée, vide, comme sur la feuille
    expect(fiche.detailSections[1].lines).toHaveLength(4);
    expect(fiche.detailSections[1].lines[3]).toMatchObject({ label: 'PDF AC B2', kw: null, origine: '' });
  });

  it('S1 shows the TGBT first and marks the non-IT load as deduced; S2 marks the total', () => {
    const s1 = buildFiche(s2Reading({ scenario: 'S1', mesures: { ...s2Reading().mesures, tgbt_a: line(52, null, null, null, 52, 'Lu'), tgbt_b: line(48, null, null, null, 48, 'Lu') } }));
    expect(s1.mainSections.map((section) => section.title)).toEqual(['Total du site — TGBT', 'IT — sorties des UPS et des redresseurs']);
    expect(s1.deduced).toBe('nonIt');
    expect(buildFiche(s2Reading()).deduced).toBe('total');
    expect(buildFiche(s2Reading()).nonItKw).toBe(24);
  });

  it('a reading from before the scenarios shows only the lines that were entered', () => {
    const legacy = buildFiche(s2Reading({ scenario: '', mesures: { ups_a: line(30, null, null, null, 30, 'Lu'), tgbt_a: line(52, null, null, null, 52, 'Lu') } }));
    expect(legacy.scenario).toBe('');
    expect(legacy.deduced).toBeNull();
    expect(legacy.mainSections.flatMap((section) => section.lines.map((entry) => entry.label))).toEqual(['TGBT A (MDB A)', 'UPS A']);
    expect(legacy.detailSections).toEqual([]);
  });

  it('computes the controls like the sheet: AVR against the total, PDF against the UPS and the rectifiers', () => {
    const checks = buildFiche(s2Reading()).checks;
    expect(checks[0]).toEqual({ label: 'Total site', partsLabel: 'AVR A + B', output: 104, parts: 105, gap: 1 });
    // les 30 kW de PDF AC A correspondent à l'UPS A : 0 %
    expect(checks.find((check) => check.label === 'UPS A')).toMatchObject({ output: 30, parts: 30, gap: 0 });
    // PDF AC B incomplets : pas de contrôle
    expect(checks.find((check) => check.label === 'UPS B')).toMatchObject({ parts: null, gap: null });
    expect(controlChecks(() => null, 0)[0]).toMatchObject({ output: null, gap: null });
  });

  it('flattens the fiche into the rows of the Excel sheet and of the PDF section', () => {
    const rows = ficheExportRows([buildFiche(s2Reading())]);
    expect(rows[0]).toEqual({ kind: 'title', cells: ['Relevé du 19/10/2026 à 15:30 — Scénario S2 — IT et hors IT mesurés, total déduit', ...Array(7).fill(null)] });
    const kinds = rows.map((row) => row.kind);
    expect(kinds.filter((kind) => kind === 'step')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'result')).toHaveLength(4);
    expect(rows.filter((row) => row.cells[0] === 'Total site (kW)')[0].cells.slice(5, 7)).toEqual([104, 'déduit']);
    expect(rows.filter((row) => row.cells[0] === 'PUE du jour')[0].cells.slice(5, 7)).toEqual([1.3, 'seuil 1,8']);
    const upsB = rows.find((row) => row.cells[0] === 'UPS B')!;
    expect(upsB.cells).toEqual(['UPS B', null, 28.9, 400, 0.95, 19.03, 'Calculé', '—']);
    expect(rows.find((row) => row.cells[0] === 'Redresseurs A')!.cells[7]).toBe('0,1 %');
    // les redresseurs sont en continu : pas de cos φ
    expect(rows.find((row) => row.cells[0] === 'Redresseurs A')!.cells[4]).toBe('—');
    expect(rows.find((row) => row.kind === 'check')!.cells[0]).toBe('AVR A + B ↔ Total site : 105 kW pour 104 kW');
  });

  it('puts one fiche per reading in the Details sheet, separated by a blank line', () => {
    const [pue, details] = pueExportSheets([s2Reading(), s2Reading({ id: 'r1', heureReleve: '09:00:00' })]);
    expect(pue.sheetName).toBe('PUE');
    expect(details.sheetName).toBe('Détails');
    expect(details.pdfOrientation).toBe('portrait');
    expect(details.columns.map((column: { header: string }) => column.header)).toEqual(FICHE_COLUMNS);
    const titles = details.rows.filter((row: { kind: string }) => row.kind === 'title');
    expect(titles).toHaveLength(2);
    expect(details.rows.filter((row: { kind: string }) => row.kind === 'spacer')).toHaveLength(1);
  });
});
