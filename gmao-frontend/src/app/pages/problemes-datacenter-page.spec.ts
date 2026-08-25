import { ProblemesDatacenterPageComponent } from './problemes-datacenter-page';

const makeProblem = (
  index: number,
  site = 'Goma',
  statut: 'Open' | 'Ongoing' | 'Closed' = 'Open',
  priorite: 'P1' | 'P2' | 'P3' = 'P2',
) => ({
  site,
  date: '2026-08-18',
  equipement: `EQ-${index}`,
  constat: `Constat ${index}`,
  statut,
  priorite,
  responsable: 'Responsable',
  echeance: '2026-08-25',
  besoinSpare: false,
  prochaineEtape: 'Diagnostic',
});

describe('ProblemesDatacenterPageComponent', () => {
  it('creates every new problem with Open status', () => {
    const component = new ProblemesDatacenterPageComponent();
    component.newProblem.site = 'Utex';
    component.newProblem.date = '2026-08-18';
    component.newProblem.equipement = 'Climatisation';
    component.newProblem.constat = 'Température élevée';
    component.newProblem.priorite = 'P1';

    component.saveProblem();

    expect(component.problemRows[0].statut).toBe('Open');
  });

  it('filters by site, status, priority and search', () => {
    const component = new ProblemesDatacenterPageComponent();
    component.problemRows = [
      makeProblem(1, 'Goma', 'Open', 'P1'),
      makeProblem(2, 'Bukavu', 'Ongoing', 'P3'),
    ];

    component.selectedSite = 'Bukavu';
    expect(component.filteredProblemRows).toHaveLength(1);

    component.selectedSite = '';
    component.selectedStatus = 'Open';
    expect(component.filteredProblemRows).toHaveLength(1);

    component.selectedStatus = '';
    component.selectedPriority = 'P3';
    expect(component.filteredProblemRows[0].site).toBe('Bukavu');

    component.selectedPriority = '';
    component.searchTerm = 'EQ-1';
    expect(component.filteredProblemRows[0].site).toBe('Goma');
  });

  it('paginates by 20 rows and applies status actions', () => {
    const component = new ProblemesDatacenterPageComponent();
    component.problemRows = Array.from({ length: 45 }, (_, index) => makeProblem(index));

    expect(component.pageCount).toBe(3);
    expect(component.visibleProblemRows.filter(Boolean)).toHaveLength(20);

    component.nextPage();
    expect(component.currentPage).toBe(2);

    const problem = component.problemRows[0];
    component.changeStatus(problem, 'Ongoing');
    expect(problem.statut).toBe('Ongoing');

    component.changeStatus(problem, 'Closed');
    expect(problem.statut).toBe('Closed');

    component.changeStatus(problem, 'Ongoing');
    expect(problem.statut).toBe('Closed');
  });
});