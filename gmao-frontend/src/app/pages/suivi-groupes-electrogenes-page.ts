import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseClientService } from '../auth/supabase-client.service';
import { GmaoDataStore } from '../data/gmao-data-store';
import { PdfExportService } from '../shared/pdf-export.service';

type PmState = 'PmDepassee' | 'PmUrgente' | 'ASurveiller' | 'Normal';

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
    private readonly pdfExporter: PdfExportService = new PdfExportService(),
  ) {}

  get generatorRows(): GeneratorRow[] {
    return this.dataStore.generatorRows as GeneratorRow[];
  }

  set generatorRows(value: GeneratorRow[]) {
    this.dataStore.generatorRows = value;
  }

  get canUpdate(): boolean { return this.dataStore.canUpdateGenerators; }
  get canExportPdf(): boolean { return this.dataStore.canExportData; }

  tableVisible = true;
  filtersVisible = true;
  sheetOpen = false;
  selectingGenerator = false;
  selectedGeneratorKey = '';
  saving = false;
  saveError = '';
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

  exportPdf(): void {
    if (!this.canExportPdf) return;
    this.pdfExporter.exportTable({
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
    const row = this.filteredRows[0] || this.generatorRows[0];
    if (!row) return;
    this.selectingGenerator = true;
    this.selectedGeneratorKey = this.rowKey(row);
    this.loadRowInSheet(row);
  }

  selectGenerator(key: string): void {
    const row = this.generatorRows.find((candidate) => this.rowKey(candidate) === key);
    if (row) this.loadRowInSheet(row, true);
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

  async saveGenerator(): Promise<void> {
    if (!this.editingRow || this.saving) return;
    this.saving = true;
    this.saveError = '';
    try {
      const changes: GeneratorRow = {
        ...this.newGenerator,
        rhActuel: Number(this.newGenerator.rhActuel),
        rhDernierePm: Number(this.newGenerator.rhDernierePm),
        rhDepuisDernierePm: this.previewRhDepuisPm,
        rhProchainePm: this.previewProchainePm,
        etat: this.previewState,
        moisReleve: new Date().toISOString().slice(0, 7),
      };
      await this.dataStore.updateRecord('groupes-electrogenes', this.editingRow, changes);
      this.sheetOpen = false;
      this.editingRow = null;
      this.selectingGenerator = false;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'La mise à jour du compteur a échoué.';
    } finally {
      this.saving = false;
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

  private rowKey(row: GeneratorRow): string {
    return row.id || row.code;
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
      rhProchainePm: 250, retardSignale: false, etat: 'Normal', commentaires: '',
    };
  }
}