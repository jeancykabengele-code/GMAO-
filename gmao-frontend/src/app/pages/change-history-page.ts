import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChangeHistoryChange, ChangeHistoryRecord, GmaoApiService } from '../data/gmao-api.service';
import { lineLabel } from './pue-lines';

const RESOURCES: Record<string, string> = {
  'releves-rh-ge': 'Relevés RH', 'groupes-electrogenes': 'Groupes électrogènes', 'fuel-ge': 'Fuel-GE', 'fuel-ravitaillements': 'Ravitaillements Fuel',
  'consommations-groupes-ge': 'Consommation par GE', 'fuel-summary': 'Synthèse Fuel', pue: 'PUE', equipements: 'Équipements', tickets: 'Tickets',
  interventions: 'Interventions', 'pieces-rechange': 'Pièces de rechange', 'problemes-datacenter': 'Problèmes Data Center',
};

const FIELDS: Record<string, string> = {
  site: 'Site', code: 'Code', nom: 'Nom', famille: 'Famille', localisation: 'Localisation', marqueModele: 'Marque / modèle', etat: 'État', criticite: 'Criticité',
  numero: 'Numéro', nature: 'Nature', equipement: 'Équipement', date: 'Date', porteur: 'Porteur', entreprise: 'Entreprise', motif: 'Motif', description: 'Description',
  typeGe: 'Type de GE', moisReleve: 'Mois du relevé', dateMiseEnService: 'Mise en service', dateDernierePm: 'Dernière PM', rhActuel: 'RH actuel', rhDernierePm: 'RH dernière PM',
  rhDepuisDernierePm: 'RH. depuis dernière PM', rhProchainePm: 'RH. Prochaine PM', retardSignale: 'Retard signalé', commentaires: 'Commentaires', periode: 'Mois', groupeCode: 'Groupe',
  stockInitial: 'Stock initial', entree: 'Entrée', sortie: 'Sortie', stockFinal: 'Stock final', heuresGe: 'Heures GE', litresHeure: 'Litres / heure', consommationLitres: 'Consommation (L)',
  dateRavitaillement: 'Date de ravitaillement', rang: 'Rang', bonLivraison: 'Bon de livraison', typeCarburant: 'Carburant', quantite: 'Quantité', quantiteRecue: 'Quantité reçue',
  stockAvant: 'Stock avant', stockApres: 'Stock après', numeroCiterne: 'N° de citerne', receptionnePar: 'Réceptionné par', differenceStock: 'Écart de stock', fournisseur: 'Fournisseur',
  mois: 'Mois', dateReleve: 'Date du relevé', heureReleve: 'Heure du relevé', itKw: 'IT (kW)', totalKw: 'Total site (kW)', pue: 'PUE', snelKwh: 'SNEL (kWh)', disponibiliteGrid: 'Disponibilité réseau',
  constat: 'Constat', priorite: 'Priorité', statut: 'Statut', responsable: 'Responsable', echeance: 'Échéance', prochaineEtape: 'Prochaine étape', besoinSpare: 'Besoin de spare',
  agent: 'Agent', travailRealise: 'Travail réalisé', dureeHeures: 'Durée (h)', ticketNumber: 'N° de ticket', designation: 'Désignation',
};

