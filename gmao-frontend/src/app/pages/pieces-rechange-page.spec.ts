import { GmaoDataStore } from '../data/gmao-data-store';
import { PiecesRechangePageComponent } from './pieces-rechange-page';

describe('PiecesRechangePageComponent', () => {
  it('saves a spare-part operation with received status by default', () => {
    const component = new PiecesRechangePageComponent();
    component.newOperation.site = 'Goma';
    component.newOperation.date = '2026-08-18';
    component.newOperation.ticketNumber = 'T-001';
    component.newOperation.equipement = 'Groupe electrogene';
    component.newOperation.designation = 'Filtre a huile';
    component.newOperation.quantite = 2;
    component.newOperation.agent = 'Agent 1';

    component.saveOperation();

    expect(component.operationRows).toHaveLength(1);
    expect(component.operationRows[0].statut).toBe('Recue');
    expect(component.operationRows[0].quantite).toBe(2);
    expect(component.statusLabel('Recue')).toBe('Re\u00e7ue');
  });

  it('filters operations by site, month and status', () => {
    const component = new PiecesRechangePageComponent();
    component.operationRows = [
      { site: 'Bukavu', date: '2026-07-12', ticketNumber: 'T-1', equipement: 'GE', designation: 'Filtre', quantite: 1, agent: 'A', statut: 'Recue' },
      { site: 'Utex', date: '2026-08-18', ticketNumber: 'T-2', equipement: 'UPS', designation: 'Batterie', quantite: 2, agent: 'B', statut: 'Utilisee' },
    ];

    component.selectedSite = 'Bukavu';
    expect(component.filteredRows).toHaveLength(1);

    component.selectedSite = '';
    component.selectedPeriod = '2026-08';
    expect(component.filteredRows[0].site).toBe('Utex');

    component.selectedPeriod = '';
    component.selectedStatus = 'Utilisee';
    expect(component.filteredRows[0].ticketNumber).toBe('T-2');
  });

  it('supports pagination, editing while deletion remains forbidden', () => {
    const component = new PiecesRechangePageComponent();
    component.operationRows = Array.from({ length: 21 }, (_, index) => ({
      site: 'Mtc', date: '2026-08-18', ticketNumber: `T-${index}`, equipement: 'GE',
      designation: 'Filtre', quantite: 1, agent: 'Agent', statut: 'Recue' as const,
    }));

    expect(component.pageCount).toBe(2);
    expect(component.visibleRows.filter(Boolean)).toHaveLength(20);
    component.nextPage();
    expect(component.currentPage).toBe(2);

    const row = component.operationRows[0];
    component.editOperation(row);
    component.newOperation.quantite = 5;
    component.newOperation.statut = 'Utilisee';
    component.saveOperation();
    expect(component.operationRows[0].quantite).toBe(5);
    expect(component.operationRows[0].statut).toBe('Utilisee');

    component.deleteOperation(component.operationRows[0]);
    expect(component.operationRows).toHaveLength(21);
  });

  it('keeps operations in the shared store and clears equipment when the site changes', () => {
    const store = new GmaoDataStore();
    const firstComponent = new PiecesRechangePageComponent(store);
    firstComponent.newOperation.ticketNumber = 'T-33';
    firstComponent.newOperation.equipement = 'UPS-01';
    firstComponent.saveOperation();

    const secondComponent = new PiecesRechangePageComponent(store);
    expect(secondComponent.operationRows[0].ticketNumber).toBe('T-33');

    secondComponent.newOperation.equipement = 'UPS-02';
    secondComponent.changeOperationSite();
    expect(secondComponent.newOperation.equipement).toBe('');
  });
});
