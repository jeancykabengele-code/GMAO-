import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { PdfExportService } from '../shared/pdf-export.service';

interface MonthlyJournalRow {
  id?: string;
  site: string;
  periode: string;
  sortie: number;
  stockInitial: number | null;
  stockFinal: number | null;
  heuresGe: number;
  litresHeure: number | null;
  snelKwh: number | null;
  disponibiliteGrid: number;
}

interface MonthlyFuelSummary {
  id?: string;
  periode: string;
  stockInitial: number;
  entree: number;
  sortie: number;
  stockFinal: number;
  heuresGe: number;
}

@Component({
  selector: 'app-fuel-ge-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fuel-ge-page.html',
  styleUrls: ['./fuel-ge-page.scss'],
})
export class FuelGePageComponent {
  readonly rowsPerPage = 20;
  readonly noGridSites = new Set(['Kikwit', 'Mbandaka']);

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly pdfExporter: PdfExportService = new PdfExportService(),
  ) {}

  get sites(): string[] { return this.dataStore.allowedSites; }
  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportPdf(): boolean { return this.dataStore.canExportData; }
  get journalRows(): MonthlyJournalRow[] { return this.dataStore.fuelRows as MonthlyJournalRow[]; }
  set journalRows(value: MonthlyJournalRow[]) { this.dataStore.fuelRows = value; }
  get summaryRows(): MonthlyFuelSummary[] {
    return (this.dataStore.fuelSummaryRows as MonthlyFuelSummary[]).slice().sort((a, b) => a.periode.localeCompare(b.periode));
  }

  journalOpen = true;
  sheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedPeriod = '';
  searchTerm = '';
  editingIndex: number | null = null;
  newEntry: MonthlyJournalRow = this.createEmptyEntry();

  get filteredRows(): MonthlyJournalRow[] {
    const search = this.searchTerm.trim().toLocaleLowerCase('fr');
    return this.journalRows.filter((row) => {
      const matchesSite = !this.selectedSite || row.site === this.selectedSite;
      const matchesPeriod = !this.selectedPeriod || row.periode === this.selectedPeriod;
      const matchesSearch = !search || `${row.site} ${row.periode}`.toLocaleLowerCase('fr').includes(search);
      return matchesSite && matchesPeriod && matchesSearch;
    });
  }

  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage)); }
  get visibleRows(): MonthlyJournalRow[] {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    return this.filteredRows.slice(start, start + this.rowsPerPage);
  }

  get calculatedLitresPerHour(): number | null {
    const hours = Number(this.newEntry.heuresGe || 0);
    const consumption = Number(this.newEntry.sortie || 0);
    if (hours > 0) return consumption / hours;
    return consumption === 0 ? 0 : null;
  }

  get calculatedGridAvailability(): number {
    if (this.isNoGridSite(this.newEntry.site)) return 0;
    const [year, month] = this.newEntry.periode.split('-').map(Number);
    if (!year || !month) return 0;
    const monthHours = new Date(year, month, 0).getDate() * 24;
    return Math.max(0, Math.min(100, (1 - Number(this.newEntry.heuresGe || 0) / monthHours) * 100));
  }

  get sheetTitle(): string {
    return this.editingIndex === null ? 'Renseigner le journal mensuel' : 'Modifier la ligne du journal';
  }

  exportPdf(): void {
    if (!this.canExportPdf) return;
    this.pdfExporter.exportTable({
      title: 'Journal mensuel Fuel-GE',
      fileName: 'journal-fuel-ge',
      rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Mois et année', value: (row) => row.periode },
        { header: 'Stock initial (L)', value: (row) => row.stockInitial },
        { header: 'Consommé (L)', value: (row) => row.sortie },
        { header: 'Stock final (L)', value: (row) => row.stockFinal },
        { header: 'Heures GE', value: (row) => row.heuresGe },
        { header: 'L/h', value: (row) => row.litresHeure },
        { header: 'SNEL kWh', value: (row) => row.snelKwh },
        { header: 'Disponibilité Grid (%)', value: (row) => row.disponibiliteGrid },
      ],
    });
  }
  toggleJournal(): void { this.journalOpen = !this.journalOpen; }
  resetPage(): void { this.currentPage = 1; }

  openSheet(): void {
    this.editingIndex = null;
    this.newEntry = this.createEmptyEntry();
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
    this.editingIndex = null;
  }

  changeSite(): void {
    if (this.isNoGridSite(this.newEntry.site)) this.newEntry.snelKwh = null;
  }

  async saveEntry(): Promise<void> {
    const entry: MonthlyJournalRow = {
      ...this.newEntry,
      sortie: Number(this.newEntry.sortie),
      stockInitial: Number(this.newEntry.stockInitial),
      stockFinal: Number(this.newEntry.stockFinal),
      heuresGe: Number(this.newEntry.heuresGe),
      litresHeure: this.calculatedLitresPerHour === null ? null : Number(this.calculatedLitresPerHour.toFixed(3)),
      snelKwh: this.isNoGridSite(this.newEntry.site) ? null : Number(this.newEntry.snelKwh || 0),
      disponibiliteGrid: Number(this.calculatedGridAvailability.toFixed(2)),
    };
    if (this.editingIndex === null) {
      await this.dataStore.createRecord('fuel-ge', entry);
    } else {
      await this.dataStore.updateRecord('fuel-ge', this.journalRows[this.editingIndex], entry);
    }
    this.selectedSite = '';
    this.selectedPeriod = '';
    this.searchTerm = '';
    this.currentPage = 1;
    this.journalOpen = true;
    this.closeSheet();
  }

  editEntry(row: MonthlyJournalRow): void {
    this.editingIndex = this.journalRows.indexOf(row);
    this.newEntry = { ...row };
    this.sheetOpen = true;
  }

  previousPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.pageCount) this.currentPage++; }
  isNoGridSite(site: string): boolean { return this.noGridSites.has(site); }

  private createEmptyEntry(): MonthlyJournalRow {
    return {
      site: '', periode: '', sortie: 0, stockInitial: 0, stockFinal: 0, heuresGe: 0, litresHeure: 0,
      snelKwh: 0, disponibiliteGrid: 0,
    };
  }
}