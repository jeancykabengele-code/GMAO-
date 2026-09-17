import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoDataStore } from '../data/gmao-data-store';

interface ConsumptionRow { id?: string; site: string; periode: string; groupeCode: string; consommationLitres: number; heuresGe: number; litresHeure: number | null; commentaires?: string; }
interface GeneratorRow { site: string; code: string; moisReleve: string; rhActuel: number; }
interface Entry { site: string; periode: string; groupeCode: string; consommationLitres: number | null; commentaires: string; }

@Component({ selector: 'app-consommation-groupes-ge', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './consommation-groupes-ge-page.html', styleUrls: ['./consommation-groupes-ge-page.scss'] })
export class ConsommationGroupesGePageComponent {
  open = false;
  error = '';
  entry: Entry;

  constructor(readonly dataStore: GmaoDataStore) { this.entry = this.empty(); }
  get rows(): ConsumptionRow[] { return this.dataStore.generatorFuelConsumptionRows as ConsumptionRow[]; }
  get sites(): string[] { return this.dataStore.allowedSites; }
  get groups(): GeneratorRow[] { return this.dataStore.generatorRows as GeneratorRow[]; }
  get allowedGroups(): GeneratorRow[] { return this.groups.filter((group) => group.site === this.entry.site); }

  hours(): number | null {
    const current = this.groups.find((group) => group.site === this.entry.site && group.code === this.entry.groupeCode && group.moisReleve === this.entry.periode);
    const previous = this.groups.filter((group) => group.site === this.entry.site && group.code === this.entry.groupeCode && group.moisReleve < this.entry.periode).sort((left, right) => right.moisReleve.localeCompare(left.moisReleve))[0];
    return current?.rhActuel !== undefined && previous?.rhActuel !== undefined ? Number(current.rhActuel) - Number(previous.rhActuel) : null;
  }

  litresHour(): number | null {
    const hours = this.hours();
    const consumption = this.entry.consommationLitres ?? 0;
    return hours === null || (hours === 0 && consumption > 0) ? null : hours === 0 ? 0 : consumption / hours;
  }

  show(): void { this.error = ''; this.entry = this.empty(); this.open = true; }
  close(): void { this.open = false; }
  async save(): Promise<void> {
    this.error = '';
    if (!this.entry.site || !this.entry.periode || !this.entry.groupeCode || this.entry.consommationLitres === null) { this.error = 'Complétez les champs obligatoires.'; return; }
    try { await this.dataStore.createRecord('consommations-groupes-ge', this.entry); await this.dataStore.refreshResource('fuel-ge'); this.close(); }
    catch { this.error = 'Enregistrement impossible : vérifiez les relevés RH du groupe.'; }
  }

  private empty(): Entry { return { site: this.dataStore.allowedSites[0] ?? '', periode: '', groupeCode: '', consommationLitres: null, commentaires: '' }; }
}