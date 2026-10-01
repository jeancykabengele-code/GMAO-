import { GmaoDataStore } from '../data/gmao-data-store';
import { FuelGePageComponent } from './fuel-ge-page';

describe('FuelGePageComponent', () => {
  it('calcule les litres par heure et la disponibilité Grid depuis les relevés RH', () => {
    const store = new GmaoDataStore();
    store.generatorRows = [
      { site: 'Goma', code: 'GE-001', moisReleve: '2025-12', rhActuel: 200 },
      { site: 'Goma', code: 'GE-001', moisReleve: '2026-01', rhActuel: 224 },
    ];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';
    store.generatorFuelConsumptionRows = [{ site: 'Goma', periode: '2026-01', consommationLitres: 300 }];
    component.newEntry.snelKwh = 4500;

    expect(component.calculatedGeneratorHours).toBe(24);
    expect(component.calculatedLitresPerHour).toBe(12.5);
    expect(component.calculatedGridAvailability).toBeCloseTo(96.77, 2);
  });

  it('fixe la disponibilité à zéro et retire SNEL pour un site hors réseau', () => {
    const access = {
      get profile() { return { permissions: { offGridSites: ['Kikwit'] } }; },
      get allowedSites() { return ['Kikwit']; },
      get canModifyExisting() { return true; },
      get canEnterSiteData() { return true; },
      get canExportData() { return true; },
      get isChefSite() { return false; },
    };
    const store = new GmaoDataStore(access as never);
    store.generatorRows = [
      { site: 'Kikwit', code: 'GE-001', moisReleve: '2025-12', rhActuel: 100 },
      { site: 'Kikwit', code: 'GE-001', moisReleve: '2026-01', rhActuel: 110 },
    ];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Kikwit';
    component.newEntry.periode = '2026-01';
    store.generatorFuelConsumptionRows = [{ site: 'Kikwit', periode: '2026-01', consommationLitres: 100 }];
    component.newEntry.snelKwh = 999;

    expect(component.calculatedGeneratorHours).toBe(10);
    expect(component.calculatedGridAvailability).toBe(0);
    component.changeSite();
    expect(component.newEntry.snelKwh).toBeNull();
  });

  it('affiche Non calculable lorsque la consommation est positive avec zéro heure', () => {
    const store = new GmaoDataStore();
    store.generatorRows = [
      { site: 'Goma', code: 'GE-001', moisReleve: '2025-12', rhActuel: 100 },
      { site: 'Goma', code: 'GE-001', moisReleve: '2026-01', rhActuel: 100 },
    ];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';
    store.generatorFuelConsumptionRows = [{ site: 'Goma', periode: '2026-01', consommationLitres: 150 }];
    expect(component.calculatedLitresPerHour).toBeNull();
  });

  it('arrondit le stock de départ et le kWh SNEL avant de les envoyer', async () => {
    const store = new GmaoDataStore();
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';
    component.newEntry.stockInitial = 0.1 + 0.2; // 0.30000000000000004 in floating point
    component.newEntry.snelKwh = 10 / 3; // 3.3333333333333335 in floating point

    await component.saveEntry();

    expect(component.journalRows).toHaveLength(1);
    expect(component.journalRows[0].stockInitial).toBe(0.3);
    expect(component.journalRows[0].snelKwh).toBe(3.33);
  });

  it('filtre par site et par mois et pagine par 20 lignes', () => {
    const component = new FuelGePageComponent();
    component.journalRows = Array.from({ length: 21 }, (_, index) => ({
      site: index === 20 ? 'Bukavu' : 'Goma', periode: '2026-01', sortie: 20, stockInitial: 120, stockFinal: 100,
      heuresGe: 5, litresHeure: 4, snelKwh: 200, disponibiliteGrid: 99,
    }));

    expect(component.visibleRows).toHaveLength(20);
    expect(component.pageCount).toBe(2);
    component.selectedSite = 'Bukavu';
    component.resetPage();
    expect(component.filteredRows).toHaveLength(1);
  });
});