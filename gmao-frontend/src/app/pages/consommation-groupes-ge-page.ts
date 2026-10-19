import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { PdfExportService, TableExporter } from '../shared/pdf-export.service';
import { RhReading, groupRhStatus, rhMissingMessage } from '../shared/rh-readings';

interface ConsumptionRow { id?: string; site: string; periode: string; groupeCode: string; consommationLitres: number; heuresGe: number; litresHeure: number | null; commentaires?: string; }
interface GeneratorRow { site: string; code: string; moisReleve: string; rhActuel: number; }
interface Entry { site: string; periode: string; groupeCode: string; consommationLitres: number | null; commentaires: string; }

@Component({ selector: 'app-consommation-groupes-ge', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './consommation-groupes-ge-page.html', styleUrls: ['./consommation-groupes-ge-page.scss'] })
export class ConsommationGroupesGePageComponent {
  readonly rowsPerPage = 20;
  open = false;
  tableOpen = true;
  error = '';
  currentPage = 1;
  selectedSite = '';
  selectedPeriod = '';
  selectedGroup = '';
  searchTerm = '';
  entry: Entry;
  editingRow: ConsumptionRow | null = null;
  deleting = false;
  deleteConfirmationOpen = false;

  private readonly pdfExporter = new PdfExportService();

  constructor(
    readonly dataStore: GmaoDataStore,
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) { this.entry = this.empty(); }
  get rows(): ConsumptionRow[] {
    return (this.dataStore.generatorFuelConsumptionRows as ConsumptionRow[]).map((row) => ({
      ...row,
      commentaires: row.commentaires === 'Import Excel « Consommation par site et par GE 2026 ».' ? '' : row.commentaires,
    }));
  }
  get sites(): string[] { return this.dataStore.allowedSites; }
  get canEnterData(): boolean { return this.dataStore.canEnterData; }
  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  get groups(): GeneratorRow[] { return this.dataStore.generatorRows as GeneratorRow[]; }
  get allowedGroups(): GeneratorRow[] { return this.groups.filter((group) => group.site === this.entry.site); }
  get filterGroups(): string[] { return [...new Set(this.rows.map((row) => row.groupeCode))].sort(); }
  get filteredRows(): ConsumptionRow[] {
    const search = this.searchTerm.trim().toLocaleLowerCase('fr');
    return this.rows.filter((row) => (!this.selectedSite || row.site === this.selectedSite)
      && (!this.selectedPeriod || row.periode === this.selectedPeriod)
      && (!this.selectedGroup || row.groupeCode === this.selectedGroup)
      && (!search || `${row.site} ${row.periode} ${row.groupeCode} ${row.commentaires ?? ''}`.toLocaleLowerCase('fr').includes(search)));
  }
  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage)); }
  get visibleRows(): ConsumptionRow[] { const start = (this.currentPage - 1) * this.rowsPerPage; return this.filteredRows.slice(start, start + this.rowsPerPage); }

  private get rhStatus() { return groupRhStatus(this.dataStore.generatorReadingRows as RhReading[], this.entry.site, this.entry.groupeCode, this.entry.periode); }
  hours(): number | null { return this.rhStatus.hours; }
  /** Pourquoi l'enregistrement est impossible pour l'instant ('' si les prérequis sont réunis). */
  get missingPrerequisite(): string {
    if (!this.entry.site || !this.entry.periode || !this.entry.groupeCode) return '';
    return rhMissingMessage(this.rhStatus, this.entry.periode);
  }
  litresHour(): number | null { const hours = this.hours(); const consumption = this.entry.consommationLitres ?? 0; return hours === null || (hours === 0 && consumption > 0) ? null : hours === 0 ? 0 : consumption / hours; }
  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.exportTable(this.excelExporter);
  }

  exportPdf(): void {
    if (!this.canExportExcel) return;
    this.exportTable(this.pdfExporter);
  }

  /** Même tableau pour l'export Excel et pour l'export PDF. */
  private exportTable(exporter: TableExporter): void {
    exporter.exportTable({
      title: 'Consommation par GE', fileName: 'consommation-par-ge', rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site }, { header: 'Mois', value: (row) => row.periode },
        { header: 'Groupe', value: (row) => row.groupeCode }, { header: 'Heures GE', value: (row) => row.heuresGe },
        { header: 'Fuel consommé (L)', value: (row) => row.consommationLitres }, { header: 'L/h', value: (row) => row.litresHeure ?? '' },
        { header: 'Commentaire', value: (row) => row.commentaires ?? '' },
      ],
    });
  }
  toggleTable(): void { this.tableOpen = !this.tableOpen; }
  resetPage(): void { this.currentPage = 1; }
  previousPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.pageCount) this.currentPage++; }
  resetFilters(): void { this.selectedSite = ''; this.selectedPeriod = ''; this.selectedGroup = ''; this.searchTerm = ''; this.currentPage = 1; }
  get sheetTitle(): string { return this.editingRow ? 'Modifier la consommation' : 'Renseigner la consommation'; }
  show(): void { if (!this.canEnterData) return; this.error = ''; this.editingRow = null; this.entry = this.empty(); this.open = true; }
  openEdit(row: ConsumptionRow): void {
    if (!this.canModify) return;
    this.error = '';
    this.editingRow = row;
    this.entry = { site: row.site, periode: row.periode, groupeCode: row.groupeCode, consommationLitres: row.consommationLitres, commentaires: row.commentaires ?? '' };
    this.open = true;
  }
  close(): void { if (this.deleting) return; this.open = false; this.editingRow = null; }
  async save(): Promise<void> {
    this.error = '';
    if (!this.entry.site || !this.entry.periode || !this.entry.groupeCode || this.entry.consommationLitres === null) { this.error = 'Complétez les champs obligatoires.'; return; }
    try {
      if (this.editingRow) await this.dataStore.updateRecord('consommations-groupes-ge', this.editingRow, this.entry);
      else await this.dataStore.createRecord('consommations-groupes-ge', this.entry);
      await this.dataStore.refreshResource('fuel-ge');
      this.close();
    }
    catch (error) {
      const apiError = error as { error?: { detail?: string; message?: string }; message?: string };
      this.error = apiError?.error?.detail || apiError?.error?.message || 'Enregistrement impossible : vérifiez les relevés RH du groupe.';
    }
    finally { this.cdr?.markForCheck(); }
  }
  requestDeletion(): void { if (this.editingRow && !this.deleting) this.deleteConfirmationOpen = true; }
  cancelDeletion(): void { if (!this.deleting) this.deleteConfirmationOpen = false; }
  async deleteEntry(): Promise<void> {
    if (!this.editingRow || this.deleting) return;
    this.deleting = true;
    try {
      await this.dataStore.deleteRecord('consommations-groupes-ge', this.editingRow);
      await this.dataStore.refreshResource('fuel-ge');
      this.deleteConfirmationOpen = false;
      if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
      this.deleting = false;
      this.close();
    } catch {
      this.deleteConfirmationOpen = false;
      this.error = 'Suppression impossible.';
    } finally {
      this.deleting = false;
      this.cdr?.markForCheck();
    }
  }
  private empty(): Entry { return { site: this.dataStore.allowedSites[0] ?? '', periode: '', groupeCode: '', consommationLitres: null, commentaires: '' }; }
}