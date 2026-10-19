import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GmaoApiService } from '../data/gmao-api.service';
import { GmaoDataStore } from '../data/gmao-data-store';
import { GroupRhStatus, RhReading, groupRhStatus, rhMissingMessage } from '../shared/rh-readings';
import { ExcelExportService } from '../shared/excel-export.service';
import { PdfExportService, TableExporter } from '../shared/pdf-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

function roundToDecimals(value: number | null, decimals: number): number {
  return value === null ? 0 : Number(value.toFixed(decimals));
}

interface MonthlyJournalRow {
  id?: string;
  site: string;
  periode: string;
  sortie: number;
  stockInitial: number | null;
  entree?: number | null;
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
  private offGridOverride: Set<string> | null = null;

  private readonly pdfExporter = new PdfExportService();

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
    @Optional() api: GmaoApiService | null = null,
  ) {
    void this.loadOffGridSites(api);
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredRows,
      clearFilters: () => {
        this.selectedSite = '';
        this.selectedPeriod = '';
        this.searchTerm = '';
        this.journalOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  get sites(): string[] { return this.dataStore.allowedSites; }
  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canEnterData(): boolean { return this.dataStore.canEnterData; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
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
  pendingDeletion: MonthlyJournalRow | null = null;
  formError = '';
  saving = false;
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

  get canSetInitialStock(): boolean { return this.canModify || this.dataStore.isChefSite; }

  get isInitialFuelMonth(): boolean {
    if (!this.newEntry.site || !this.newEntry.periode) return false;
    const currentId = this.editingIndex === null ? undefined : this.journalRows[this.editingIndex]?.id;
    return !this.journalRows.some(row => row.site === this.newEntry.site && row.id !== currentId && row.periode < this.newEntry.periode);
  }

  /** Mois suivant déjà saisi dont le stock initial sera remplacé si ce mois devient le mois de départ. */
  get replacedStartMonth(): string | null {
    if (!this.isInitialFuelMonth) return null;
    const currentId = this.editingIndex === null ? undefined : this.journalRows[this.editingIndex]?.id;
    const next = this.journalRows
      .filter(row => row.site === this.newEntry.site && row.id !== currentId && row.periode > this.newEntry.periode)
      .sort((a, b) => a.periode.localeCompare(b.periode))[0];
    return next?.periode ?? null;
  }

  get previousStockFinal(): number | null {
    if (!this.newEntry.site || !this.newEntry.periode) return null;
    const currentId = this.editingIndex === null ? undefined : this.journalRows[this.editingIndex]?.id;
    const previous = this.journalRows
      .filter(row => row.site === this.newEntry.site && row.id !== currentId && row.periode < this.newEntry.periode)
      .sort((a, b) => b.periode.localeCompare(a.periode))[0];
    return previous?.stockFinal ?? null;
  }

  get calculatedStockInitial(): number | null {
    if (this.previousStockFinal !== null) return this.previousStockFinal;
    return this.isInitialFuelMonth || this.editingIndex !== null ? this.newEntry.stockInitial : null;
  }

  get calculatedEntries(): number {
    if (!this.newEntry.site || !this.newEntry.periode) return 0;
    return (this.dataStore.fuelDeliveryRows as Array<{ site?: string; periode?: string; quantiteRecue?: number }>)
      .filter(row => row.site === this.newEntry.site && row.periode === this.newEntry.periode)
      .reduce((total, row) => total + Number(row.quantiteRecue ?? 0), 0);
  }

  get calculatedGroupConsumption(): number {
    if (!this.newEntry.site || !this.newEntry.periode) return 0;
    return (this.dataStore.generatorFuelConsumptionRows as Array<{ site?: string; periode?: string; consommationLitres?: number }>)
      .filter((row) => row.site === this.newEntry.site && row.periode === this.newEntry.periode)
      .reduce((total, row) => total + Number(row.consommationLitres ?? 0), 0);
  }

  /** Un statut RH par groupe du site (relevé du mois + relevé antérieur). */
  get groupRhStatuses(): GroupRhStatus[] {
    if (!this.newEntry.site || !this.newEntry.periode) return [];
    const codes = [...new Set((this.dataStore.generatorRows as Array<{ site?: string; code?: string }>)
      .filter((row) => row.site === this.newEntry.site && !!row.code).map((row) => String(row.code)))].sort();
    const readings = this.dataStore.generatorReadingRows as RhReading[];
    return codes.map((code) => groupRhStatus(readings, this.newEntry.site, code, this.newEntry.periode));
  }

  /** Groupes du site sans consommation saisie pour le mois (n'empêche pas l'enregistrement : sortie = 0). */
  get groupsWithoutConsumption(): string[] {
    const rows = this.dataStore.generatorFuelConsumptionRows as Array<{ site?: string; periode?: string; groupeCode?: string }>;
    return this.groupRhStatuses
      .filter((status) => !rows.some((row) => row.site === this.newEntry.site && row.periode === this.newEntry.periode && row.groupeCode === status.code))
      .map((status) => status.code);
  }

  /** Prérequis bloquants, comme côté backend ; vide si l'enregistrement est possible. */
  get missingPrerequisites(): string[] {
    if (!this.newEntry.site || !this.newEntry.periode) return [];
    return [...this.ownPrerequisites(), ...this.laterMonthsPrerequisites()];
  }

  private ownPrerequisites(): string[] {
    const statuses = this.groupRhStatuses;
    // Le premier mois d'un site sans aucune consommation n'exige pas de relevés RH.
    if (this.isInitialFuelMonth && this.calculatedGroupConsumption === 0) return [];
    if (!statuses.length) return ['Aucun groupe électrogène enregistré pour ce site (Suivi groupes électrogènes).'];
    return statuses.map((status) => rhMissingMessage(status, this.newEntry.periode)).filter(Boolean);
  }

  /** Un nouveau mois de départ rend les mois déjà saisis dépendants d'un relevé antérieur : le serveur les recalcule. */
  private laterMonthsPrerequisites(): string[] {
    if (this.editingIndex !== null || !this.isInitialFuelMonth) return [];
    const readings = this.dataStore.generatorReadingRows as RhReading[];
    const codes = this.groupRhStatuses.map((status) => status.code);
    const laterMonths = this.journalRows
      .filter((row) => row.site === this.newEntry.site && row.periode > this.newEntry.periode)
      .map((row) => row.periode);
    return laterMonths.flatMap((periode) => codes
      .map((code) => rhMissingMessage(groupRhStatus(readings, this.newEntry.site, code, periode), periode))
      .filter(Boolean)
      .map((message) => `${message} (le journal ${periode} en dépend)`));
  }

  get calculatedGeneratorHours(): number | null {
    const statuses = this.groupRhStatuses;
    if (!statuses.length || statuses.some((status) => status.hours === null)) return null;
    return statuses.reduce((total, status) => total + (status.hours ?? 0), 0);
  }

  get calculatedStockFinal(): number | null {
    const initial = this.calculatedStockInitial;
    return initial === null ? null : initial + this.calculatedEntries - this.calculatedGroupConsumption;
  }

  get calculatedLitresPerHour(): number | null {
    const hours = this.calculatedGeneratorHours;
    const consumption = this.calculatedGroupConsumption;
    if (hours === null) return null;
    if (hours > 0) return consumption / hours;
    return consumption === 0 ? 0 : null;
  }

  get calculatedGridAvailability(): number | null {
    if (this.isNoGridSite(this.newEntry.site)) return 0;
    const hours = this.calculatedGeneratorHours;
    const [year, month] = this.newEntry.periode.split('-').map(Number);
    if (hours === null || !year || !month) return null;
    const monthHours = new Date(year, month, 0).getDate() * 24;
    return Math.max(0, Math.min(100, (1 - hours / monthHours) * 100));
  }
  get sheetTitle(): string {
    return this.editingIndex === null ? 'Renseigner le journal mensuel' : 'Modifier la ligne du journal';
  }

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

  openSheet(): void { if (!this.canEnterData) return;
    this.editingIndex = null;
    this.newEntry = this.createEmptyEntry();
    this.formError = '';
    this.sheetOpen = true;
  }

  closeSheet(): void {
    if (this.saving) return;
    this.sheetOpen = false;
    this.editingIndex = null;
  }

  changeSite(): void {
    if (this.isNoGridSite(this.newEntry.site)) this.newEntry.snelKwh = null;
  }

  async saveEntry(): Promise<void> {
    this.formError = '';
    if (this.isInitialFuelMonth && !this.canSetInitialStock) {
      this.formError = 'Le stock de départ du premier mois doit être défini par le Manager ou le Chargé des opérations.';
      return;
    }
    if (this.isInitialFuelMonth && (this.newEntry.stockInitial === null || Number(this.newEntry.stockInitial) < 0)) {
      this.formError = 'Le stock de départ est obligatoire pour le premier mois du site.';
      return;
    }
    const entry: Record<string, unknown> = {
      site: this.newEntry.site,
      periode: this.newEntry.periode,
      snelKwh: this.isNoGridSite(this.newEntry.site) ? null : roundToDecimals(this.newEntry.snelKwh || 0, 2),
    };
    if (this.isInitialFuelMonth) entry['stockInitial'] = roundToDecimals(this.newEntry.stockInitial, 3);
    this.saving = true;
    try {
      if (this.editingIndex === null) {
        await this.dataStore.createRecord('fuel-ge', entry);
      } else {
        await this.dataStore.updateRecord('fuel-ge', this.journalRows[this.editingIndex], entry);
      }
      await this.dataStore.refreshFuelJournal();
      this.selectedSite = '';
      this.selectedPeriod = '';
      this.searchTerm = '';
      this.currentPage = 1;
      this.journalOpen = true;
      this.saving = false;
      this.closeSheet();
    } catch (error) {
      const apiError = error as { error?: { detail?: string; message?: string }; message?: string };
      this.formError = apiError?.error?.detail || apiError?.error?.message || apiError?.message || 'Enregistrement impossible. Vérifiez les relevés RH et les données du mois.';
    } finally {
      this.saving = false;
      this.cdr?.markForCheck();
    }
  }
  editEntry(row: MonthlyJournalRow): void {
    this.editingIndex = this.journalRows.indexOf(row);
    this.newEntry = { ...row };
    this.formError = '';
    this.sheetOpen = true;
  }

  requestDeletion(): void {
    const row = this.editingIndex === null ? null : this.journalRows[this.editingIndex];
    if (row) this.pendingDeletion = row;
  }

  cancelDeletion(): void { this.pendingDeletion = null; }

  async confirmDeletion(): Promise<void> {
    const row = this.pendingDeletion;
    if (!row) return;
    this.pendingDeletion = null;
    try {
      await this.dataStore.deleteRecord('fuel-ge', row);
      await this.dataStore.refreshFuelJournal();
      this.selectedSite = '';
      this.selectedPeriod = '';
      this.searchTerm = '';
      this.currentPage = 1;
      this.closeSheet();
    } catch {
      this.formError = 'Suppression impossible : ce journal est nécessaire au calcul des mois suivants.';
    } finally {
      this.cdr?.markForCheck();
    }
  }
  previousPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.pageCount) this.currentPage++; }
  isNoGridSite(site: string): boolean {
    if (this.offGridOverride) return this.offGridOverride.has(site);
    return this.dataStore.offGridSites.includes(site);
  }

  private async loadOffGridSites(api: GmaoApiService | null): Promise<void> {
    if (!api) return;
    try {
      const sites = await api.listSites();
      this.offGridOverride = new Set(sites.filter((site) => site.gridConnected === false).map((site) => site.name));
      this.cdr?.detectChanges();
    } catch {
      this.offGridOverride = null;
    }
  }

  private createEmptyEntry(): MonthlyJournalRow {
    return {
      site: '', periode: '', sortie: 0, stockInitial: null, entree: null, stockFinal: null, heuresGe: 0, litresHeure: null,
      snelKwh: 0, disponibiliteGrid: 0,
    };
  }
}
