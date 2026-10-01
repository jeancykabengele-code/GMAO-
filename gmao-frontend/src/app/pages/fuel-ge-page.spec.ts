import { GmaoDataStore } from '../data/gmao-data-store';
import { FuelGePageComponent } from './fuel-ge-page';

describe('FuelGePageComponent', () => {
  it('calcule les litres par heure et la disponibilité Grid depuis les relevés RH', () => {
    const store = new GmaoDataStore();
    store.generatorRows = [{ site: 'Goma', code: 'GE-001' }];
    store.generatorReadingRows = [
      { site: 'Goma', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 200 },
      { site: 'Goma', groupeCode: 'GE-001', periode: '2026-01', rhActuel: 224 },
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
    store.generatorRows = [{ site: 'Kikwit', code: 'GE-001' }];
    store.generatorReadingRows = [
      { site: 'Kikwit', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 100 },
      { site: 'Kikwit', groupeCode: 'GE-001', periode: '2026-01', rhActuel: 110 },
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

  it('considère le mois le plus ancien du site comme mois de départ', () => {
    const store = new GmaoDataStore();
    store.fuelRows = [{ id: 'jan', site: 'Goma', periode: '2026-01' }] as never;
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';

    component.newEntry.periode = '2025-12';
    expect(component.isInitialFuelMonth).toBe(true);
    expect(component.replacedStartMonth).toBe('2026-01');

    component.newEntry.periode = '2026-02';
    expect(component.isInitialFuelMonth).toBe(false);
    expect(component.replacedStartMonth).toBeNull();
  });

  it('liste les relevés RH manquants et bloque tant que le mois ou le précédent manque', () => {
    const store = new GmaoDataStore();
    store.fuelRows = [{ id: 'dec', site: 'Goma', periode: '2025-12' }] as never;
    store.generatorRows = [{ site: 'Goma', code: 'GE-001' }, { site: 'Goma', code: 'GE-002' }];
    store.generatorReadingRows = [
      { site: 'Goma', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 100 },
      { site: 'Goma', groupeCode: 'GE-001', periode: '2026-01', rhActuel: 120 },
    ];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';

    expect(component.missingPrerequisites).toEqual(['Relevés RH de GE-002 manquants pour 2026-01 et pour un mois précédent.']);
    expect(component.calculatedGeneratorHours).toBeNull();

    store.generatorReadingRows = [
      ...store.generatorReadingRows,
      { site: 'Goma', groupeCode: 'GE-002', periode: '2025-12', rhActuel: 10 },
      { site: 'Goma', groupeCode: 'GE-002', periode: '2026-01', rhActuel: 15 },
    ];
    expect(component.missingPrerequisites).toEqual([]);
    expect(component.calculatedGeneratorHours).toBe(25);
    expect(component.groupsWithoutConsumption).toEqual(['GE-001', 'GE-002']);
  });

  it('exige un relevé antérieur pour les mois suivants quand on ajoute un mois plus ancien', () => {
    const store = new GmaoDataStore();
    store.fuelRows = [{ id: 'dec', site: 'Goma', periode: '2025-12' }] as never;
    store.generatorRows = [{ site: 'Goma', code: 'GE-001' }];
    store.generatorReadingRows = [{ site: 'Goma', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 100 }];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2025-11';

    expect(component.missingPrerequisites).toEqual([
      'Relevé RH de GE-001 manquant pour un mois antérieur à 2025-12. (le journal 2025-12 en dépend)',
    ]);

    store.generatorReadingRows = [
      { site: 'Goma', groupeCode: 'GE-001', periode: '2025-11', rhActuel: 80 },
      { site: 'Goma', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 100 },
    ];
    expect(component.missingPrerequisites).toEqual([]);
  });

  it("n'exige pas de relevés RH pour le premier mois sans consommation", () => {
    const store = new GmaoDataStore();
    store.generatorRows = [{ site: 'Goma', code: 'GE-001' }];
    const component = new FuelGePageComponent(store);
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';
    expect(component.missingPrerequisites).toEqual([]);
  });

  it('affiche Non calculable lorsque la consommation est positive avec zéro heure', () => {
    const store = new GmaoDataStore();
    store.generatorRows = [{ site: 'Goma', code: 'GE-001' }];
    store.generatorReadingRows = [
      { site: 'Goma', groupeCode: 'GE-001', periode: '2025-12', rhActuel: 100 },
      { site: 'Goma', groupeCode: 'GE-001', periode: '2026-01', rhActuel: 100 },
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