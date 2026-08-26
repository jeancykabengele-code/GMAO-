import { ChangeDetectorRef, Component, Optional } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ORANGE_RDC_SITES } from '../data/sites';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';
import { NotificationRecordFocusService } from '../shared/notification-record-focus.service';

type ProblemStatus = 'Open' | 'Ongoing' | 'Closed';
type ProblemPriority = 'P1' | 'P2' | 'P3';

interface DatacenterProblem {
  id?: string;
  site: string;
  date: string;
  equipement: string;
  constat: string;
  statut: ProblemStatus;
  priorite: ProblemPriority | '';
  responsable: string;
  echeance: string;
  besoinSpare: boolean;
  prochaineEtape: string;
}

@Component({
  selector: 'app-problemes-datacenter-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './problemes-datacenter-page.html',
  styleUrls: ['./problemes-datacenter-page.scss'],
})
export class ProblemesDatacenterPageComponent {
  readonly rowsPerPage = 20;
  get sites(): string[] { return this.dataStore.allowedSites; }

  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  readonly statuses: ProblemStatus[] = ['Open', 'Ongoing', 'Closed'];
  readonly priorities: ProblemPriority[] = ['P1', 'P2', 'P3'];

  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly excelExporter: ExcelExportService = new ExcelExportService(),
    @Optional() route: ActivatedRoute | null = null,
    @Optional() public readonly notificationFocus: NotificationRecordFocusService | null = null,
    @Optional() private readonly cdr: ChangeDetectorRef | null = null,
  ) {
    if (route && notificationFocus) notificationFocus.bind(route, {
      rows: () => this.filteredProblemRows,
      clearFilters: () => {
        this.selectedSite = '';
        this.selectedStatus = '';
        this.selectedPriority = '';
        this.searchTerm = '';
        this.journalOpen = true;
      },
      setPage: (page) => { this.currentPage = page; },
      pageSize: this.rowsPerPage,
    });
  }
  get availableEquipments(): Array<{ site: string; code: string; nom: string }> {
    const rows = this.dataStore.equipmentRows as Array<{ site: string; code: string; nom: string }>;
    const site = this.newProblem.site;
    return rows
      .filter((equipment) => !site || equipment.site === site)
      .sort((first, second) => first.code.localeCompare(second.code, 'fr'));
  }

  get problemRows(): DatacenterProblem[] {
    return this.dataStore.problemRows as DatacenterProblem[];
  }

  set problemRows(value: DatacenterProblem[]) {
    this.dataStore.problemRows = value;
  }
  journalOpen = true;
  problemSheetOpen = false;
  currentPage = 1;
  selectedSite = '';
  selectedStatus: ProblemStatus | '' = '';
  selectedPriority: ProblemPriority | '' = '';
  searchTerm = '';
  newProblem: DatacenterProblem = this.createEmptyProblem();

  get filteredProblemRows(): DatacenterProblem[] {
    const query = this.searchTerm.trim().toLocaleLowerCase('fr');

    return this.problemRows.filter((problem) => {
      const matchesSite = !this.selectedSite || problem.site === this.selectedSite;
      const matchesStatus = !this.selectedStatus || problem.statut === this.selectedStatus;
      const matchesPriority =
        !this.selectedPriority || problem.priorite === this.selectedPriority;
      const matchesSearch =
        !query ||
        Object.values(problem).some((value) =>
          String(value).toLocaleLowerCase('fr').includes(query),
        );

      return matchesSite && matchesStatus && matchesPriority && matchesSearch;
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredProblemRows.length / this.rowsPerPage));
  }

  get visibleProblemRows(): Array<DatacenterProblem | null> {
    const start = (this.currentPage - 1) * this.rowsPerPage;
    const rows = this.filteredProblemRows.slice(start, start + this.rowsPerPage);

    return rows;
  }

  exportExcel(): void {
    if (!this.canExportExcel) return;
    this.excelExporter.exportTable({
      title: 'Problèmes Data Center',
      fileName: 'problemes-data-center',
      rows: this.filteredProblemRows,
      columns: [
        { header: 'Site', value: (row) => row.site },
        { header: 'Date', value: (row) => row.date },
        { header: 'Équipement', value: (row) => row.equipement },
        { header: 'Constat', value: (row) => row.constat },
        { header: 'Statut', value: (row) => row.statut },
        { header: 'Priorité', value: (row) => row.priorite },
        { header: 'Responsable', value: (row) => row.responsable },
        { header: 'Échéance', value: (row) => row.echeance },
        { header: 'Besoin spare', value: (row) => row.besoinSpare },
        { header: 'Prochaine étape', value: (row) => row.prochaineEtape },
      ],
    });
  }

  toggleJournal(): void {
    this.journalOpen = !this.journalOpen;
  }

  resetPage(): void {
    this.currentPage = 1;
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.resetPage();
  }

  openProblemSheet(): void {
    this.newProblem = this.createEmptyProblem();
    this.problemSheetOpen = true;
  }

  closeProblemSheet(): void {
    this.problemSheetOpen = false;
  }

  async saveProblem(): Promise<void> {
    await this.dataStore.createRecord('problemes-datacenter', { ...this.newProblem, statut: 'Open' });
    this.selectedSite = '';
    this.selectedStatus = '';
    this.selectedPriority = '';
    this.searchTerm = '';
    this.currentPage = 1;
    this.journalOpen = true;
    this.problemSheetOpen = false;
    this.newProblem = this.createEmptyProblem();
    this.cdr?.markForCheck();
  }

  async changeStatus(problem: DatacenterProblem, status: Exclude<ProblemStatus, 'Open'>): Promise<void> {
    if (problem.statut === 'Closed') return;
    const previousStatus = problem.statut;
    problem.statut = status;
    try {
      await this.dataStore.updateRecord('problemes-datacenter', problem, { ...problem });
    } catch (error) {
      problem.statut = previousStatus;
      throw error;
    } finally {
      this.cdr?.markForCheck();
    }
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

  private createEmptyProblem(): DatacenterProblem {
    return {
      site: '',
      date: '',
      equipement: '',
      constat: '',
      statut: 'Open',
      priorite: '',
      responsable: '',
      echeance: '',
      besoinSpare: false,
      prochaineEtape: '',
    };
  }
}