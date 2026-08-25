import { GmaoDataStore } from '../data/gmao-data-store';
import { InterventionsRealiseesPageComponent } from './interventions-realisees-page';

describe('InterventionsRealiseesPageComponent', () => {
  it('saves an intervention with in-progress status by default', () => {
    const component = new InterventionsRealiseesPageComponent();
    component.newIntervention.ticketNumber = 'T-001';
    component.newIntervention.date = '2026-08-18';
    component.newIntervention.site = 'Goma';
    component.newIntervention.equipement = 'Groupe electrogene';
    component.newIntervention.type = 'PM';
    component.newIntervention.travailRealise = 'Vidange et controles';
    component.newIntervention.agent = 'Agent 1';
    component.newIntervention.dureeHeures = 2.5;

    component.saveIntervention();

    expect(component.interventionRows).toHaveLength(1);
    expect(component.interventionRows[0].statut).toBe('En cours');
    expect(component.interventionRows[0].dureeHeures).toBe(2.5);
  });

  it('filters interventions by site, type and month', () => {
    const component = new InterventionsRealiseesPageComponent();
    component.interventionRows = [
      { ticketNumber: 'T-1', date: '2026-07-10', site: 'Bukavu', equipement: 'GE', type: 'PM', travailRealise: 'Controle', agent: 'A', dureeHeures: 1, statut: 'Cloturee' },
      { ticketNumber: 'T-2', date: '2026-08-18', site: 'Utex', equipement: 'UPS', type: 'Corrective', travailRealise: 'Reparation', agent: 'B', dureeHeures: 3, statut: 'En cours' },
    ];

    component.selectedSite = 'Bukavu';
    expect(component.filteredRows).toHaveLength(1);
    component.selectedSite = '';
    component.selectedType = 'Corrective';
    expect(component.filteredRows[0].site).toBe('Utex');
    component.selectedType = '';
    component.selectedPeriod = '2026-07';
    expect(component.filteredRows[0].ticketNumber).toBe('T-1');
  });

  it('paginates by 20 rows and formats closed status', () => {
    const component = new InterventionsRealiseesPageComponent();
    component.interventionRows = Array.from({ length: 21 }, (_, index) => ({
      ticketNumber: `T-${index}`, date: '2026-08-18', site: 'Mtc', equipement: 'GE',
      type: 'Controle' as const, travailRealise: 'Test', agent: 'Agent', dureeHeures: 1,
      statut: 'Cloturee' as const,
    }));

    expect(component.pageCount).toBe(2);
    expect(component.visibleRows.filter(Boolean)).toHaveLength(20);
    component.nextPage();
    expect(component.currentPage).toBe(2);
    expect(component.statusLabel('Cloturee')).toBe('Cl\u00f4tur\u00e9e');
  });

  it('keeps interventions in the shared store and clears equipment when the site changes', () => {
    const store = new GmaoDataStore();
    const firstComponent = new InterventionsRealiseesPageComponent(store);
    firstComponent.newIntervention.ticketNumber = 'T-22';
    firstComponent.newIntervention.equipement = 'GE-01';
    firstComponent.saveIntervention();

    const secondComponent = new InterventionsRealiseesPageComponent(store);
    expect(secondComponent.interventionRows[0].ticketNumber).toBe('T-22');

    secondComponent.newIntervention.equipement = 'GE-02';
    secondComponent.changeInterventionSite();
    expect(secondComponent.newIntervention.equipement).toBe('');
  });
});
