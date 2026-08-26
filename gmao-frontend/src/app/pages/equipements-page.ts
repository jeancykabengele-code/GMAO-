import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

type EquipmentFamily = 'Energie' | 'Climatisation' | 'IT' | 'Securite' | 'Anti-incendie' | 'Plomberie/hydraulique' | 'Batiment' | 'Telecoms';
type EquipmentCriticality = 'Faible' | 'Moyenne' | 'Elevee' | 'Critique';
type EquipmentState = 'En service' | 'Hors service' | 'En panne' | 'En maintenance';

interface EquipmentRow {
  id?: string;
  site: string;
  code: string;
  nom: string;
  dateMiseEnService: string;
  famille: EquipmentFamily;
  localisation: string;
  marqueModele: string;
  etat: EquipmentState;
  criticite: EquipmentCriticality;
}

@Component({
  selector: 'app-equipements-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './equipements-page.html',
  styleUrls: ['./equipements-page.scss'],
})
export class EquipementsPageComponent {
  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  readonly families: EquipmentFamily[] = ['Energie', 'Climatisation', 'IT', 'Securite', 'Anti-incendie', 'Plomberie/hydraulique', 'Batiment', 'Telecoms'];
  readonly criticalities: EquipmentCriticality[] = ['Faible', 'Moyenne', 'Elevee', 'Critique'];
  readonly states: EquipmentState[] = ['En service', 'Hors service', 'En panne', 'En maintenance'];

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
        this.selectedFamily = '';
        this.selectedCriticality = '';
        this.selectedState = '';
        this.tableOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }

  get equipmentRows(): EquipmentRow[] {
    return this.dataStore.equipmentRows as EquipmentRow[];
  }

  set equipmentRows(value: EquipmentRow[]) {
    this.dataStore.equipmentRows = value;
  }
  tableOpen = true;
  sheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedFamily: EquipmentFamily | '' = '';
  selectedCriticality: EquipmentCriticality | '' = '';
  selectedState: EquipmentState | '' = '';
  editingIndex: number | null = null;
  newEquipment: EquipmentRow = this.createEmptyEquipment();

  get filteredRows(): EquipmentRow[] {
    return this.equipmentRows.filter((row) => {
      const matchesSite = !this.selectedSite || row.site === this.selectedSite;
      const matchesFamily = !this.selectedFamily || row.famille === this.selectedFamily;
      const matchesCriticality = !this.selectedCriticality || row.criticite === this.selectedCriticality;
      const matchesState = !this.selectedState || row.etat === this.selectedState;
      return matchesSite && matchesFamily && matchesCriticality && matchesState;
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage));
  }

  get visibleRows(): Array<EquipmentRow | null> {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    const rows = this.filteredRows.slice(start, start + this.rowsPerPage);
    return rows;
  }

  get sheetTitle(): string {
    return this.editingIndex === null ? 'Renseigner un equipement' : "Modifier l'equipement";
  }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: 'Registre des équipements',
      fileName: 'registre-equipements',
      rows: this.filteredRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Code', value: (row) => row.code },
        { header: 'Nom', value: (row) => row.nom },
        { header: 'Mise en service', value: (row) => row.dateMiseEnService },
        { header: 'Famille', value: (row) => this.familyLabel(row.famille) },
        { header: 'Localisation', value: (row) => row.localisation },
        { header: 'Marque / Modèle', value: (row) => row.marqueModele },
        { header: 'État', value: (row) => row.etat },
        { header: 'Criticité', value: (row) => this.criticalityLabel(row.criticite) },
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
    this.newEquipment = this.createEmptyEquipment();
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
    this.editingIndex = null;
  }

  async saveEquipment(): Promise<void> {
    const equipment = { ...this.newEquipment };
    if (this.editingIndex === null) {
      await this.dataStore.createRecord('equipements', equipment);
    } else {
      await this.dataStore.updateRecord('equipements', this.equipmentRows[this.editingIndex], equipment);
    }
    this.selectedSite = '';
    this.selectedFamily = '';
    this.selectedCriticality = '';
    this.selectedState = '';
    this.currentPage = 1;
    this.tableOpen = true;
    this.closeSheet();
    this.cdr?.markForCheck();
  }

  editEquipment(row: EquipmentRow): void {
    this.editingIndex = this.equipmentRows.indexOf(row);
    this.newEquipment = { ...row };
    this.sheetOpen = true;
  }

  async deleteEquipment(row: EquipmentRow): Promise<void> {
    const confirmed = window.confirm(`Supprimer définitivement l'équipement ${row.code} ?`);
    if (!confirmed) return;
    await this.dataStore.deleteRecord('equipements', row);
    if (this.currentPage > this.pageCount) this.currentPage = this.pageCount;
  }

  familyLabel(family: EquipmentFamily): string {
    const labels: Record<EquipmentFamily, string> = {
      Energie: '\u00c9nergie', Climatisation: 'Climatisation', IT: 'IT', Securite: 'S\u00e9curit\u00e9',
      'Anti-incendie': 'Anti-incendie', 'Plomberie/hydraulique': 'Plomberie/hydraulique',
      Batiment: 'B\u00e2timent', Telecoms: 'T\u00e9l\u00e9coms',
    };
    return labels[family];
  }

  criticalityLabel(value: EquipmentCriticality): string {
    return value === 'Elevee' ? '\u00c9lev\u00e9e' : value;
  }

  previousPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage < this.pageCount) this.currentPage++;
  }

  private createEmptyEquipment(): EquipmentRow {
    return { site: '', code: '', nom: '', dateMiseEnService: '', famille: 'Energie', localisation: '', marqueModele: '', etat: 'En service', criticite: 'Moyenne' };
  }
}