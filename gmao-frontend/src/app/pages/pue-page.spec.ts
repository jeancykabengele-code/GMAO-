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

  it('checks each AVR against the TGBT of its voie without changing the PUE', () => {
    const component = new PuePageComponent();
    fillAllLines(component, { avr_a: 55, avr_b: 50 });
    const [avrA, avrB] = component.checks;
    expect(avrA).toMatchObject({ label: 'AVR A', partsLabel: 'TGBT A', output: 55, parts: 52 });
    expect(avrA.gap).toBeCloseTo(-5.5, 1);
    expect(avrB).toMatchObject({ label: 'AVR B', output: 50, parts: 48, gap: -4 });
    expect(summarize(component.inputs)).toMatchObject({ itKw: 80, pue: 1.25 });
  });

  it('keeps the read kW as the retained value and reports the gap with the calculation', () => {
    const dc = PUE_LINES.find((line) => line.code === 'redresseurs_a')!;
    expect(computeLine(dc, { kwLus: 55, a: 1000, v: 50 })).toEqual({ kw: 55, origine: 'Lu', ecart: 10 });
    expect(computeLine(dc, { kwLus: null, a: 1000, v: null }).kw).toBeNull();
  });

  it('deduces the IT from the total minus cooling and tertiary, and computes the PUE', () => {
    expect(summarize(emptyInputs()).complete).toBe(false);
    const component = new PuePageComponent();
    fillAllLines(component);
    expect(summarize(component.inputs)).toMatchObject({ complete: true, totalKw: 100, nonItKw: 20, itKw: 80, pue: 1.25 });
    component.inputs['tgbt_a'].kwLus = 10;
    component.inputs['tgbt_b'].kwLus = 10;
    expect(summarize(component.inputs).pue).toBeNull();
  });

  it('needs only the main lines; UPS, rectifiers and PDF are optional controls of the deduced IT', () => {
    const inputs = emptyInputs();
    for (const [code, kw] of Object.entries({ tgbt_a: 52, tgbt_b: 48, clim_a: 8, clim_b: 8, tertiaire: 4 })) inputs[code].kwLus = kw;
    expect(summarize(inputs)).toMatchObject({ complete: true, itKw: 80, pue: 1.25, itReadKw: null, itGap: null });

    for (const [code, kw] of Object.entries({ ups_a: 30, ups_b: 20, redresseurs_a: 15, redresseurs_b: 20 })) inputs[code].kwLus = kw;
    // IT lu 85 kW pour 80 kW déduits : +6,3 %, sans effet sur le PUE
    expect(summarize(inputs)).toMatchObject({ pue: 1.25, itReadKw: 85, itGap: 6.3 });
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
