import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseClientService } from '../auth/supabase-client.service';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

type PmState = 'PmDepassee' | 'PmUrgente' | 'ASurveiller' | 'Normal';

interface MonthlyReadingRow {
  id?: string;
  site: string;
  groupeCode: string;
  periode: string;
  rhActuel: number;
  commentaires: string;
}

interface EquipmentRow {
  id?: string;
  site: string;
  code: string;
  nom: string;
  famille: string;
  marqueModele: string;
}

interface GeneratorRow {
  id?: string;
  site: string;
  code: string;
  typeGe: string;
  moisReleve: string;
  dateMiseEnService: string | null;
  dateDernierePm: string | null;
  rhActuel: number;
  rhDernierePm: number;
  rhDepuisDernierePm: number;
  rhProchainePm: number;
  retardSignale: boolean;
  etat: PmState;
  commentaires: string;
  updatedAt?: string | null;
}

@Component({
  selector: 'app-suivi-groupes-electrogenes-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './suivi-groupes-electrogenes-page.html',
  styleUrls: ['./suivi-groupes-electrogenes-page.scss'],
})
export class SuiviGroupesElectrogenesPageComponent implements OnInit, OnDestroy {
  private realtimeChannel: RealtimeChannel | null = null;
  readonly pageSize = 20;

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly supabase: SupabaseClientService = new SupabaseClientService(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredRows,
      clearFilters: () => {
        this.searchTerm = '';
        this.selectedSite = '';
        this.selectedPeriod = '';
        this.selectedPmState = '';
        this.tableVisible = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.pageSize,
    });
  }

  get generatorRows(): GeneratorRow[] {
    return this.dataStore.generatorRows as GeneratorRow[];
  }

  set generatorRows(value: GeneratorRow[]) {
    this.dataStore.generatorRows = value;
  }

  get generatorReadingRows(): MonthlyReadingRow[] {
    return this.dataStore.generatorReadingRows as MonthlyReadingRow[];
  }

  get readingHistory(): Array<MonthlyReadingRow & { code: string; typeGe: string }> {
    const generators = new Map(this.generatorRows.map((row) => [`${row.site}::${row.code}`, row]));
    return this.generatorReadingRows
      .map((reading) => {
        const generator = generators.get(`${reading.site}::${reading.groupeCode}`);
        return generator ? { ...reading, code: generator.code, typeGe: generator.typeGe } : null;
      })
      .filter((row): row is MonthlyReadingRow & { code: string; typeGe: string } => row !== null)
      .sort((left, right) => `${right.periode} ${right.code}`.localeCompare(`${left.periode} ${left.code}`, 'fr'));
  }

  get canUpdate(): boolean { return this.dataStore.canUpdateGenerators; }

  get entrySites(): string[] { return this.dataStore.allowedSites; }

  get equipmentRows(): EquipmentRow[] {
    return this.dataStore.equipmentRows as EquipmentRow[];
  }

  set equipmentRows(value: EquipmentRow[]) {
    this.dataStore.equipmentRows = value;
  }

  get availableEquipmentGroups(): EquipmentRow[] {
    return this.equipmentRows
      .filter((row) => row.site === this.newGenerator.site && this.isGeneratorEquipment(row))
      .sort((left, right) => (left.code + ' ' + left.nom).localeCompare(right.code + ' ' + right.nom, 'fr'));
  }
  get canDelete(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }

  tableVisible = true;
  filtersVisible = true;
  sheetOpen = false;
  selectingGenerator = false;
  creatingGenerator = false;
  selectedGeneratorKey = '';
  saving = false;
  deleting = false;
  saveError = '';
  deleteConfirmationOpen = false;
  editingRow: GeneratorRow | null = null;
  newGenerator: GeneratorRow = this.createEmptyGenerator();

  searchTerm = '';
  selectedSite = '';
  selectedPeriod = '';
  selectedPmState: PmState | '' = '';
  currentPage = 1;

  get sites(): string[] {
    return [...new Set(this.generatorRows.map((row) => row.site).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  get periods(): string[] {
    return [...new Set(this.generatorRows.map((row) => row.moisReleve).filter(Boolean))].sort().reverse();
  }

  get filteredRows(): GeneratorRow[] {
    const query = this.searchTerm.trim().toLocaleLowerCase('fr');
    return this.generatorRows.filter((row) => {
      const searchable = `${row.site} ${row.code} ${row.typeGe} ${row.commentaires || ''}`.toLocaleLowerCase('fr');
      return (!query || searchable.includes(query))
        && (!this.selectedSite || row.site === this.selectedSite)
        && (!this.selectedPeriod || row.moisReleve === this.selectedPeriod)
        && (!this.selectedPmState || row.etat === this.selectedPmState);
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  get visibleRows(): GeneratorRow[] {
    const page = Math.min(this.currentPage, this.pageCount);
    const start = (page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  ngOnInit(): void {
    if (!this.supabase.configured) return;
    this.realtimeChannel = this.supabase.client
      .channel('gmao-ge-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gmao_groupes_electrogenes' },
        () => void this.dataStore.refreshResource('groupes-electrogenes'),
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.realtimeChannel) void this.supabase.client.removeChannel(this.realtimeChannel);
  }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: 'Suivi des groupes électrogènes',
      fileName: 'suivi-groupes-electrogenes',
      rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Code', value: (row) => row.code },
        { header: 'Groupe', value: (row) => row.typeGe },
        { header: 'Mois relevé', value: (row) => row.moisReleve },
        { header: 'RH actuel', value: (row) => row.rhActuel },
        { header: 'RH dernière PM', value: (row) => row.rhDernierePm },
        { header: 'RH depuis PM', value: (row) => row.rhDepuisDernierePm },
        { header: 'Prochaine PM', value: (row) => row.rhProchainePm },
        { header: 'État', value: (row) => this.pmStateLabel(row.etat) },
        { header: 'Commentaires', value: (row) => row.commentaires },
      ],
    });
  }

  toggleTable(): void {
    this.tableVisible = !this.tableVisible;
  }

  toggleFilters(): void {
    this.filtersVisible = !this.filtersVisible;
  }

  resetPage(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedSite = '';
    this.selectedPeriod = '';
    this.selectedPmState = '';
    this.resetPage();
  }

  previousPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage < this.pageCount) this.currentPage++;
  }

  openEntrySheet(): void {
    this.creatingGenerator = false;
    this.selectingGenerator = true;
    this.editingRow = null;
    this.newGenerator = {
      ...this.createEmptyGenerator(),
      site: this.entrySites.find((site) => this.equipmentRows.some((row) => row.site === site && this.isGeneratorEquipment(row))) || this.entrySites[0] || '',
      moisReleve: new Date().toISOString().slice(0, 7),
    };
    this.selectedGeneratorKey = this.equipmentKey(this.availableEquipmentGroups[0]);
    this.saveError = '';
    this.sheetOpen = true;
    if (this.selectedGeneratorKey) this.selectEquipment(this.selectedGeneratorKey);
  }

  selectEquipment(key: string): void {
    const equipment = this.availableEquipmentGroups.find((candidate) => this.equipmentKey(candidate) === key);
    if (!equipment) return;
    this.selectedGeneratorKey = key;
    const existing = this.generatorRows.find((row) => row.site === equipment.site && row.code === equipment.code);
    if (existing) {
      this.creatingGenerator = false;
      this.loadRowInSheet(existing, true);
      this.newGenerator.moisReleve = new Date().toISOString().slice(0, 7);
      return;
    }
    this.creatingGenerator = true;
    this.editingRow = null;
    this.newGenerator = {
      ...this.createEmptyGenerator(),
      site: equipment.site,
      code: equipment.code,
      typeGe: equipment.nom || equipment.marqueModele,
      moisReleve: this.newGenerator.moisReleve || new Date().toISOString().slice(0, 7),
    };
  }
  openSheet(row: GeneratorRow): void {
    this.selectingGenerator = false;
    this.selectedGeneratorKey = this.rowKey(row);
    this.loadRowInSheet(row);
  }

  closeSheet(): void {
    if (this.saving) return;
    this.sheetOpen = false;
    this.editingRow = null;
    this.selectingGenerator = false;
    this.creatingGenerator = false;
  }
  get previewRhDepuisPm(): number {
    return Math.max(0, Number(this.newGenerator.rhActuel || 0) - Number(this.newGenerator.rhDernierePm || 0));
  }

  get previewProchainePm(): number {
    return Number(this.newGenerator.rhDernierePm || 0) + 250;
  }

  get previewState(): PmState {
    return this.calculateState(this.previewRhDepuisPm, this.newGenerator.retardSignale);
  }

  get lastReadingLabel(): string {
    return this.formatReadingDate(this.newGenerator.updatedAt);
  }

  get lastReadingAgeLabel(): string {
    const days = this.readingAgeDays(this.newGenerator.updatedAt);
    if (days === null) return 'Aucun relevé enregistré';
    if (days === 0) return 'Relevé effectué aujourd’hui';
    return 'Dernier relevé il y a ' + days + ' jour' + (days > 1 ? 's' : '');
  }

  readingAgeDays(value: string | null | undefined): number | null {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return null;
    return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  }

  readingFreshnessLabel(value: string | null | undefined): string {
    const days = this.readingAgeDays(value);
    if (days === null) return 'Non renseigné';
    if (days >= 14) return 'Relevé ancien';
    if (days >= 7) return 'À mettre à jour';
    return 'À jour';
  }

  async saveGenerator(): Promise<void> {
    if ((!this.editingRow && !this.creatingGenerator) || this.saving) return;
    this.saving = true;
    this.saveError = '';
    try {
      if (this.creatingGenerator) {
        await this.dataStore.createRecord('groupes-electrogenes', {
          site: this.newGenerator.site,
          code: this.newGenerator.code,
          typeGe: this.newGenerator.typeGe,
          moisReleve: this.newGenerator.moisReleve,
          rhActuel: Number(this.newGenerator.rhActuel),
          rhDernierePm: Number(this.newGenerator.rhDernierePm),
          retardSignale: false,
          commentaires: this.newGenerator.commentaires,
        });
      }
      await this.dataStore.createRecord('releves-rh-ge', {
        site: this.newGenerator.site,
        groupeCode: this.newGenerator.code,
        periode: this.newGenerator.moisReleve,
        rhActuel: Number(this.newGenerator.rhActuel),
        commentaires: this.newGenerator.commentaires,
      });
      await this.dataStore.refreshResource('groupes-electrogenes');
      this.sheetOpen = false;
      this.editingRow = null;
      this.selectingGenerator = false;
      this.creatingGenerator = false;
    } catch (error) {
      const apiError = error as { error?: { detail?: string; message?: string }; message?: string };
      this.saveError = apiError?.error?.detail || apiError?.error?.message || apiError?.message || 'L’enregistrement du relevé RH a échoué.';
    } finally {
      this.saving = false;
      this.cdr?.markForCheck();
    }
  }
  requestDeletion(): void {
    if (!this.editingRow || this.saving || this.deleting) return;
    this.deleteConfirmationOpen = true;
  }

  cancelDeletion(): void {
    if (!this.deleting) this.deleteConfirmationOpen = false;
  }

  async deleteGenerator(): Promise<void> {
    if (!this.editingRow || this.deleting) return;
    this.deleting = true;
    this.saveError = '';
    try {
      await this.dataStore.deleteRecord('groupes-electrogenes', this.editingRow);
      this.deleteConfirmationOpen = false;
      this.sheetOpen = false;
      this.editingRow = null;
      this.selectingGenerator = false;
      if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
    } catch (error) {
      this.deleteConfirmationOpen = false;
      this.saveError = error instanceof Error ? error.message : 'La suppression du groupe électrogène a échoué.';
    } finally {
      this.deleting = false;
      this.cdr?.markForCheck();
    }
  }
  async refresh(): Promise<void> {
    await this.dataStore.refreshResource('groupes-electrogenes');
    if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
  }

  pmStateLabel(state: PmState): string {
    const labels: Record<PmState, string> = {
      PmDepassee: 'PM dépassée',
      PmUrgente: 'PM urgente',
      ASurveiller: 'À surveiller',
      Normal: 'Normal',
    };
    return labels[state];
  }

  private loadRowInSheet(row: GeneratorRow, keepSelectionMode = false): void {
    this.editingRow = row;
    this.newGenerator = { ...row };
    this.selectedGeneratorKey = this.rowKey(row);
    this.selectingGenerator = keepSelectionMode || this.selectingGenerator;
    this.saveError = '';
    this.sheetOpen = true;
  }

  private equipmentKey(row: EquipmentRow | undefined): string {
    return row ? (row.id || `${row.site}::${row.code}`) : '';
  }

  private isGeneratorEquipment(row: EquipmentRow): boolean {
    const normalize = (value: string | undefined) => (value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    const code = normalize(row.code);
    const description = normalize(`${row.nom} ${row.marqueModele}`);
    return normalize(row.famille) === 'energie'
      && (description.includes('groupe') || description.includes('electrogene') || /(^|[^a-z0-9])ge([^a-z0-9]|$)/.test(code));
  }
  private rowKey(row: GeneratorRow): string {
    return row.id || row.code;
  }

  formatReadingDate(value: string | null | undefined): string {
    if (!value) return 'Non renseigné';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Non renseigné';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private calculateState(hoursSincePm: number, delayed: boolean): PmState {
    if (hoursSincePm >= 250) return 'PmDepassee';
    if (hoursSincePm >= 225) return 'PmUrgente';
    if (hoursSincePm >= 175 || delayed) return 'ASurveiller';
    return 'Normal';
  }

  private createEmptyGenerator(): GeneratorRow {
    return {
      site: '', code: '', typeGe: '', moisReleve: '', dateMiseEnService: null,
      dateDernierePm: null, rhActuel: 0, rhDernierePm: 0, rhDepuisDernierePm: 0,
      rhProchainePm: 250, retardSignale: false, etat: 'Normal', commentaires: '', updatedAt: null,
    };
  }
}