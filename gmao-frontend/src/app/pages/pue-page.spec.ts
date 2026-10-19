import { GmaoDataStore } from '../data/gmao-data-store';
import { PuePageComponent } from './pue-page';
import { PUE_LINES, PueRow, computeLine, emptyInputs, kinshasaNow, periodPue, summarize } from './pue-lines';

/** Un relevé complet en kW lus : total = 100 kW, hors IT = 20 kW, donc IT déduit = 80 kW. */
function fillAllLines(component: PuePageComponent, overrides: Record<string, number> = {}): void {
  const kw: Record<string, number> = { ups_a: 30, ups_b: 20, redresseurs_a: 15, redresseurs_b: 15, tgbt_a: 52, tgbt_b: 48, clim_a: 8, clim_b: 8, tertiaire: 4 };
  for (const line of PUE_LINES) component.inputs[line.code].kwLus = overrides[line.code] ?? kw[line.code] ?? 5;
}

function row(dateReleve: string, itKw: number, totalKw: number): PueRow {
  return { site: 'Pigeon', dateReleve, heureReleve: '11:00:00', mesures: {}, itKw, totalKw, pue: Math.round((totalKw / itKw) * 1000) / 1000 };
}

describe('PUE lines', () => {
  it('lists the 23 equipments of the single line diagram', () => {
    expect(PUE_LINES).toHaveLength(23);
    expect(new Set(PUE_LINES.map((line) => line.code)).size).toBe(23);
  });

  it('converts DC with V x A and AC with the three-phase formula', () => {
    const dc = PUE_LINES.find((line) => line.code === 'redresseurs_a')!;
    const ac = PUE_LINES.find((line) => line.code === 'ups_a')!;
    expect(computeLine(dc, { kwLus: null, a: 1000, v: 53.5 })).toMatchObject({ kw: 53.5, origine: 'Calculé' });
    expect(computeLine(ac, { kwLus: null, a: 700, v: null }).kw).toBeCloseTo(436.477, 3);
    expect(computeLine(ac, { kwLus: null, a: 100, v: 230 }).kw).toBeCloseTo(35.853, 3);
    // cos φ lu sur l'équipement : √3 × 400 × 700 × 0,95 ÷ 1000
    expect(computeLine(ac, { kwLus: null, a: 700, v: null, cosPhi: 0.95 }).kw).toBeCloseTo(460.726, 3);
    // cos φ hors de ]0 ; 1] : l'aperçu retombe sur 0,9 et le formulaire refuse l'enregistrement
    expect(computeLine(ac, { kwLus: null, a: 700, v: null, cosPhi: 1.5 }).kw).toBeCloseTo(436.477, 3);
    // le cos φ n'a pas de sens en continu
    expect(computeLine(dc, { kwLus: null, a: 1000, v: 53.5, cosPhi: 0.5 }).kw).toBe(53.5);
  });

  it('checks the sum of the AVR against the total of the site without changing the PUE', () => {
    const component = new PuePageComponent();
    fillAllLines(component, { avr_a: 55, avr_b: 50 });
    const [avrCheck] = component.checks;
    // total du site 100 kW pour 105 kW en sortie des AVR : +5 %
    expect(avrCheck).toMatchObject({ label: 'Total site', partsLabel: 'AVR A + B', output: 100, parts: 105, gap: 5 });
    expect(summarize(component.inputs, 'S1')).toMatchObject({ itKw: 80, pue: 1.25 });
    expect(summarize(component.inputs, 'S2')).toMatchObject({ itKw: 80, pue: 1.25 });
  });

  it('keeps the read kW as the retained value and reports the gap with the calculation', () => {
    const dc = PUE_LINES.find((line) => line.code === 'redresseurs_a')!;
    expect(computeLine(dc, { kwLus: 55, a: 1000, v: 50 })).toEqual({ kw: 55, origine: 'Lu', ecart: 10 });
    expect(computeLine(dc, { kwLus: null, a: 1000, v: null }).kw).toBeNull();
  });

  it('S1 measures the TGBT and the IT and deduces the non-IT load', () => {
    expect(summarize(emptyInputs(), 'S1').complete).toBe(false);
    const component = new PuePageComponent();
    fillAllLines(component);
    expect(summarize(component.inputs, 'S1')).toMatchObject({ complete: true, totalKw: 100, itKw: 80, nonItKw: 20, pue: 1.25 });
    // l'IT ne peut pas dépasser le total mesuré aux TGBT
    component.inputs['tgbt_a'].kwLus = 10;
    component.inputs['tgbt_b'].kwLus = 10;
    expect(summarize(component.inputs, 'S1').pue).toBeNull();
  });

  it('S2 measures the IT and the non-IT load and deduces the total of the site', () => {
    const component = new PuePageComponent();
    fillAllLines(component, { tgbt_a: 999 });
    // 80 kW d'IT + (8 + 8 + 4) kW hors IT = 100 kW ; les TGBT ne comptent pas
    expect(summarize(component.inputs, 'S2')).toMatchObject({ complete: true, totalKw: 100, itKw: 80, nonItKw: 20, pue: 1.25 });
    component.inputs['clim_a'].kwLus = 18;
    expect(summarize(component.inputs, 'S2')).toMatchObject({ totalKw: 110, pue: 1.375 });
  });

  it('asks only for the lines of the chosen scenario', () => {
    const s1 = emptyInputs();
    for (const [code, kw] of Object.entries({ tgbt_a: 52, tgbt_b: 48, ups_a: 30, ups_b: 20, redresseurs_a: 15, redresseurs_b: 15 })) s1[code].kwLus = kw;
    expect(summarize(s1, 'S1')).toMatchObject({ complete: true, pue: 1.25 });
    expect(summarize(s1, 'S2').missing).toEqual(['TDBT Climatisation A', 'TDBT Climatisation B', 'Charges tertiaires']);

    const s2 = emptyInputs();
    for (const [code, kw] of Object.entries({ ups_a: 30, ups_b: 20, redresseurs_a: 15, redresseurs_b: 15, clim_a: 8, clim_b: 8, tertiaire: 4 })) s2[code].kwLus = kw;
    expect(summarize(s2, 'S2')).toMatchObject({ complete: true, pue: 1.25 });
    expect(summarize(s2, 'S1').missing).toEqual(['TGBT A (MDB A)', 'TGBT B (MDB B)']);
  });

  it('shows the lines of the chosen scenario and keeps the same details for both', () => {
    const component = new PuePageComponent();
    const codes = (scenario: 'S1' | 'S2') => { component.scenario = scenario; return component.mainSections.flatMap((section) => section.lines.map((line) => line.code)); };
    expect(codes('S1')).toEqual(['tgbt_a', 'tgbt_b', 'ups_a', 'ups_b', 'redresseurs_a', 'redresseurs_b']);
    expect(codes('S2')).toEqual(['ups_a', 'ups_b', 'redresseurs_a', 'redresseurs_b', 'clim_a', 'clim_b', 'tertiaire']);
    expect(component.detailSections.flatMap((section) => section.lines.map((line) => line.code))).toHaveLength(14);
  });

  it('uses the Kinshasa clock (UTC+1) to decide the day of the reading', () => {
    expect(kinshasaNow(new Date('2026-10-12T23:30:00Z')).date).toBe('2026-10-13');
    expect(kinshasaNow(new Date('2026-10-12T22:59:00Z')).date).toBe('2026-10-12');
  });

  it('computes the period PUE as a ratio of sums, not as the mean of daily PUE', () => {
    // 1,5 (100 kW IT) et 2,0 (10 kW IT) : moyenne simple 1,75, rapport des sommes 170 / 110 = 1,545
    expect(periodPue([row('2026-01-01', 100, 150), row('2026-01-02', 10, 20)])).toBeCloseTo(1.5454, 3);
  });
});

