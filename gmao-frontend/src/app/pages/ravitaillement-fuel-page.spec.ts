import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { RavitaillementFuelPageComponent } from './ravitaillement-fuel-page';

describe('RavitaillementFuelPageComponent', () => {
  const delivery = (periode: string, rang: number, quantiteRecue = 100) => ({
    id: `${periode}-${rang}`, site: 'Goma', periode, rang, fournisseur: 'X', bonLivraison: 'BL', typeCarburant: 'Diesel',
    quantiteRecue, stockAvant: null, stockApres: null, receptionnePar: 'Agent',
  });
  const page = (rows: unknown[]) => {
    const store = new GmaoDataStore();
    store.fuelDeliveryRows = rows;
    return new RavitaillementFuelPageComponent(store, new ExcelExportService());
  };

  it('propose le premier numéro libre du mois et grise les numéros déjà saisis', () => {
    const component = page([delivery('2026-01', 1), delivery('2026-01', 2)]);
    component.entry.site = 'Goma';
    component.entry.periode = '2026-01';
    component.suggestRank();

    expect(component.isRankTaken(1)).toBe(true);
    expect(component.isRankTaken(3)).toBe(false);
    expect(component.entry.rang).toBe(3);
    expect(component.ranks).toEqual([1, 2, 3, 4, 5]);

    component.entry.periode = '2026-02';
    component.entry.rang = 1;
    component.suggestRank();
    expect(component.entry.rang).toBe(1);
  });

  it("n'exige pas de date et filtre par mois", () => {
    const component = page([delivery('2026-01', 1), delivery('2026-02', 1), delivery('2026-03', 1)]);
    component.fromMonth = '2026-02';
    component.toMonth = '2026-02';
    expect(component.filteredRows.map((row) => row.periode)).toEqual(['2026-02']);
    expect(component.entry.periode).toBe('');
    expect('dateRavitaillement' in component.entry).toBe(false);
  });

  it("garde le numéro d'un ravitaillement en cours de modification disponible", () => {
    const component = page([delivery('2026-01', 2)]);
    component.openEdit(component.rows[0]);
    expect(component.entry.rang).toBe(2);
    expect(component.isRankTaken(2)).toBe(false);
  });
});
