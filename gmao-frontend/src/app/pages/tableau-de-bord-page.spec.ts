import { GmaoDataStore } from '../data/gmao-data-store';
import { TableauDeBordPageComponent } from './tableau-de-bord-page';

describe('TableauDeBordPageComponent', () => {
  it('shows zero values when all corresponding tables are empty', () => {
    const component = new TableauDeBordPageComponent(new GmaoDataStore());

    expect(component.equipmentTotal).toBe(0);
    expect(component.ticketTotal).toBe(0);
    expect(component.generatorTotal).toBe(0);
    expect(component.problemTotal).toBe(0);
    expect(component.latestGridAvailability).toBe(0);
    expect(component.latestFuelStock).toBe(0);
    expect(component.latestPue).toBe(0);
    expect(component.pieBackground(component.ticketItems)).toBe('#d4d4d8');
  });

  it('calculates pie KPIs only from their corresponding tables', () => {
    const store = new GmaoDataStore();
    store.equipmentRows = [{ etat: 'En service' }, { etat: 'En panne' }];
    store.ticketRows = [{ nature: 'PM' }, { nature: 'PM' }, { nature: 'Incident' }];
    store.generatorRows = [{ site: 'Goma', code: 'GE-1', etat: 'Normal' }, { site: 'Goma', code: 'GE-2', etat: 'PmUrgente' }];
    store.generatorReadingRows = [{ site: 'Goma', groupeCode: 'GE-1' }, { site: 'Goma', groupeCode: 'GE-2' }];
    store.problemRows = [{ statut: 'Open' }, { statut: 'Closed' }];
    const component = new TableauDeBordPageComponent(store);

    expect(component.equipmentTotal).toBe(2);
    expect(component.ticketTotal).toBe(3);
expect(component.ticketItems.find((item) => item.label === 'PM')?.value).toBe(2);
    expect(component.equipmentItems.find((item) => item.label === 'En panne')?.color).toBe('#dc2626');
expect(component.equipmentItems.find((item) => item.label === 'Hors service')?.color).toBe('#4b4b4b');
expect(component.ticketItems.find((item) => item.label === 'WO')?.color).toBe('#000000');
    expect(component.ticketItems.find((item) => item.label === 'Curative')?.color).toBe('#087a46');
    expect(component.ticketItems.find((item) => item.label === 'Incident')?.color).toBe('#c91400');
    expect(component.generatorItems.find((item) => item.label === 'Urgente')?.color).toBe('#eab308');
    expect(component.generatorItems.find((item) => item.label === 'À venir')?.color).toBe('#767676');
    expect(component.generatorTotal).toBe(2);
    expect(component.problemTotal).toBe(2);
  });

  it('ne compte pas un groupe dont tous les relevés RH ont été supprimés', () => {
    const store = new GmaoDataStore();
    store.generatorRows = [{ site: 'Goma', code: 'GE-1', etat: 'Normal' }, { site: 'Goma', code: 'GE-2', etat: 'Normal' }];
    store.generatorReadingRows = [{ site: 'Goma', groupeCode: 'GE-1' }];
    const component = new TableauDeBordPageComponent(store);
    expect(component.generatorTotal).toBe(1);

    store.generatorReadingRows = [];
    expect(component.generatorTotal).toBe(0);
  });

  it('consolidates Fuel, Grid and PUE values by month', () => {
    const store = new GmaoDataStore();
    store.fuelRows = [
      { periode: '2026-08', sortie: 20, disponibiliteGrid: 80 },
      { periode: '2026-08', sortie: 30, disponibiliteGrid: 90 },
    ];
    store.fuelSummaryRows = [
      { periode: '2026-08', stockFinal: 250, sortie: 50 },
    ];
    store.pueRows = [
      { mois: '2026-08', pue: 1.5 },
      { mois: '2026-08', pue: 1.7 },
    ];
    const component = new TableauDeBordPageComponent(store);

    expect(component.latestGridAvailability).toBe(85);
    expect(component.latestFuelStock).toBe(250);
    expect(component.latestFuelConsumption).toBe(50);
    expect(component.latestPue).toBeCloseTo(1.6);
    expect(component.gridAxisMinimum).toBe(0);
    expect(component.gridAxisMiddle).toBe(50);
    expect(component.gridAxisMaximum).toBe(100);
    expect(component.pueAxisMinimum).toBe(0);
    expect(component.pueAxisMaximum).toBe(3);
    expect(component.fuelBarAxisMaximum).toBe(10_000);
    expect(component.fuelBarGroups).toHaveLength(1);
    expect(component.fuelBarGroups[0].stock.value).toBe(250);
    expect(component.fuelBarGroups[0].consumption.value).toBe(50);
    expect(component.chartPoints(component.pueValues, component.pueMonths, 0, 3)).toHaveLength(1);
  });

  it('uses the consolidated monthly stock when a selected site has no historical stock value', () => {
    const store = new GmaoDataStore();
    store.fuelRows = [
      { site: 'Goma', periode: '2026-01', sortie: 20, stockFinal: null, disponibiliteGrid: 80 },
    ];
    store.fuelSummaryRows = [
      { periode: '2026-01', stockFinal: 100, sortie: 20 },
    ];
    const component = new TableauDeBordPageComponent(store);
    component.selectedSite = 'Goma';

    expect(component.latestFuelConsumption).toBe(20);
    expect(component.latestFuelStock).toBe(100);
    expect(component.showFuelStockBars).toBe(true);
    expect(component.usesConsolidatedStockFallback).toBe(true);
    expect(component.fuelStockLegend).toBe('Stock final consolidé');
  });
  it('keeps the current equipment inventory while filtering activity KPIs by date', () => {
    const store = new GmaoDataStore();
    store.equipmentRows = [
      { site: 'Goma', dateMiseEnService: '2026-08-05', etat: 'En service' },
      { site: 'Utex', dateMiseEnService: '2026-08-05', etat: 'En panne' },
    ];
    store.ticketRows = [
      { site: 'Goma', date: '2026-08-10', nature: 'PM' },
      { site: 'Goma', date: '2026-07-10', nature: 'Incident' },
      { site: 'Utex', date: '2026-08-10', nature: 'WO' },
    ];
    store.generatorRows = [
      { site: 'Goma', code: 'GE-1', moisReleve: '2026-08', etat: 'Normal' },
      { site: 'Utex', code: 'GE-2', moisReleve: '2026-08', etat: 'PmUrgente' },
    ];
    store.generatorReadingRows = [{ site: 'Goma', groupeCode: 'GE-1' }, { site: 'Utex', groupeCode: 'GE-2' }];
    store.problemRows = [
      { site: 'Goma', date: '2026-08-12', statut: 'Open' },
      { site: 'Utex', date: '2026-08-12', statut: 'Closed' },
    ];
    store.fuelRows = [
      { site: 'Goma', periode: '2026-08', sortie: 20, stockFinal: 75, disponibiliteGrid: 80 },
      { site: 'Utex', periode: '2026-08', sortie: 40, stockFinal: 125, disponibiliteGrid: 90 },
    ];
    store.fuelSummaryRows = [
      { periode: '2026-08', stockFinal: 100, sortie: 60 },
    ];
    store.pueRows = [
      { site: 'Goma', mois: '2026-08', pue: 1.5 },
      { site: 'Utex', mois: '2026-08', pue: 1.7 },
    ];
    const component = new TableauDeBordPageComponent(store);
    component.selectedSite = 'Goma';
    component.dateFrom = '2026-08-01';
    component.dateTo = '2026-08-31';

    expect(component.equipmentTotal).toBe(1);
    expect(component.ticketTotal).toBe(1);
    expect(component.generatorTotal).toBe(1);
    expect(component.problemTotal).toBe(1);
    expect(component.latestGridAvailability).toBe(80);
    expect(component.latestFuelConsumption).toBe(20);
    expect(component.latestFuelStock).toBe(75);
        expect(component.showConsolidatedFuelStock).toBe(false);
    expect(component.showFuelStockBars).toBe(true);
    expect(component.latestPue).toBe(1.5);

    component.selectedSite = '';
    expect(component.latestFuelStock).toBe(100);
    expect(component.latestFuelConsumption).toBe(60);
    expect(component.showConsolidatedFuelStock).toBe(true);
    expect(component.latestGridAvailability).toBe(85);
    expect(component.latestPue).toBeCloseTo(1.6);

    component.dateFrom = '2030-01-01';
    component.dateTo = '2030-12-31';
    expect(component.equipmentTotal).toBe(2);
    expect(component.ticketTotal).toBe(0);
    expect(component.generatorTotal).toBe(0);
    expect(component.problemTotal).toBe(0);
    expect(component.latestGridAvailability).toBe(0);
    expect(component.latestFuelStock).toBe(0);
    expect(component.latestFuelConsumption).toBe(0);
    expect(component.latestPue).toBe(0);
  });
});