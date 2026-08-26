import { Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

type SparePartStatus = 'Recue' | 'Utilisee' | 'Retournee';

interface SparePartOperation {
  id?: string;
  site: string;
  date: string;
  ticketNumber: string;
  equipement: string;
  designation: string;
  quantite: number;
  agent: string;
  statut: SparePartStatus;
}

@Component({
  selector: 'app-pieces-rechange-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pieces-rechange-page.html',
  styleUrls: ['./pieces-rechange-page.scss'],
})
export class PiecesRechangePageComponent {
  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredRows,
      clearFilters: () => {
        this.selectedSite = '';
        this.selectedPeriod = '';
        this.selectedStatus = '';
        this.tableOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  get availableEquipments(): Array<{ site: string; code: string; nom: string }> {
    const rows = this.dataStore.equipmentRows as Array<{ site: string; code: string; nom: string }>;
    const site = this.newOperation.site;
    return rows
      .filter((equipment) => !site || equipment.site === site)
      .sort((first, second) => first.code.localeCompare(second.code, 'fr'));
  }

  get operationRows(): SparePartOperation[] {
    return this.dataStore.sparePartRows as SparePartOperation[];
  }

  set operationRows(value: SparePartOperation[]) {
    this.dataStore.sparePartRows = value;
  }

  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  readonly statuses: SparePartStatus[] = ['Recue', 'Utilisee', 'Retournee'];

  tableOpen = true;
  sheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedPeriod = '';
  selectedStatus: SparePartStatus | '' = '';
  editingIndex: number | null = null;
  newOperation: SparePartOperation = this.createEmptyOperation();

  get filteredRows(): SparePartOperation[] {
    return this.operationRows.filter((row) => {
      const matchesSite = !this.selectedSite || row.site === this.selectedSite;
      const matchesPeriod = !this.selectedPeriod || row.date.startsWith(this.selectedPeriod);
      const matchesStatus = !this.selectedStatus || row.statut === this.selectedStatus;
      return matchesSite && matchesPeriod && matchesStatus;
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage));
  }

  get visibleRows(): Array<SparePartOperation | null> {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    const rows = this.filteredRows.slice(start, start + this.rowsPerPage);
    return rows;
  }

  get sheetTitle(): string {
    return this.editingIndex === null ? "Renseigner l'operation" : "Modifier l'operation";
  }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: 'Journal des pièces de rechange',
      fileName: 'pieces-de-rechange',
      rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Date', value: (row) => row.date },
        { header: 'Ticket', value: (row) => row.ticketNumber },
        { header: 'Équipement', value: (row) => row.equipement },
        { header: 'Désignation', value: (row) => row.designation },
        { header: 'Quantité', value: (row) => row.quantite },
        { header: 'Agent', value: (row) => row.agent },
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

  changeOperationSite(): void {
    this.newOperation.equipement = '';
  }

  openSheet(): void {
    this.editingIndex = null;
    this.newOperation = this.createEmptyOperation();
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
    this.editingIndex = null;
  }

  async saveOperation(): Promise<void> {
    const operation: SparePartOperation = {
      ...this.newOperation,
      quantite: Number(this.newOperation.quantite),
    };
    if (this.editingIndex === null) {
      await this.dataStore.createRecord('pieces-rechange', operation);
    } else {
      await this.dataStore.updateRecord('pieces-rechange', this.operationRows[this.editingIndex], operation);
    }
    this.selectedSite = '';
    this.selectedPeriod = '';
    this.selectedStatus = '';
    this.currentPage = 1;
    this.tableOpen = true;
    this.closeSheet();
    this.newOperation = this.createEmptyOperation();
  }

  editOperation(row: SparePartOperation): void {
    this.editingIndex = this.operationRows.indexOf(row);
    this.newOperation = { ...row };
    this.sheetOpen = true;
  }

  deleteOperation(row: SparePartOperation): void {
    this.operationRows = this.operationRows.filter((item) => item !== row);
    if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
  }

  statusLabel(status: SparePartStatus): string {
    const labels: Record<SparePartStatus, string> = {
      Recue: 'Re\u00e7ue',
      Utilisee: 'Utilis\u00e9e',
      Retournee: 'Retourn\u00e9e',
    };
    return labels[status];
  }

  previousPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage < this.pageCount) this.currentPage++;
  }

  private createEmptyOperation(): SparePartOperation {
    return {
      site: '',
      date: '',
      ticketNumber: '',
      equipement: '',
      designation: '',
      quantite: 1,
      agent: '',
      statut: 'Recue',
    };
  }
}