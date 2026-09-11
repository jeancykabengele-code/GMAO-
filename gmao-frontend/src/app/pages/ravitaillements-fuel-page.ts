import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';
import { ExcelExportService } from '../shared/excel-export.service';

interface FuelDeliveryRow { id?: string; site: string; date: string; fournisseur: string; bonLivraison: string; typeCarburant: string; quantiteLitres: number; stockAvant: number; stockApres: number; camion: string; receptionnePar: string; commentaires: string; }

@Component({ selector: 'app-ravitaillements-fuel-page', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './ravitaillements-fuel-page.html', styleUrls: ['./ravitaillements-fuel-page.scss'] })
export class RavitaillementsFuelPageComponent {
  readonly pageSize = 20;
  sheetOpen = false; saving = false; saveError = ''; editingRow: FuelDeliveryRow | null = null; currentPage = 1; searchTerm = ''; selectedSite = ''; selectedMonth = '';
  newDelivery: FuelDeliveryRow = this.emptyDelivery();
  constructor(private readonly dataStore: GmaoDataStore = new GmaoDataStore(), private readonly excel: ExcelExportService = new ExcelExportService()) {}
  get rows(): FuelDeliveryRow[] { return this.dataStore.fuelDeliveryRows as FuelDeliveryRow[]; }
  get canExportExcel(): boolean { return this.dataStore.canExportData; }
  get canModify(): boolean { return this.dataStore.canModifyExisting; }
  get sites(): string[] { return this.dataStore.allowedSites; }
  get filteredRows(): FuelDeliveryRow[] { const q=this.searchTerm.trim().toLowerCase(); return this.rows.filter(r => (!this.selectedSite || r.site===this.selectedSite) && (!this.selectedMonth || r.date?.startsWith(this.selectedMonth)) && (!q || (r.site + ' ' + r.fournisseur + ' ' + r.bonLivraison + ' ' + r.receptionnePar).toLowerCase().includes(q))).sort((a,b)=>String(b.date).localeCompare(String(a.date))); }
  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize)); }
  get visibleRows(): FuelDeliveryRow[] { const page=Math.min(this.currentPage,this.pageCount); return this.filteredRows.slice((page-1)*this.pageSize,page*this.pageSize); }
  get calculatedStockAfter(): number { return Number(this.newDelivery.stockAvant || 0) + Number(this.newDelivery.quantiteLitres || 0); }
  resetPage(): void { this.currentPage=1; }
  previousPage(): void { if (this.currentPage>1) this.currentPage--; }
  nextPage(): void { if (this.currentPage<this.pageCount) this.currentPage++; }
  openSheet(): void { this.editingRow=null; this.newDelivery=this.emptyDelivery(); this.saveError=''; this.sheetOpen=true; }
  editRow(row: FuelDeliveryRow): void { this.editingRow=row; this.newDelivery={...row}; this.saveError=''; this.sheetOpen=true; }
  closeSheet(): void { if (!this.saving) this.sheetOpen=false; }
  async save(): Promise<void> { if (this.saving) return; this.saving=true; this.saveError=''; try { const payload={...this.newDelivery, quantiteLitres:Number(this.newDelivery.quantiteLitres), stockAvant:Number(this.newDelivery.stockAvant), stockApres:this.calculatedStockAfter}; if (this.editingRow?.id) await this.dataStore.updateRecord('ravitaillements-fuel',this.editingRow,payload); else await this.dataStore.createRecord('ravitaillements-fuel',payload); this.sheetOpen=false; } catch (error) { this.saveError=error instanceof Error ? error.message : 'Le ravitaillement n’a pas pu être enregistré.'; } finally { this.saving=false; } }
  exportExcel(): void { if (!this.canExportExcel) return; this.excel.exportTable({ title:'Ravitaillements Fuel', fileName:'ravitaillements-fuel', rows:this.filteredRows, columns:[{header:'Date',value:r=>r.date},{header:'Site',value:r=>r.site},{header:'Fournisseur',value:r=>r.fournisseur},{header:'Bon de livraison',value:r=>r.bonLivraison},{header:'Carburant',value:r=>r.typeCarburant},{header:'Quantité (L)',value:r=>r.quantiteLitres},{header:'Stock avant (L)',value:r=>r.stockAvant},{header:'Stock après (L)',value:r=>r.stockApres},{header:'Réceptionné par',value:r=>r.receptionnePar},{header:'Commentaires',value:r=>r.commentaires}] }); }
  private emptyDelivery(): FuelDeliveryRow { return {site:this.sites[0] || '',date:new Date().toISOString().slice(0,10),fournisseur:'',bonLivraison:'',typeCarburant:'Diesel',quantiteLitres:0,stockAvant:0,stockApres:0,camion:'',receptionnePar:'',commentaires:''}; }
}