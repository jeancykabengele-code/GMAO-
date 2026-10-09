import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';
import {
  PUE_CHECKS, PUE_LINES, PUE_SECTIONS, PUE_SITE, PUE_THRESHOLD, PueInputs, PueLine, PueLineResult, PueRow, PueSummary,
  computeLine, emptyInputs, inputsFromRow, kinshasaNow, lineLabel, periodPue, summarize,
} from './pue-lines';

export interface CalendarDay { date: string; row: PueRow | null; }

const DAY_MS = 86400000;
const MAX_CALENDAR_DAYS = 366;

@Component({
  selector: 'app-pue-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pue-page.html',
  styleUrls: ['./pue-page.scss'],
})
export class PuePageComponent {
  readonly rowsPerPage = 20;
  readonly site = PUE_SITE;
  readonly threshold = PUE_THRESHOLD;
  readonly sections = PUE_SECTIONS;

  /** Corriger un relevé : rôles globaux et Chef de site (sur son site). */
  get canModify(): boolean { return this.dataStore.canModifyExisting || this.dataStore.isChefSite; }
  /** Supprimer un relevé : rôles globaux seulement. */
  get canDelete(): boolean { return this.dataStore.canModifyExisting; }
  get canEnterData(): boolean { return this.dataStore.canEnterData; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.calendarRows.map((day) => day.row).filter((row): row is PueRow => !!row),
      clearFilters: () => {
        this.dateFrom = '';
        this.dateTo = '';
        this.tableOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  tableOpen = true;
  sheetOpen = false;
  currentPage = 1;
  dateFrom = '';
  dateTo = '';
  editingRow: PueRow | null = null;
  inputs: PueInputs = emptyInputs();
  saving = false;
  saveError = '';
  deleting = false;
  deleteConfirmationOpen = false;

  /** Tous les relevés du site, du plus récent au plus ancien. */
  get pueRows(): PueRow[] {
    return (this.dataStore.pueRows as PueRow[])
      .filter((row) => row.site === PUE_SITE)
      .sort((a, b) => b.dateReleve.localeCompare(a.dateReleve));
  }

  get filteredRows(): PueRow[] {
    return this.pueRows.filter((row) =>
      (!this.dateFrom || row.dateReleve >= this.dateFrom) && (!this.dateTo || row.dateReleve <= this.dateTo));
  }

  /** Avec une période complète, chaque jour apparaît (relevé ou « Manquant ») ; sinon seulement les relevés saisis. */
  get calendarRows(): CalendarDay[] {
    if (!this.dateFrom || !this.dateTo || this.dateFrom > this.dateTo) {
      return this.filteredRows.map((row) => ({ date: row.dateReleve, row }));
    }
    const byDate = new Map(this.filteredRows.map((row) => [row.dateReleve, row]));
    const today = kinshasaNow().date;
    const last = this.dateTo < today ? this.dateTo : today;
    const days: CalendarDay[] = [];
    const start = Date.parse(`${this.dateFrom}T00:00:00Z`);
    const end = Date.parse(`${last}T00:00:00Z`);
    for (let time = end; time >= start && days.length < MAX_CALENDAR_DAYS; time -= DAY_MS) {
      const date = new Date(time).toISOString().slice(0, 10);
      days.push({ date, row: byDate.get(date) ?? null });
    }
    return days;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.calendarRows.length / this.rowsPerPage));
  }

  get visibleDays(): CalendarDay[] {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    return this.calendarRows.slice(start, start + this.rowsPerPage);
  }

  // Résultats de la période choisie.
  get periodPue(): number { return periodPue(this.filteredRows); }
  get retainedDays(): number { return this.filteredRows.length; }
  get periodDays(): number { return this.calendarRows.length; }
  get hasFullPeriod(): boolean { return !!this.dateFrom && !!this.dateTo && this.dateFrom <= this.dateTo; }
  get averageIt(): number { return this.average((row) => Number(row.itKw)); }
  get averageTotal(): number { return this.average((row) => Number(row.totalKw)); }

  // Tendance : PUE du jour, du plus ancien au plus récent.
  readonly chartWidth = 760;
  readonly chartHeight = 240;
  private readonly chartPad = { left: 44, right: 16, top: 16, bottom: 30 };
  readonly chartMin = 1;
  readonly chartMax = 3;

  get trendRows(): PueRow[] { return [...this.filteredRows].reverse(); }

  chartY(value: number): number {
    const clamped = Math.min(this.chartMax, Math.max(this.chartMin, value));
    const inner = this.chartHeight - this.chartPad.top - this.chartPad.bottom;
    return this.chartPad.top + inner * (1 - (clamped - this.chartMin) / (this.chartMax - this.chartMin));
  }

  get chartPoints(): Array<{ x: number; y: number; row: PueRow }> {
    const rows = this.trendRows;
    const inner = this.chartWidth - this.chartPad.left - this.chartPad.right;
    return rows.map((row, index) => ({
      x: this.chartPad.left + (rows.length === 1 ? inner / 2 : (inner * index) / (rows.length - 1)),
      y: this.chartY(Number(row.pue)),
      row,
    }));
  }

  get chartPolyline(): string { return this.chartPoints.map((point) => `${point.x},${point.y}`).join(' '); }
  get chartLeft(): number { return this.chartPad.left; }
  get chartRight(): number { return this.chartWidth - this.chartPad.right; }
  get chartBottom(): number { return this.chartHeight - this.chartPad.bottom; }
  readonly chartTicks = [1, 1.5, 2, 2.5, 3];

