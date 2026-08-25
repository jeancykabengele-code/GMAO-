import { PuePageComponent } from './pue-page';

describe('PuePageComponent', () => {
  it('calculates the PUE, saves the row and evaluates the 1.8 threshold', () => {
    const component = new PuePageComponent();
    component.newEntry.site = 'Goma';
    component.newEntry.mois = '2026-08';
    component.newEntry.energieIt = 100;
    component.newEntry.energieTotale = 175;

    component.saveEntry();

    expect(component.pueRows).toHaveLength(1);
    expect(component.pueRows[0].pue).toBe(1.75);
    expect(component.getState(component.pueRows[0].pue)).toBe('\u2264 1,8');
    expect(component.getState(1.81)).toBe('> 1,8');
  });

  it('filters rows by site and month', () => {
    const component = new PuePageComponent();

    component.newEntry = {
      site: 'Bukavu',
      mois: '2026-07',
      energieIt: 100,
      energieTotale: 170,
      pue: 0,
    };
    component.saveEntry();

    component.newEntry = {
      site: 'Utex',
      mois: '2026-08',
      energieIt: 100,
      energieTotale: 190,
      pue: 0,
    };
    component.saveEntry();

    component.selectedSite = 'Bukavu';
    expect(component.filteredRows).toHaveLength(1);
    expect(component.filteredRows[0].mois).toBe('2026-07');

    component.selectedSite = '';
    component.selectedMonth = '2026-08';
    expect(component.filteredRows).toHaveLength(1);
    expect(component.filteredRows[0].site).toBe('Utex');
  });

  it('updates and paginates while deletion remains forbidden PUE rows', () => {
    const component = new PuePageComponent();
    const makeRow = (index: number) => ({
      site: 'Mtc',
      mois: `2026-${String((index % 12) + 1).padStart(2, '0')}`,
      energieIt: 100,
      energieTotale: 180,
      pue: 1.8,
    });
    component.pueRows = Array.from({ length: 21 }, (_, index) => makeRow(index));

    expect(component.pageCount).toBe(2);
    expect(component.visibleRows.filter(Boolean)).toHaveLength(20);
    component.nextPage();
    expect(component.currentPage).toBe(2);

    const row = component.pueRows[0];
    component.editEntry(row);
    component.newEntry.energieTotale = 160;
    component.saveEntry();
    expect(component.pueRows[0].pue).toBe(1.6);

    component.deleteEntry(component.pueRows[0]);
    expect(component.pueRows).toHaveLength(21);
  });
});