import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { PdfExportService, TableExporter } from '../shared/pdf-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

type TicketView = 'tickets' | 'sites';
type TicketNature = 'PM' | 'WO' | 'Incident' | 'Curative' | 'Visit';

interface Ticket {
  id?: string;
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
  get canEnterData(): boolean { return this.dataStore.canEnterData; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  readonly natures: TicketNature[] = ['PM', 'WO', 'Incident', 'Curative', 'Visit'];

  private readonly pdfExporter = new PdfExportService();

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredTicketRows,
      clearFilters: () => {
        this.activeView = 'tickets';
        this.selectedSite = '';
        this.selectedNature = '';
        this.searchTerm = '';
      },
      setPage: (page) => { this.ticketPage = page; },
      pageSize: this.rowsPerPage,
    });
  }
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
  editingTicket: Ticket | null = null;
  pendingDeletion: Ticket | null = null;
  formError = '';
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
    this.exportTable(this.excelExporter);
  }

  exportPdf(): void {
    if (!this.canExportExcel || !this.activeView) return;
    this.exportTable(this.pdfExporter);
  }

  /** Même tableau (par site ou file de tickets) pour l'export Excel et pour l'export PDF. */
  private exportTable(exporter: TableExporter): void {
    if (this.activeView === 'sites') {
      exporter.exportTable({
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
    exporter.exportTable({
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

  openTicketSheet(): void { if (!this.canEnterData) return;
    this.editingTicket = null;
    this.newTicket = this.createEmptyTicket();
    this.formError = '';
    this.ticketSheetOpen = true;
  }

  closeTicketSheet(): void {
    this.ticketSheetOpen = false;
    this.editingTicket = null;
  }

  async saveTicket(): Promise<void> {
    this.formError = '';
    try {
      if (this.editingTicket) await this.dataStore.updateRecord('tickets', this.editingTicket, { ...this.newTicket });
      else await this.dataStore.createRecord('tickets', { ...this.newTicket });
      this.selectedSite = '';
      this.selectedNature = '';
      this.searchTerm = '';
      this.ticketPage = 1;
      this.closeTicketSheet();
      this.newTicket = this.createEmptyTicket();
    } catch {
      this.formError = 'Enregistrement impossible. Vérifiez les informations du ticket.';
    }
    this.cdr?.markForCheck();
  }

  editTicket(ticket: Ticket): void {
    this.editingTicket = ticket;
    this.newTicket = { ...ticket };
    this.formError = '';
    this.ticketSheetOpen = true;
  }

  requestDeletion(): void { if (this.editingTicket) this.pendingDeletion = this.editingTicket; }
  cancelDeletion(): void { this.pendingDeletion = null; }
  async confirmDeletion(): Promise<void> {
    const ticket = this.pendingDeletion;
    if (!ticket) return;
    this.pendingDeletion = null;
    try {
      await this.dataStore.deleteRecord('tickets', ticket);
      this.ticketPage = Math.min(this.ticketPage, this.ticketPageCount);
      this.closeTicketSheet();
    } catch {
      this.formError = 'Suppression impossible.';
    }
    this.cdr?.markForCheck();
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