  // Aujourd'hui (heure de Kinshasa).
  get todayKey(): string { return kinshasaNow().date; }
  get todayRow(): PueRow | null { return this.pueRows.find((row) => row.dateReleve === this.todayKey) ?? null; }

  // Relevé en cours de saisie.
  get summary(): PueSummary { return summarize(this.inputs); }
  get calculatedPue(): number { return this.summary.pue ?? 0; }
  get sheetTitle(): string { return this.editingRow ? 'Modifier le relevé du ' + this.formatDate(this.editingRow.dateReleve) : 'Relevé PUE du jour'; }
  get canSubmit(): boolean {
    return !this.saving && !this.deleting && this.summary.complete && this.summary.pue !== null;
  }

  result(line: PueLine): PueLineResult { return computeLine(line, this.inputs[line.code]); }

  get checks(): Array<{ label: string; output: number | null; parts: number | null; gap: number | null }> {
    return PUE_CHECKS.map((check) => {
      const output = this.result(this.lineByCode(check.output)).kw;
      const partValues = check.parts.map((code) => this.result(this.lineByCode(code)).kw);
      const parts = partValues.some((value) => value === null) ? null : partValues.reduce((sum: number, value) => sum + (value ?? 0), 0);
      const gap = output !== null && parts !== null && output > 0 ? Math.round(((parts - output) / output) * 1000) / 10 : null;
      return { label: check.label, output, parts, gap };
    });
  }

  isMissingLabel(line: PueLine): boolean { return this.result(line).kw === null; }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: `Suivi du PUE — ${PUE_SITE}`,
      fileName: 'suivi-pue',
      rows: this.filteredRows,
      columns: [
        { header: 'Date', value: (row) => row.dateReleve },
        { header: 'Heure', value: (row) => row.heureReleve?.slice(0, 5) },
        { header: 'IT (kW)', value: (row) => row.itKw },
        { header: 'Total site (kW)', value: (row) => row.totalKw },
        { header: 'PUE', value: (row) => row.pue },
        { header: 'État', value: (row) => this.getState(row.pue) },
      ],
    });
  }

  toggleTable(): void { this.tableOpen = !this.tableOpen; }
  resetPage(): void { this.currentPage = 1; }

  clearPeriod(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.currentPage = 1;
  }

  openSheet(): void {
    if (!this.canEnterData) return;
    this.editingRow = null;
    this.inputs = emptyInputs();
    this.saveError = '';
    this.sheetOpen = true;
  }

  closeSheet(): void {
    if (this.deleting || this.saving) return;
    this.sheetOpen = false;
    this.editingRow = null;
    this.saveError = '';
  }

  async saveEntry(): Promise<void> {
    if (!this.canSubmit) {
      this.saveError = this.summary.complete
        ? 'Le total du site (TGBT A + B) ne peut pas être inférieur à la puissance IT.'
        : `Relevé incomplet : ${this.summary.missing.join(', ')}.`;
      return;
    }
    const mesures = Object.fromEntries(PUE_LINES.map((line) => {
      const input = this.inputs[line.code];
      return [line.code, { kwLus: this.numberOrNull(input.kwLus), a: this.numberOrNull(input.a), v: this.numberOrNull(input.v) }];
    }));
    this.saving = true;
    this.saveError = '';
    try {
      if (this.editingRow) await this.dataStore.updateRecord('pue', this.editingRow, { site: PUE_SITE, mesures });
      else await this.dataStore.createRecord('pue', { site: PUE_SITE, mesures });
      this.currentPage = 1;
      this.tableOpen = true;
      this.saving = false;
      this.closeSheet();
    } catch (reason) {
      this.saveError = this.errorDetail(reason);
    } finally {
      this.saving = false;
      this.cdr?.markForCheck();
    }
  }

  editEntry(row: PueRow): void {
    this.editingRow = row;
    this.inputs = inputsFromRow(row);
    this.saveError = '';
    this.sheetOpen = true;
  }

  requestDeletion(): void {
    if (this.editingRow && this.canDelete && !this.deleting) this.deleteConfirmationOpen = true;
  }

  cancelDeletion(): void {
    if (!this.deleting) this.deleteConfirmationOpen = false;
  }

  async deleteEntry(): Promise<void> {
    if (!this.editingRow || !this.canDelete || this.deleting) return;
    this.deleting = true;
    try {
      await this.dataStore.deleteRecord('pue', this.editingRow);
      this.deleteConfirmationOpen = false;
      if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
      this.deleting = false;
      this.closeSheet();
    } catch (reason) {
      this.deleteConfirmationOpen = false;
      this.saveError = this.errorDetail(reason);
    } finally {
      this.deleting = false;
      this.cdr?.markForCheck();
    }
  }

  getState(pue: number): string {
    return pue <= PUE_THRESHOLD ? '≤ 1,8' : '> 1,8';
  }

  formatDate(date: string): string {
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  }

  label(code: string): string { return lineLabel(code); }

  previousPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.pageCount) this.currentPage++; }

  private lineByCode(code: string): PueLine {
    return PUE_LINES.find((line) => line.code === code) as PueLine;
  }

  private average(pick: (row: PueRow) => number): number {
    const rows = this.filteredRows;
    return rows.length ? rows.reduce((sum, row) => sum + pick(row), 0) / rows.length : 0;
  }

  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private errorDetail(reason: unknown): string {
    const detail = (reason as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'Enregistrement impossible. Vérifiez le relevé et réessayez.';
  }
}
