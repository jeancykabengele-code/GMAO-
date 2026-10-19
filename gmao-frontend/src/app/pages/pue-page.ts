import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';
import {
  PUE_CHECKS, PUE_DETAIL_SECTIONS, PUE_LINES, PUE_MAIN_SECTIONS, PUE_PDF_GROUPS, PUE_SCENARIOS, PUE_SITE, PUE_TABLE_LINES, PUE_THRESHOLD,
  PueInputs, PueLine, PueLineResult, PueRow, PueScenario, PueSummary,
  computeLine, emptyInputs, inputsFromRow, isCosPhiInvalid, kinshasaNow, lineLabel, periodPue, pueExportSheets, summarize, visibleCodes,
} from './pue-lines';

/** Synthèse d'une journée ayant plusieurs relevés : moyennes en kW et PUE du jour (Σ total ÷ Σ IT). */
export interface DaySummary { count: number; itKw: number; nonItKw: number; totalKw: number; pue: number; }

export interface CalendarDay { date: string; row: PueRow | null; summary?: DaySummary; }

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
  readonly scenarios = PUE_SCENARIOS;
  readonly detailSections = PUE_DETAIL_SECTIONS;

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
        this.view = 'synthese';
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  tableOpen = true;
  /** Onglet du tableau : synthèse (IT, hors IT, total, PUE) ou détails facultatifs relevé par relevé. */
  view: 'synthese' | 'details' = 'synthese';
  sheetOpen = false;
  currentPage = 1;
  dateFrom = '';
  dateTo = '';
  editingRow: PueRow | null = null;
  inputs: PueInputs = emptyInputs();
  /** S1 : TGBT + IT mesurés, hors IT déduit. S2 : IT + hors IT mesurés, total déduit. */
  scenario: PueScenario = 'S1';
  saving = false;
  saveError = '';
  deleting = false;
  deleteConfirmationOpen = false;

  /** Tous les relevés du site, du plus récent au plus ancien. */
  get pueRows(): PueRow[] {
    return (this.dataStore.pueRows as PueRow[])
      .filter((row) => row.site === PUE_SITE)
      .sort((a, b) => b.dateReleve.localeCompare(a.dateReleve) || (b.heureReleve ?? '').localeCompare(a.heureReleve ?? ''));
  }

  get filteredRows(): PueRow[] {
    return this.pueRows.filter((row) =>
      (!this.dateFrom || row.dateReleve >= this.dateFrom) && (!this.dateTo || row.dateReleve <= this.dateTo));
  }

  /** Avec une période complète, chaque jour apparaît (relevé ou « Manquant ») ; sinon seulement les relevés saisis. */
  get calendarRows(): CalendarDay[] {
    const byDate = new Map<string, PueRow[]>();
    for (const row of this.filteredRows) byDate.set(row.dateReleve, [...(byDate.get(row.dateReleve) ?? []), row]);
    if (!this.dateFrom || !this.dateTo || this.dateFrom > this.dateTo) {
      return [...byDate.entries()].flatMap(([date, rows]) => this.expandDay(date, rows));
    }
    const today = kinshasaNow().date;
    const last = this.dateTo < today ? this.dateTo : today;
    const days: CalendarDay[] = [];
    const start = Date.parse(`${this.dateFrom}T00:00:00Z`);
    const end = Date.parse(`${last}T00:00:00Z`);
    for (let time = end, count = 0; time >= start && count < MAX_CALENDAR_DAYS; time -= DAY_MS, count++) {
      const date = new Date(time).toISOString().slice(0, 10);
      const rows = byDate.get(date);
      if (rows) days.push(...this.expandDay(date, rows));
      else days.push({ date, row: null });
    }
    return days;
  }

  /** Une journée à plusieurs relevés commence par sa synthèse, suivie des relevés du plus récent au plus ancien. */
  private expandDay(date: string, rows: PueRow[]): CalendarDay[] {
    const readings = rows.map((row) => ({ date, row }));
    return rows.length > 1 ? [{ date, row: null, summary: this.daySummary(rows) }, ...readings] : readings;
  }

  /** PUE d'une journée : rapport des sommes, jamais la moyenne des PUE (même règle que pour une période). */
  daySummary(rows: PueRow[]): DaySummary {
    const count = rows.length;
    const mean = (pick: (row: PueRow) => number) => rows.reduce((sum, row) => sum + pick(row), 0) / count;
    return {
      count,
      itKw: mean((row) => Number(row.itKw)),
      nonItKw: mean((row) => this.nonItKw(row)),
      totalKw: mean((row) => Number(row.totalKw)),
      pue: periodPue(rows),
    };
  }

  get pageCount(): number {
    const total = this.view === 'details' ? this.filteredRows.length : this.calendarRows.length;
    return Math.max(1, Math.ceil(total / this.rowsPerPage));
  }

  setView(view: 'synthese' | 'details'): void {
    this.view = view;
    this.currentPage = 1;
  }

  // Tableau des détails : un relevé par ligne, sans les jours manquants ni les synthèses.
  /** AVR, UPS et redresseurs : une colonne chacun ; les PDF sont additionnés par voie. */
  readonly detailColumns = PUE_TABLE_LINES;
  readonly pdfGroups = PUE_PDF_GROUPS;

  get visibleDetailRows(): PueRow[] {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    return this.filteredRows.slice(start, start + this.rowsPerPage);
  }

  /** kW retenus d'un équipement dans un relevé ; null si la ligne n'a pas été renseignée (ou n'existait pas encore). */
  lineKw(row: PueRow, code: string): number | null {
    const value = row.mesures?.[code]?.kw;
    return typeof value === 'number' ? value : null;
  }

  /** Somme des PDF d'une voie, seulement si tous sont renseignés. */
  pdfSum(row: PueRow, codes: string[]): number | null {
    const values = codes.map((code) => this.lineKw(row, code));
    return values.every((value) => value !== null) ? Math.round(values.reduce((sum: number, value) => sum + (value ?? 0), 0) * 1000) / 1000 : null;
  }

  get visibleDays(): CalendarDay[] {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    return this.calendarRows.slice(start, start + this.rowsPerPage);
  }

  // Résultats de la période choisie.
  get periodPue(): number { return periodPue(this.filteredRows); }
  /** Jours distincts ayant au moins un relevé. */
  get retainedDays(): number { return new Set(this.filteredRows.map((row) => row.dateReleve)).size; }
  get periodDays(): number { return new Set(this.calendarRows.map((day) => day.date)).size; }
  get hasFullPeriod(): boolean { return !!this.dateFrom && !!this.dateTo && this.dateFrom <= this.dateTo; }
  get averageIt(): number { return this.average((row) => Number(row.itKw)); }
  get averageTotal(): number { return this.average((row) => Number(row.totalKw)); }

  // Relevé en cours de saisie.
  get mainSections() { return PUE_MAIN_SECTIONS[this.scenario]; }
  get summary(): PueSummary { return summarize(this.inputs, this.scenario); }
  get calculatedPue(): number { return this.summary.pue ?? 0; }
  get sheetTitle(): string { return this.editingRow ? 'Modifier le relevé du ' + this.formatDate(this.editingRow.dateReleve) : 'Relevé PUE du jour'; }
  get canSubmit(): boolean {
    return !this.saving && !this.deleting && this.summary.complete && this.summary.pue !== null && !this.hasInvalidCosPhi;
  }
  get hasInvalidCosPhi(): boolean {
    return PUE_LINES.some((line) => line.kind === 'ac' && isCosPhiInvalid(this.inputs[line.code].cosPhi));
  }
  isCosPhiInvalid(value: unknown): boolean { return isCosPhiInvalid(value); }

  result(line: PueLine): PueLineResult { return computeLine(line, this.inputs[line.code]); }

  get checks(): Array<{ label: string; partsLabel: string; output: number | null; parts: number | null; gap: number | null }> {
    const pdfChecks = PUE_CHECKS.map((check) => {
      const output = this.result(this.lineByCode(check.output)).kw;
      const partValues = check.parts.map((code) => this.result(this.lineByCode(code)).kw);
      const parts = partValues.some((value) => value === null) ? null : partValues.reduce((sum: number, value) => sum + (value ?? 0), 0);
      const gap = output !== null && parts !== null && output > 0 ? Math.round(((parts - output) / output) * 1000) / 10 : null;
      return { label: check.label, partsLabel: check.partsLabel, output, parts, gap };
    });
    // Les AVR alimentent les TGBT : leur somme doit rester proche du total du site (l'écart correspond aux pertes).
    const avr = ['avr_a', 'avr_b'].map((code) => this.result(this.lineByCode(code)).kw);
    const avrParts = avr.some((value) => value === null) ? null : avr.reduce((sum: number, value) => sum + (value ?? 0), 0);
    const total = this.summary.totalKw > 0 ? this.summary.totalKw : null;
    const avrGap = total !== null && avrParts !== null ? Math.round(((avrParts - total) / total) * 1000) / 10 : null;
    return [{ label: 'Total site', partsLabel: 'AVR A + B', output: total, parts: avrParts, gap: avrGap }, ...pdfChecks];
  }

  /** Écart en % : au-delà de 10 %, la saisie mérite d'être revérifiée. */
  /** Message affiché quand toutes les mesures sont là mais que le résultat est incohérent. */
  get inconsistencyMessage(): string {
    return this.scenario === 'S1'
      ? 'La puissance IT ne peut pas dépasser la puissance totale du site (TGBT A + B).'
      : 'La puissance IT (UPS + redresseurs) doit être supérieure à zéro.';
  }

  isGapHigh(gap: number | null): boolean { return gap !== null && (gap > 10 || gap < -10); }

  isMissingLabel(line: PueLine): boolean { return this.result(line).kw === null; }

  /** Un classeur de deux feuilles, quel que soit l'onglet affiché : « PUE » (synthèse) et « Détails ». */
  exportExcel(): void {
    if (!this.canExportExcel) return;
    void this.excelExporter.exportWorkbook('suivi-pue', pueExportSheets(this.filteredRows));
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
    this.scenario = 'S1';
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
      this.saveError = this.hasInvalidCosPhi
        ? 'Le cos φ doit être compris entre 0 (exclu) et 1.'
        : this.summary.complete
        ? this.inconsistencyMessage
        : `Relevé incomplet : ${this.summary.missing.join(', ')}.`;
      return;
    }
    // Les équipements qui ne font pas partie du scénario choisi ne sont pas envoyés.
    const visible = visibleCodes(this.scenario);
    const mesures = Object.fromEntries(PUE_LINES.map((line) => {
      const input = visible.has(line.code) ? this.inputs[line.code] : { kwLus: null, a: null, v: null, cosPhi: null };
      return [line.code, { kwLus: this.numberOrNull(input.kwLus), a: this.numberOrNull(input.a), v: this.numberOrNull(input.v), ...(line.kind === 'ac' ? { cosPhi: this.numberOrNull(input.cosPhi) } : {}) }];
    }));
    this.saving = true;
    this.saveError = '';
    try {
      if (this.editingRow) await this.dataStore.updateRecord('pue', this.editingRow, { site: PUE_SITE, scenario: this.scenario, mesures });
      else await this.dataStore.createRecord('pue', { site: PUE_SITE, scenario: this.scenario, mesures });
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
    this.scenario = row.scenario === 'S2' ? 'S2' : 'S1';
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

  /** Hors IT = total site − IT déduit (climatisation + charges tertiaires). */
  nonItKw(row: PueRow): number {
    return Math.round((Number(row.totalKw) - Number(row.itKw)) * 1000) / 1000;
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