@Component({
  selector: 'app-change-history-page',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="history-page">
      <form class="filters" (ngSubmit)="applyFilters()">
        <label>Type de fiche<select name="resource" [(ngModel)]="filters.resource"><option value="">Toutes</option>@for (resource of resourceKeys; track resource) { <option [value]="resource">{{ resourceLabel(resource) }}</option> }</select></label>
        <label>Site<input name="site" [(ngModel)]="filters.site" placeholder="Goma, Utex…" /></label>
        <label>Groupe GE<input name="group" [(ngModel)]="filters.group" placeholder="GE-01" /></label>
        <label>Du<input type="date" name="from" [(ngModel)]="filters.from" /></label>
        <label>Au<input type="date" name="to" [(ngModel)]="filters.to" /></label>
        <div class="filter-actions"><button class="secondary" type="button" (click)="resetFilters()">Réinitialiser</button><button class="primary" type="submit">Filtrer</button></div>
      </form>
      @if (error) { <p class="message error">{{ error }}</p> }
      <div class="card">
        @if (loading) { <p class="empty">Chargement…</p> }
        @else { <div class="table-wrap"><table><thead><tr><th>Date</th><th>Fiche</th><th>Site</th><th>Opération</th><th>Ce qui a changé</th><th>Modifié par</th></tr></thead><tbody>
          @for (entry of entries; track entry.id) { <tr>
            <td>{{ entry.createdAt | date:'dd/MM/yyyy HH:mm' }}</td>
            <td>{{ resourceLabel(entry.resource) }}@if (entry.reference) { <small class="reference">{{ entry.reference }}</small> }</td>
            <td>{{ entry.site }}</td>
            <td><span class="kind" [class.update]="entry.kind === 'update'" [class.delete]="entry.kind === 'delete'">{{ kindLabel(entry.kind) }}</span></td>
            <td class="changes">@for (change of entry.changes; track change.field) { <div>{{ changeLabel(entry, change) }}</div> } @empty { — }</td>
            <td>{{ entry.actorEmail || 'Inconnu' }}</td>
          </tr> }
          @empty { <tr><td colspan="6" class="empty">Aucune modification pour ces filtres.</td></tr> }
        </tbody></table></div> }
        <footer class="pagination"><span>{{ total }} modification{{ total > 1 ? 's' : '' }}</span><div><button type="button" class="secondary" [disabled]="offset === 0" (click)="previousPage()">Précédent</button><button type="button" class="secondary" [disabled]="offset + limit >= total" (click)="nextPage()">Suivant</button></div></footer>
      </div>
    </section>
  `,
  styles: `:host{display:block;padding:clamp(18px,4vw,44px);color:#252525}.history-page{max-width:1500px;margin:auto}.filters,.card{background:rgba(255,255,255,.95);border-radius:14px;padding:20px;box-shadow:0 12px 30px rgba(0,0,0,.1)}.filters{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;margin-bottom:18px}.filters label{display:grid;gap:6px;font-weight:600}.filters input,.filters select{min-width:0;padding:10px;border:1px solid #cdd3da;border-radius:7px;font:inherit}.filter-actions{display:flex;align-items:end;gap:8px;grid-column:1/-1;justify-content:flex-end}button{border:0;border-radius:8px;padding:10px 15px;font:inherit;cursor:pointer}.primary{color:#fff;background:#ff6700}.secondary{color:#333;background:#e8e8e8}.secondary:disabled{opacity:.5;cursor:not-allowed}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{color:#fff;background:#292929;white-space:nowrap}.reference{display:block;margin-top:3px;color:#68788a;font-size:.8rem}.changes{min-width:260px;overflow-wrap:anywhere}.kind{display:inline-block;padding:4px 8px;border-radius:999px;color:#17652c;background:#dff4e4;white-space:nowrap}.kind.update{color:#795400;background:#fff0c2}.kind.delete{color:#9a2525;background:#fde6e6}.pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px}.pagination div{display:flex;gap:8px}.message{padding:12px 14px;border-radius:8px}.error{background:#fde6e6;color:#9a2525}.empty{text-align:center;color:#68788a;padding:24px}@media(max-width:980px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.filters{grid-template-columns:1fr}.pagination{align-items:stretch;flex-direction:column}}`,
})
export class ChangeHistoryPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly limit = 50;
  readonly resourceKeys = Object.keys(RESOURCES);
  entries: ChangeHistoryRecord[] = [];
  total = 0;
  offset = 0;
  loading = true;
  error = '';
  filters = { resource: '', site: '', group: '', from: '', to: '' };

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading = true; this.error = '';
    try { const page = await this.api.listChangeHistory({ ...this.filters, limit: this.limit, offset: this.offset }); this.entries = page.items; this.total = page.total; }
    catch (reason) { this.error = this.api.errorMessage(reason, 'Impossible de charger l’historique des modifications.'); }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }
  applyFilters(): void { this.offset = 0; void this.load(); }
  resetFilters(): void { this.filters = { resource: '', site: '', group: '', from: '', to: '' }; this.offset = 0; void this.load(); }
  previousPage(): void { this.offset = Math.max(0, this.offset - this.limit); void this.load(); }
  nextPage(): void { if (this.offset + this.limit < this.total) { this.offset += this.limit; void this.load(); } }
  resourceLabel(resource: string): string { return RESOURCES[resource] || resource; }
  kindLabel(kind: string): string { return ({ create: 'Création', update: 'Modification', delete: 'Suppression' } as Record<string, string>)[kind] || kind; }
  fieldLabel(field: string): string {
    if (field.startsWith('kw_')) return `${lineLabel(field.slice(3))} (kW)`;
    return FIELDS[field] || field.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  }
  changeLabel(entry: ChangeHistoryRecord, change: ChangeHistoryChange): string {
    const label = this.fieldLabel(change.field);
    if (entry.kind === 'update') return `${label} : ${this.value(change.old)} → ${this.value(change.new)}`;
    return `${label} : ${this.value(entry.kind === 'create' ? change.new : change.old)}`;
  }
  value(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (typeof value === 'number') return value.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
    if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
    return String(value);
  }
}
