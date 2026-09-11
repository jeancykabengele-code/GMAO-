import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';

interface FuelDeliveryRow { id?: string; dateRavitaillement: string; site: string; fournisseur: string; bonLivraison: string; typeCarburant: string; quantiteRecue: number; stockAvant: number; stockApres: number; numeroCiterne?: string; receptionnePar: string; commentaires?: string; createdAt?: string; differenceStock?: boolean; }

@Component({
  selector: 'app-ravitaillement-fuel-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ravitaillement-fuel-page.html',
  styleUrls: ['./ravitaillement-fuel-page.scss'],
})
export class RavitaillementFuelPageComponent {
  formOpen = false;
  saving = false;
  errorMessage = '';
  readonly dataStore: GmaoDataStore;
  entry: ReturnType<RavitaillementFuelPageComponent["createEmptyEntry"]>;

  constructor(dataStore: GmaoDataStore) { this.dataStore = dataStore; this.entry = this.createEmptyEntry(); }
  get rows(): FuelDeliveryRow[] { return this.dataStore.fuelDeliveryRows as FuelDeliveryRow[]; }
  get sites(): string[] { return this.dataStore.allowedSites; }

  openForm(): void { this.errorMessage = ''; this.entry = this.createEmptyEntry(); this.formOpen = true; }
  closeForm(): void { if (!this.saving) this.formOpen = false; }
  calculatedStockAfter(): number | null {
    if (this.entry.stockAvant === null || this.entry.quantiteRecue === null) return null;
    return Number(this.entry.stockAvant) + Number(this.entry.quantiteRecue);
  }
  async save(): Promise<void> {
    this.errorMessage = '';
    if (!this.entry.site || !this.entry.dateRavitaillement || !this.entry.fournisseur || !this.entry.bonLivraison || !this.entry.receptionnePar) { this.errorMessage = 'Complétez les champs obligatoires.'; return; }
    if (this.entry.quantiteRecue === null || this.entry.stockAvant === null || this.entry.quantiteRecue < 0 || this.entry.stockAvant < 0) { this.errorMessage = 'La quantité et le stock avant doivent être des valeurs positives ou nulles.'; return; }
    if (this.entry.stockApres === null) this.entry.stockApres = this.calculatedStockAfter();
    if (this.entry.stockApres === null || this.entry.stockApres < 0) { this.errorMessage = 'Le stock après livraison est invalide.'; return; }
    this.saving = true;
    try {
      await this.dataStore.createRecord('fuel-ravitaillements', { ...this.entry });
      this.formOpen = false;
    } catch (error) { this.errorMessage = error instanceof Error ? error.message : 'Enregistrement impossible.'; }
    finally { this.saving = false; }
  }
  private createEmptyEntry() { return { dateRavitaillement: '', site: this.sites[0] ?? '', fournisseur: '', bonLivraison: '', typeCarburant: 'Diesel', quantiteRecue: null as number | null, stockAvant: null as number | null, stockApres: null as number | null, numeroCiterne: '', receptionnePar: '', commentaires: '' }; }
}