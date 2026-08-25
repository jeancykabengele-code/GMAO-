import { GestionTicketsPageComponent } from './gestion-tickets-page';

const makeTicket = (
  index: number,
  site = 'Goma',
  nature: 'PM' | 'WO' | 'Incident' | 'Curative' | 'Visit' = 'PM',
) => ({
  numero: `T-${index}`,
  site,
  nature,
  equipement: `EQ-${index}`,
  date: '2026-08-18',
  porteur: 'Agent',
  entreprise: 'Orange RDC',
  motif: 'Maintenance',
  description: 'Description',
});

describe('GestionTicketsPageComponent', () => {
  it('limits each ticket page to 20 actual tickets', () => {
    const component = new GestionTicketsPageComponent();
    component.ticketRows = Array.from({ length: 45 }, (_, index) => makeTicket(index));

    expect(component.ticketPageCount).toBe(3);
    expect(component.visibleTicketRows.filter(Boolean)).toHaveLength(20);

    component.nextPage('tickets');
    component.nextPage('tickets');

    expect(component.ticketPage).toBe(3);
    expect(component.visibleTicketRows.filter(Boolean)).toHaveLength(5);

    component.nextPage('tickets');
    expect(component.ticketPage).toBe(3);
  });

  it('filters tickets by site, nature and search text', () => {
    const component = new GestionTicketsPageComponent();
    component.ticketRows = [
      makeTicket(1, 'Goma', 'PM'),
      makeTicket(2, 'Bukavu', 'Incident'),
    ];

    component.selectedSite = 'Bukavu';
    expect(component.filteredTicketRows).toHaveLength(1);

    component.selectedSite = '';
    component.selectedNature = 'PM';
    expect(component.filteredTicketRows).toHaveLength(1);

    component.selectedNature = '';
    component.searchTerm = 'T-2';
    expect(component.filteredTicketRows[0].site).toBe('Bukavu');
  });

  it('adds a ticket and updates the consolidation by site', () => {
    const component = new GestionTicketsPageComponent();
    component.newTicket.numero = 'T-100';
    component.newTicket.site = 'Utex';
    component.newTicket.nature = 'Incident';
    component.newTicket.date = '2026-08-18';

    component.saveTicket();

    expect(component.ticketRows).toHaveLength(1);
    const utex = component.siteSummaryRows.find((row) => row.site === 'Utex');
    expect(utex?.nombres).toBe(1);
    expect(utex?.incident).toBe(1);
    expect(component.visibleSiteRows).toHaveLength(13);
  });
});