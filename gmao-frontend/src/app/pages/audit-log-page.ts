import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuditLogRecord, GmaoApiService } from '../data/gmao-api.service';

@Component({
  selector: 'app-audit-log-page',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="audit-page">
      <form class="filters" (ngSubmit)="applyFilters()">
        <label>Du<input type="date" name="from" [(ngModel)]="filters.from" /></label>
        <label>Au<input type="date" name="to" [(ngModel)]="filters.to" /></label>
        <label>Acteur<input name="actor" [(ngModel)]="filters.actor" placeholder="Adresse e-mail" /></label>
        <label>Cible<input name="targetType" [(ngModel)]="filters.targetType" placeholder="profile, site…" /></label>
        <label>Site<input name="site" [(ngModel)]="filters.site" placeholder="Goma, Utex…" /></label>
        <label>Groupe GE<input name="group" [(ngModel)]="filters.group" placeholder="GE-01" /></label>
        <label>Action<select name="action" [(ngModel)]="filters.action"><option value="">Toutes</option>@for (action of actions; track action) { <option [value]="action">{{ actionLabel(action) }}</option> }</select></label>
        <label>Résultat<select name="result" [(ngModel)]="filters.result"><option value="">Tous</option><option value="success">Réussite</option><option value="failure">Échec</option><option value="blocked">Bloqué</option></select></label>
        <div class="filter-actions"><button class="secondary" type="button" (click)="resetFilters()">Réinitialiser</button><button class="primary" type="submit">Filtrer</button></div>
      </form>
      @if (error) { <p class="message error">{{ error }}</p> }
      <div class="card">
        @if (loading) { <p class="empty">Chargement…</p> }
        @else { <div class="table-wrap"><table><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Résultat</th><th>Adresse IP</th><th>Détails</th></tr></thead><tbody>
          @for (entry of entries; track entry.id) { <tr><td>{{ entry.createdAt | date:'dd/MM/yyyy HH:mm:ss' }}</td><td>{{ entry.actorEmail || 'Inconnu' }}</td><td>{{ actionLabel(entry.action) }}</td><td>{{ entry.targetType }}{{ entry.targetId ? ' · ' + entry.targetId : '' }}</td><td><span class="result" [class.failure]="entry.result === 'failure'" [class.blocked]="entry.result === 'blocked'">{{ resultLabel(entry.result) }}</span></td><td>{{ entry.ipAddress }}</td><td class="details">{{ detailsLabel(entry) }}</td></tr> }
          @empty { <tr><td colspan="7" class="empty">Aucun événement pour ces filtres.</td></tr> }
        </tbody></table></div> }
        <footer class="pagination"><span>{{ total }} événement{{ total > 1 ? 's' : '' }}</span><div><button type="button" class="secondary" [disabled]="offset === 0" (click)="previousPage()">Précédent</button><button type="button" class="secondary" [disabled]="offset + limit >= total" (click)="nextPage()">Suivant</button></div></footer>
      </div>
    </section>
  `,
  styles: `:host{display:block;padding:clamp(18px,4vw,44px);color:#252525}.audit-page{max-width:1500px;margin:auto}.filters,.card{background:rgba(255,255,255,.95);border-radius:14px;padding:20px;box-shadow:0 12px 30px rgba(0,0,0,.1)}.filters{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:12px;margin-bottom:18px}.filters label{display:grid;gap:6px;font-weight:600}.filters input,.filters select{min-width:0;padding:10px;border:1px solid #cdd3da;border-radius:7px;font:inherit}.filter-actions{display:flex;align-items:end;gap:8px;grid-column:1/-1;justify-content:flex-end}button{border:0;border-radius:8px;padding:10px 15px;font:inherit;cursor:pointer}.primary{color:#fff;background:#ff6700}.secondary{color:#333;background:#e8e8e8}.secondary:disabled{opacity:.5;cursor:not-allowed}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{color:#fff;background:#292929;white-space:nowrap}.details{min-width:220px;max-width:420px;overflow-wrap:anywhere;color:#52606d}.result{display:inline-block;padding:4px 8px;border-radius:999px;color:#17652c;background:#dff4e4}.result.failure{color:#9a2525;background:#fde6e6}.result.blocked{color:#795400;background:#fff0c2}.pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px}.pagination div{display:flex;gap:8px}.message{padding:12px 14px;border-radius:8px}.error{background:#fde6e6;color:#9a2525}.empty{text-align:center;color:#68788a;padding:24px}@media(max-width:980px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.filters{grid-template-columns:1fr}.pagination{align-items:stretch;flex-direction:column}}`,
})
export class AuditLogPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly actions = ['login', 'password_change', 'password_reset', 'profile_create', 'profile_update', 'profile_delete', 'record_delete', 'rh_reading_create', 'rh_reading_update', 'site_create', 'site_update', 'site_delete', 'backup_export'];
  readonly limit = 50;
  entries: AuditLogRecord[] = [];
  total = 0;
  offset = 0;
  loading = true;
  error = '';
  filters = { from: '', to: '', actor: '', targetType: '', site: '', group: '', action: '', result: '' };

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading = true; this.error = '';
    try { const page = await this.api.listAuditLogs({ ...this.filters, limit: this.limit, offset: this.offset }); this.entries = page.items; this.total = page.total; }
    catch (reason) { this.error = this.api.errorMessage(reason, 'Impossible de charger le journal d’audit.'); }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }
  applyFilters(): void { this.offset = 0; void this.load(); }
  resetFilters(): void { this.filters = { from: '', to: '', actor: '', targetType: '', site: '', group: '', action: '', result: '' }; this.offset = 0; void this.load(); }
  previousPage(): void { this.offset = Math.max(0, this.offset - this.limit); void this.load(); }
  nextPage(): void { if (this.offset + this.limit < this.total) { this.offset += this.limit; void this.load(); } }
  actionLabel(action: string): string { return ({ login: 'Connexion', password_change: 'Changement de mot de passe', password_reset: 'Réinitialisation de mot de passe', profile_create: 'Création de compte', profile_update: 'Modification de compte', profile_delete: 'Suppression de compte', record_delete: 'Suppression métier', rh_reading_create: 'Relevé RH créé', rh_reading_update: 'Relevé RH corrigé', site_create: 'Création de site', site_update: 'Modification de site', site_delete: 'Suppression de site', backup_export: 'Sauvegarde générée' } as Record<string, string>)[action] || action; }
  resultLabel(result: string): string { return ({ success: 'Réussite', failure: 'Échec', blocked: 'Bloqué' } as Record<string, string>)[result] || result; }
  detailsLabel(entry: AuditLogRecord): string {
    const details = entry.details || {};
    const old = details['old'] as Record<string, unknown> | undefined;
    const current = details['new'] as Record<string, unknown> | undefined;
    if (entry.action === 'rh_reading_update' && old && current) {
      return `${this.readingLabel(current)} : RH ${this.number(old['rhActuel'])} → ${this.number(current['rhActuel'])}` + this.commentChange(old, current);
    }
    if (entry.action === 'rh_reading_create' && current) return `${this.readingLabel(current)} : RH ${this.number(current['rhActuel'])} (nouveau relevé)`;
    if (entry.action === 'record_delete' && entry.targetType === 'releves-rh-ge' && old) return `${this.readingLabel(old)} : relevé RH supprimé (valeur ${this.number(old['rhActuel'])})`;
    return Object.keys(details).length ? JSON.stringify(details) : '—';
  }
  private readingLabel(reading: Record<string, unknown>): string { return `${reading['site']} · ${reading['groupeCode']} · ${reading['periode']}`; }
  private number(value: unknown): string { const parsed = Number(value); return Number.isFinite(parsed) ? parsed.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(value ?? '—'); }
  private commentChange(old: Record<string, unknown>, current: Record<string, unknown>): string { return (old['commentaires'] || '') === (current['commentaires'] || '') ? '' : ` · commentaire : « ${old['commentaires'] || '—'} » → « ${current['commentaires'] || '—'} »`; }
}
