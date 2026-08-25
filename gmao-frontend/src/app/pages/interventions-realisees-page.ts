import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { PdfExportService } from '../shared/pdf-export.service';

type InterventionType = 'PM' | 'Corrective' | 'Cleanning' | 'Controle' | 'Autre';
type InterventionStatus = 'Cloturee' | 'En cours';

interface InterventionRow {
  ticketNumber: string;
  date: string;
  site: string;
  equipement: string;
  type: InterventionType;
  travailRealise: string;
  agent: string;
  dureeHeures: number;
  statut: InterventionStatus;
}

@Component({
  selector: 'app-interventions-realisees-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './interventions-realisees-page.html',
  styleUrls: ['./interventions-realisees-page.scss'],
})
export class InterventionsRealiseesPageComponent {
  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly pdfExporter: PdfExportService = new PdfExportService(),
  ) {}

  get availableEquipments(): Array<{ site: string; code: string; nom: string }> {
    const rows = this.dataStore.equipmentRows as Array<{ site: string; code: string; nom: string }>;
    const site = this.newIntervention.site;
    return rows
      .filter((equipment) => !site || equipment.site === site)
      .sort((first, second) => first.code.localeCompare(second.code, 'fr'));
  }

  get interventionRows(): InterventionRow[] {
    return this.dataStore.interventionRows as InterventionRow[];
  }

  set interventionRows(value: InterventionRow[]) {
    this.dataStore.interventionRows = value;
  }

  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportPdf(): boolean { return this.dataStore.canExportData; }
  readonly interventionTypes: InterventionType[] = ['PM', 'Corrective', 'Cleanning', 'Controle', 'Autre'];
  readonly statuses: InterventionStatus[] = ['Cloturee', 'En cours'];

  tableOpen = true;
  sheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedType: InterventionType | '' = '';
  selectedPeriod = '';
  newIntervention: InterventionRow = this.createEmptyIntervention();

  get filteredRows(): InterventionRow[] {
    return this.interventionRows.filter((row) => {
      const matchesSite = !this.selectedSite || row.site === this.selectedSite;
      const matchesType = !this.selectedType || row.type === this.selectedType;
      const matchesPeriod = !this.selectedPeriod || row.date.startsWith(this.selectedPeriod);
      return matchesSite && matchesType && matchesPeriod;
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage));
  }

  get visibleRows(): Array<InterventionRow | null> {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    const rows = this.filteredRows.slice(start, start + this.rowsPerPage);
    return rows;
  }

  exportPdf(): void {
    if (!this.canExportPdf) return;
    this.pdfExporter.exportTable({
      title: 'Journal des interventions réalisées',
      fileName: 'interventions-realisees',
      rows: this.filteredRows,
      columns: [
        { header: 'Ticket', value: (row) => row.ticketNumber },
        { header: 'Date', value: (row) => row.date },
        { header: 'Site', value: (row) => row.site },
        { header: 'Équipement', value: (row) => row.equipement },
        { header: 'Type', value: (row) => row.type },
        { header: 'Travail réalisé', value: (row) => row.travailRealise },
        { header: 'Agent', value: (row) => row.agent },
        { header: 'Durée (h)', value: (row) => row.dureeHeures },
        { header: 'Statut', value: (row) => this.statusLabel(row.statut) },
      ],
    });
  }

  toggleTable(): void {
    this.tableOpen = !this.tableOpen;
  }

  resetPage(): void {
    this.currentPage = 1;
  }

  changeInterventionSite(): void {
    this.newIntervention.equipement = '';
  }

  openSheet(): void {
    this.newIntervention = this.createEmptyIntervention();
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
  }

  async saveIntervention(): Promise<void> {
    const intervention: InterventionRow = {
      ...this.newIntervention,
      dureeHeures: Number(this.newIntervention.dureeHeures),
    };
    await this.dataStore.createRecord('interventions', intervention);
    this.selectedSite = '';
    this.selectedType = '';
    this.selectedPeriod = '';
    this.currentPage = 1;
    this.tableOpen = true;
    this.closeSheet();
    this.newIntervention = this.createEmptyIntervention();
  }

  statusLabel(status: InterventionStatus): string {
    return status === 'Cloturee' ? 'Cl\u00f4tur\u00e9e' : 'En cours';
  }

  previousPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage < this.pageCount) this.currentPage++;
  }

  private createEmptyIntervention(): InterventionRow {
    return {
      ticketNumber: '', date: '', site: '', equipement: '', type: 'PM', travailRealise: '',
      agent: '', dureeHeures: 0, statut: 'En cours',
    };
  }
}