import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';

type TicketView = 'tickets' | 'sites';
type TicketNature = 'PM' | 'WO' | 'Incident' | 'Curative' | 'Visit';

interface Ticket {
  numero: string;
  site: string;
  nature: TicketNature | '';
  equipement: string;
  date: string;
  porteur: string;
  entreprise: string;
  motif: string;
  description: string;
}

interface SiteSummary {
  site: string;
  nombres: number;
  pm: number;
  wo: number;
  curative: number;
  visit: number;
  incident: number;
}

@Component({
  selector: 'app-gestion-tickets-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './gestion-tickets-page.html',
  styleUrls: ['./gestion-tickets-page.scss'],
})
export class GestionTicketsPageComponent {
  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  readonly natures: TicketNature[] = ['PM', 'WO', 'Incident', 'Curative', 'Visit'];

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
  ) {}
  get availableEquipments(): Array<{ site: string; code: string; nom: string }> {
    const rows = this.dataStore.equipmentRows as Array<{ site: string; code: string; nom: string }>;
    const site = this.newTicket.site;
    return rows
      .filter((equipment) => !site || equipment.site === site)
      .sort((first, second) => first.code.localeCompare(second.code, 'fr'));
  }

  get ticketRows(): Ticket[] {
    return this.dataStore.ticketRows as Ticket[];
  }

  set ticketRows(value: Ticket[]) {
    this.dataStore.ticketRows = value;
  }
  activeView: TicketView | null = 'tickets';
  ticketPage = 1;
  selectedSite = '';
  selectedNature: TicketNature | '' = '';
  searchTerm = '';
  ticketSheetOpen = false;
  newTicket: Ticket = this.createEmptyTicket();

  get filteredTicketRows(): Ticket[] {
    const query = this.searchTerm.trim().toLocaleLowerCase('fr');

    return this.ticketRows.filter((ticket) => {
      const matchesSite = !this.selectedSite || ticket.site === this.selectedSite;
      const matchesNature = !this.selectedNature || ticket.nature === this.selectedNature;
      const matchesSearch =
        !query ||
        Object.values(ticket).some((value) =>
          value.toLocaleLowerCase('fr').includes(query),
        );

      return matchesSite && matchesNature && matchesSearch;
    });
  }

  get ticketPageCount(): number {
    return Math.max(1, Math.ceil(this.filteredTicketRows.length / this.rowsPerPage));
  }

  get siteSummaryRows(): SiteSummary[] {
    return this.sites.map((site) => {
      const siteTickets = this.ticketRows.filter((ticket) => ticket.site === site);
      const countNature = (nature: TicketNature) =>
        siteTickets.filter((ticket) => ticket.nature === nature).length;

      return {
        site,
        nombres: siteTickets.length,
        pm: countNature('PM'),
        wo: countNature('WO'),
        curative: countNature('Curative'),
        visit: countNature('Visit'),
        incident: countNature('Incident'),
      };
    });
  }


  get visibleTicketRows(): Array<Ticket | null> {
    return this.pageSlice(this.filteredTicketRows, this.ticketPage);
  }

  get visibleSiteRows(): SiteSummary[] {
    return this.siteSummaryRows;
  }

  exportExcel(): void {
    if (!this.canExportExcel || !this.activeView) return;
    if (this.activeView === 'sites') {
      this.excelExporter.exportTable({
        title: 'Répartition des tickets par site',
        fileName: 'tickets-par-site',
        rows: this.siteSummaryRows,
        columns: [
          { header: 'Site', value: (row) => row.site },
          { header: 'Nombre', value: (row) => row.nombres },
          { header: 'PM', value: (row) => row.pm },
          { header: 'WO', value: (row) => row.wo },
          { header: 'Curative', value: (row) => row.curative },
          { header: 'Visit', value: (row) => row.visit },
          { header: 'Incident', value: (row) => row.incident },
        ],
      });
      return;
    }
    this.excelExporter.exportTable({
      title: 'File de tickets',
      fileName: 'gestion-des-tickets',
      rows: this.filteredTicketRows,
      columns: [
        { header: 'Numéro', value: (row) => row.numero },
        { header: 'Site', value: (row) => row.site },
        { header: 'Nature', value: (row) => row.nature },
        { header: 'Équipement', value: (row) => row.equipement },
        { header: 'Date', value: (row) => row.date },
        { header: 'Porteur / agent', value: (row) => row.porteur },
        { header: 'Entreprise', value: (row) => row.entreprise },
        { header: 'Motif', value: (row) => row.motif },
        { header: 'Description', value: (row) => row.description },
      ],
    });
  }

  toggleView(view: TicketView): void {
    this.activeView = this.activeView === view ? null : view;
  }

  resetTicketPage(): void {
    this.ticketPage = 1;
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.resetTicketPage();
  }

  openTicketSheet(): void {
    this.newTicket = this.createEmptyTicket();
    this.ticketSheetOpen = true;
  }

  closeTicketSheet(): void {
    this.ticketSheetOpen = false;
  }

  async saveTicket(): Promise<void> {
    await this.dataStore.createRecord('tickets', { ...this.newTicket });
    this.selectedSite = '';
    this.selectedNature = '';
    this.searchTerm = '';
    this.ticketPage = 1;
    this.ticketSheetOpen = false;
    this.newTicket = this.createEmptyTicket();
  }

  previousPage(view: TicketView): void {
    if (view === 'tickets' && this.ticketPage > 1) {
      this.ticketPage--;
    }

  }

  nextPage(view: TicketView): void {
    if (view === 'tickets' && this.ticketPage < this.ticketPageCount) {
      this.ticketPage++;
    }

  }

  private pageSlice<T>(rows: T[], page: number): T[] {
    const start = (page - 1) * this.rowsPerPage;
    return rows.slice(start, start + this.rowsPerPage);
  }

  private createEmptyTicket(): Ticket {
    return {
      numero: '',
      site: '',
      nature: '',
      equipement: '',
      date: '',
      porteur: '',
      entreprise: '',
      motif: '',
      description: '',
    };
  }
}