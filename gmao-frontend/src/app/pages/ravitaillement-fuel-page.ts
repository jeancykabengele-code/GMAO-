import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';

interface FuelDeliveryRow { id?: string; dateRavitaillement: string; site: string; fournisseur: string; bonLivraison: string; typeCarburant: string; quantiteRecue: number; stockAvant: number; stockApres: number; numeroCiterne?: string; receptionnePar: string; commentaires?: string; createdAt?: string; differenceStock?: boolean; }

@Component({ selector: 'app-ravitaillement-fuel-page', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './ravitaillement-fuel-page.html', styleUrls: ['./ravitaillement-fuel-page.scss'] })
export class RavitaillementFuelPageComponent {
  readonly rowsPerPage = 20;
  readonly dataStore: GmaoDataStore;
  readonly excelExporter: ExcelExportService;
  formOpen = false; tableOpen = true; saving = false; errorMessage = ''; currentPage = 1; selectedSite = ''; fromDate = ''; toDate = '';
  entry: ReturnType<RavitaillementFuelPageComponent['createEmptyEntry']>;
  constructor(dataStore: GmaoDataStore, excelExporter: ExcelExportService) { this.dataStore = dataStore; this.excelExporter = excelExporter; this.entry = this.createEmptyEntry(); }
  get rows(): FuelDeliveryRow[] { return this.dataStore.fuelDeliveryRows as FuelDeliveryRow[]; }
  get sites(): string[] { return this.dataStore.allowedSites; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  get filteredRows(): FuelDeliveryRow[] { return this.rows.filter(row => (!this.selectedSite || row.site === this.selectedSite) && (!this.fromDate || row.dateRavitaillement >= this.fromDate) && (!this.toDate || row.dateRavitaillement <= this.toDate)); }
  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRows.length / this.rowsPerPage)); }
  get visibleRows(): FuelDeliveryRow[] { const start = (this.currentPage - 1) * this.rowsPerPage; return this.filteredRows.slice(start, start + this.rowsPerPage); }
  resetPage(): void { this.currentPage = 1; }
  toggleTable(): void { this.tableOpen = !this.tableOpen; }
  previousPage(): void { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void { if (this.currentPage < this.pageCount) this.currentPage++; }
  resetFilters(): void { this.selectedSite = ''; this.fromDate = ''; this.toDate = ''; this.currentPage = 1; }
  exportExcel(): void { if (!this.canExportExcel) return; this.excelExporter.exportTable({ title: 'Ravitaillement Fuel', fileName: 'ravitaillement-fuel', rows: this.filteredRows, columns: [{ header: 'Date du ravitaillement', value: r => r.dateRavitaillement }, { header: 'Site', value: r => r.site }, { header: 'Fournisseur', value: r => r.fournisseur }, { header: 'N° bon de livraison', value: r => r.bonLivraison }, { header: 'Type de carburant', value: r => r.typeCarburant }, { header: 'Quantité reçue (L)', value: r => r.quantiteRecue }, { header: 'Stock avant (L)', value: r => r.stockAvant }, { header: 'Stock après (L)', value: r => r.stockApres }, { header: 'Réceptionné par', value: r => r.receptionnePar }, { header: 'Commentaires', value: r => r.commentaires ?? '' }, { header: 'Date d’enregistrement', value: r => r.createdAt ?? '' }] }); }
  openForm(): void { this.errorMessage = ''; this.entry = this.createEmptyEntry(); this.formOpen = true; }
  closeForm(): void { if (!this.saving) this.formOpen = false; }
  calculatedStockAfter(): number | null { if (this.entry.stockAvant === null || this.entry.quantiteRecue === null) return null; return Number(this.entry.stockAvant) + Number(this.entry.quantiteRecue); }
  async save(): Promise<void> { this.errorMessage = ''; if (!this.entry.site || !this.entry.dateRavitaillement || !this.entry.fournisseur || !this.entry.bonLivraison || !this.entry.receptionnePar) { this.errorMessage = 'Complétez les champs obligatoires.'; return; } if (this.entry.quantiteRecue === null || this.entry.stockAvant === null || this.entry.quantiteRecue < 0 || this.entry.stockAvant < 0) { this.errorMessage = 'La quantité et le stock avant doivent être positifs ou nuls.'; return; } if (this.entry.stockApres === null) this.entry.stockApres = this.calculatedStockAfter(); if (this.entry.stockApres === null || this.entry.stockApres < 0) { this.errorMessage = 'Le stock après livraison est invalide.'; return; } this.saving = true; try { await this.dataStore.createRecord('fuel-ravitaillements', { ...this.entry }); this.formOpen = false; } catch (error) { this.errorMessage = error instanceof Error ? error.message : 'Enregistrement impossible.'; } finally { this.saving = false; } }
  private createEmptyEntry() { return { dateRavitaillement: '', site: this.sites[0] ?? '', fournisseur: '', bonLivraison: '', typeCarburant: 'Diesel', quantiteRecue: null as number | null, stockAvant: null as number | null, stockApres: null as number | null, numeroCiterne: '', receptionnePar: '', commentaires: '' }; }
}