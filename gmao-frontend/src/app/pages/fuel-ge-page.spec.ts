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

  it('fixe la disponibilité à zéro et retire SNEL pour Kikwit et Mbandaka', () => {
    const store = new GmaoDataStore();
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