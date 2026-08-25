import { FuelGePageComponent } from './fuel-ge-page';

describe('FuelGePageComponent', () => {
  it('calcule automatiquement les litres par heure et la disponibilité Grid', async () => {
    const component = new FuelGePageComponent();
    component.newEntry.site = 'Goma';
    component.newEntry.periode = '2026-01';
    component.newEntry.sortie = 300;
    component.newEntry.heuresGe = 24;
    component.newEntry.snelKwh = 4500;

    expect(component.calculatedLitresPerHour).toBe(12.5);
    expect(component.calculatedGridAvailability).toBeCloseTo(96.77, 2);
    await component.saveEntry();
    expect(component.journalRows[0].litresHeure).toBe(12.5);
  });

  it('fixe la disponibilité à zéro et retire SNEL pour Kikwit et Mbandaka', async () => {
    const component = new FuelGePageComponent();
    component.newEntry.site = 'Kikwit';
    component.newEntry.periode = '2026-01';
    component.newEntry.sortie = 100;
    component.newEntry.heuresGe = 10;
    component.newEntry.snelKwh = 999;

    expect(component.calculatedGridAvailability).toBe(0);
    await component.saveEntry();
    expect(component.journalRows[0].snelKwh).toBeNull();
    expect(component.journalRows[0].disponibiliteGrid).toBe(0);
  });

  it('affiche Non calculable lorsque la consommation est positive avec zéro heure', () => {
    const component = new FuelGePageComponent();
    component.newEntry.sortie = 150;
    component.newEntry.heuresGe = 0;
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