describe('PuePageComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('sends only the site and the inputs; the server decides date, time and PUE', async () => {
    const store = new GmaoDataStore();
    const create = vi.spyOn(store, 'createRecord');
    const component = new PuePageComponent(store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:30:00Z'));
    component.openSheet();
    fillAllLines(component);

    await component.saveEntry();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][1] as { site: string; mesures: Record<string, unknown>; pue?: number };
    expect(payload.site).toBe('Pigeon');
    expect((payload as { scenario?: string }).scenario).toBe('S1');
    expect(Object.keys(payload.mesures)).toHaveLength(23);
    expect(payload.pue).toBeUndefined();
  });

  it('refuses an incomplete reading and accepts it once complete, at any hour', async () => {
    const store = new GmaoDataStore();
    const create = vi.spyOn(store, 'createRecord');
    const component = new PuePageComponent(store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:30:00Z'));
    component.openSheet();
    fillAllLines(component);
    component.inputs['tgbt_b'].kwLus = null;
    await component.saveEntry();
    expect(component.saveError).toContain('TGBT B');

    expect(create).not.toHaveBeenCalled();

    fillAllLines(component);
    vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
    expect(component.canSubmit).toBe(true);
    await component.saveEntry();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('filters by period, shows missing days and computes the period PUE and retained days', () => {
    const store = new GmaoDataStore();
    store.pueRows = [row('2026-01-26', 100, 150), row('2026-01-28', 100, 170), row('2026-03-01', 100, 190)];
    const component = new PuePageComponent(store);

    expect(component.pueRows).toHaveLength(3);
    component.dateFrom = '2026-01-25';
    component.dateTo = '2026-02-20';

    expect(component.filteredRows.map((entry) => entry.dateReleve)).toEqual(['2026-01-28', '2026-01-26']);
    expect(component.retainedDays).toBe(2);
    expect(component.periodDays).toBe(27);
    expect(component.periodPue).toBeCloseTo(1.6, 6);
    expect(component.calendarRows.filter((day) => !day.row)).toHaveLength(25);
    expect(component.calendarRows.find((day) => day.date === '2026-01-27')?.row).toBeNull();
    expect(component.pageCount).toBe(2);
  });

  it('lists every reading of a day, latest first, and keeps a single missing line for empty days', () => {
    const store = new GmaoDataStore();
    store.pueRows = [
      { ...row('2026-01-26', 100, 150), heureReleve: '09:00:00', id: 'a' },
      { ...row('2026-01-26', 100, 160), heureReleve: '15:30:00', id: 'b' },
      { ...row('2026-01-28', 100, 170), id: 'c' },
    ];
    const component = new PuePageComponent(store);
    expect(component.pueRows.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);

    component.dateFrom = '2026-01-26';
    component.dateTo = '2026-01-28';
    // la journée du 26 commence par sa synthèse ; le 27 est manquant
    expect(component.calendarRows.map((day) => day.summary ? 'summary' : day.row?.id ?? null))
      .toEqual(['c', null, 'summary', 'b', 'a']);
    expect(component.periodDays).toBe(3);
    expect(component.retainedDays).toBe(2);
  });

  it('computes the PUE of a day as the ratio of sums, not the mean of the PUE', () => {
    const store = new GmaoDataStore();
    store.pueRows = [
      { ...row('2026-01-26', 100, 150), heureReleve: '09:00:00', id: 'a' },
      { ...row('2026-01-26', 10, 20), heureReleve: '15:00:00', id: 'b' },
    ];
    const component = new PuePageComponent(store);
    const summary = component.calendarRows.find((day) => day.summary)!.summary!;
    // PUE 1,5 et 2,0 : moyenne simple 1,75 ; rapport des sommes 170 ÷ 110
    expect(summary.pue).toBeCloseTo(1.5454, 3);
    expect(summary).toMatchObject({ count: 2, itKw: 55, totalKw: 85, nonItKw: 30 });
  });

  it('shows the optional details of each reading, with dashes for lines that were not read', () => {
    const store = new GmaoDataStore();
    const kw = (value: number) => ({ kw: value });
    store.pueRows = [
      { ...row('2026-01-26', 80, 100), id: 'full', mesures: {
        avr_a: kw(55), ups_a: kw(30), ups_b: kw(20), redresseurs_a: kw(15), redresseurs_b: kw(20),
        pdf_ac_a1: kw(10), pdf_ac_a2: kw(18),
      } },
      { ...row('2026-01-25', 80, 100), id: 'main-only', mesures: { tgbt_a: kw(52) } },
    ];
    const component = new PuePageComponent(store);
    const [full, mainOnly] = component.pueRows;

    expect(component.lineKw(full, 'avr_a')).toBe(55);
    expect(component.lineKw(full, 'avr_b')).toBeNull();
    expect(component.pdfSum(full, ['pdf_ac_a1', 'pdf_ac_a2'])).toBe(28);
    expect(component.pdfSum(full, ['pdf_ac_b1', 'pdf_ac_b2'])).toBeNull();

    expect(component.lineKw(mainOnly, 'ups_a')).toBeNull();
  });

  it('switches between the summary and the details tabs and paginates each one', () => {
    const store = new GmaoDataStore();
    store.pueRows = Array.from({ length: 25 }, (_, index) => ({ ...row(`2026-02-${String(index + 1).padStart(2, '0')}`, 80, 100), id: `r${index}` }));
    const component = new PuePageComponent(store);
    expect(component.view).toBe('synthese');
    component.currentPage = 2;
    component.setView('details');
    expect(component.view).toBe('details');
    expect(component.currentPage).toBe(1);
    expect(component.pageCount).toBe(2);
    expect(component.visibleDetailRows).toHaveLength(20);
  });

  it('updates and deletes a reading after confirmation', async () => {
    const store = new GmaoDataStore();
    store.pueRows = [row('2026-01-26', 100, 150)];
    const component = new PuePageComponent(store);
    const update = vi.spyOn(store, 'updateRecord');

    component.editEntry(component.pueRows[0]);
    expect(component.sheetTitle).toContain('26/01/2026');
    fillAllLines(component);
    await component.saveEntry();
    expect(update).toHaveBeenCalledTimes(1);

    component.editEntry(component.pueRows[0]);
    component.requestDeletion();
    expect(component.deleteConfirmationOpen).toBe(true);
    await component.deleteEntry();
    expect(component.pueRows).toHaveLength(0);
  });

  it('lets the site manager of Pigeon correct a reading but not delete it', async () => {
    const access = { allowedSites: ['Pigeon'], currentSite: 'Pigeon', canModifyExisting: false, isChefSite: true, canEnterSiteData: true, canExportData: true };
    const store = new GmaoDataStore(access as never);
    store.pueRows = [{ ...row('2026-01-26', 100, 150), id: 'pue-1' }];
    const component = new PuePageComponent(store);
    expect(component.canModify).toBe(true);
    expect(component.canDelete).toBe(false);

    component.editEntry(component.pueRows[0]);
    fillAllLines(component);
    await component.saveEntry();
    expect(Object.keys(component.pueRows[0].mesures)).toHaveLength(23);

    component.editEntry(component.pueRows[0]);
    component.requestDeletion();
    expect(component.deleteConfirmationOpen).toBe(false);
  });

  it('derives the non-IT load of a day as total minus IT', () => {
    const component = new PuePageComponent();
    expect(component.nonItKw(row('2026-01-26', 80, 100))).toBe(20);
    expect(component.nonItKw(row('2026-01-27', 82.4, 150.25))).toBe(67.85);
  });

  it('evaluates the 1.8 threshold', () => {
    const component = new PuePageComponent();
    expect(component.getState(1.75)).toBe('≤ 1,8');
    expect(component.getState(1.81)).toBe('> 1,8');
  });
});
