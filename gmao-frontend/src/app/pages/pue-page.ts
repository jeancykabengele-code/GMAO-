import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

interface PueRecord {
  id?: string;
  site: string;
  mois: string;
  energieIt: number;
  energieTotale: number;
  pue: number;
}

@Component({
  selector: 'app-pue-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pue-page.html',
  styleUrls: ['./pue-page.scss'],
})
export class PuePageComponent {
  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredRows,
      clearFilters: () => {
        this.selectedSite = '';
        this.selectedMonth = '';
        this.tableOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  get pueRows(): PueRecord[] {
    return this.dataStore.pueRows as PueRecord[];
  }

  set pueRows(value: PueRecord[]) {
    this.dataStore.pueRows = value;
  }
  tableOpen = true;
  sheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedMonth = '';
  editingIndex: number | null = null;
  newEntry: PueRecord = this.createEmptyEntry();

  get filteredRows(): PueRecord[] {
    return this.pueRows.filter((row) => {
      const matchesSite = !this.selectedSite || row.site === this.selectedSite;
      const matchesMonth = !this.selectedMonth || row.mois === this.selectedMonth;
      return matchesSite && matchesMonth;
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage));
  }

  get visibleRows(): Array<PueRecord | null> {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    const rows = this.filteredRows.slice(start, start + this.rowsPerPage);

    return rows;
  }

  get calculatedPue(): number {
    if (!this.newEntry.energieIt || this.newEntry.energieIt <= 0) {
      return 0;
    }

    return this.newEntry.energieTotale / this.newEntry.energieIt;
  }

  get sheetTitle(): string {
    return this.editingIndex === null ? 'Renseigner le PUE' : 'Modifier la ligne PUE';
  }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: 'Suivi du PUE',
      fileName: 'suivi-pue',
      rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Mois', value: (row) => row.mois },
        { header: 'Énergie IT', value: (row) => row.energieIt },
        { header: 'Énergie totale', value: (row) => row.energieTotale },
        { header: 'PUE', value: (row) => row.pue },
        { header: 'État', value: (row) => this.getState(row.pue) },
      ],
    });
  }

  toggleTable(): void {
    this.tableOpen = !this.tableOpen;
  }

  resetPage(): void {
    this.currentPage = 1;
  }

  openSheet(): void {
    this.editingIndex = null;
    this.newEntry = this.createEmptyEntry();
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
    this.editingIndex = null;
  }

  async saveEntry(): Promise<void> {
    const entry: PueRecord = {
      ...this.newEntry,
      energieIt: Number(this.newEntry.energieIt),
      energieTotale: Number(this.newEntry.energieTotale),
      pue: Number(this.calculatedPue.toFixed(3)),
    };
    if (this.editingIndex === null) {
      await this.dataStore.createRecord('pue', entry);
    } else {
      await this.dataStore.updateRecord('pue', this.pueRows[this.editingIndex], entry);
    }
    this.selectedSite = '';
    this.selectedMonth = '';
    this.currentPage = 1;
    this.tableOpen = true;
    this.closeSheet();
    this.cdr?.markForCheck();
  }

  editEntry(row: PueRecord): void {
    this.editingIndex = this.pueRows.indexOf(row);
    this.newEntry = { ...row };
    this.sheetOpen = true;
  }

  deleteEntry(row: PueRecord): void {
    this.pueRows = this.pueRows.filter((item) => item !== row);

    if (this.currentPage > this.pageCount) {
      this.currentPage = this.pageCount;
    }
  }

  getState(pue: number): string {
    return pue <= 1.8 ? '\u2264 1,8' : '> 1,8';
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage(): void {
    if (this.currentPage < this.pageCount) {
      this.currentPage++;
    }
  }

  private createEmptyEntry(): PueRecord {
    return {
      site: '',
      mois: '',
      energieIt: 0,
      energieTotale: 0,
      pue: 0,
    };
  }
}