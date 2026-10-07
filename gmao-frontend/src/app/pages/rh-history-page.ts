import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoApiService, RhHistoryRecord } from '../data/gmao-api.service';

@Component({
  selector: 'app-rh-history-page',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="history-page">
      <form class="filters" (ngSubmit)="applyFilters()">
        <label>Site<input name="site" [(ngModel)]="filters.site" placeholder="Goma, Utex…" /></label>
        <label>Groupe GE<input name="group" [(ngModel)]="filters.group" placeholder="GE-01" /></label>
        <label>Du<input type="date" name="from" [(ngModel)]="filters.from" /></label>
        <label>Au<input type="date" name="to" [(ngModel)]="filters.to" /></label>
        <div class="filter-actions"><button class="secondary" type="button" (click)="resetFilters()">Réinitialiser</button><button class="primary" type="submit">Filtrer</button></div>
      </form>
      @if (error) { <p class="message error">{{ error }}</p> }
      <div class="card">
        @if (loading) { <p class="empty">Chargement…</p> }
        @else { <div class="table-wrap"><table><thead><tr><th>Date de la modification</th><th>Site</th><th>Groupe</th><th>Mois</th><th>Opération</th><th>Ancien RH</th><th>Nouveau RH</th><th>Modifié par</th><th>Commentaire</th></tr></thead><tbody>
          @for (entry of entries; track entry.id) { <tr><td>{{ entry.createdAt | date:'dd/MM/yyyy HH:mm' }}</td><td>{{ entry.site }}</td><td>{{ entry.groupeCode }}</td><td>{{ entry.periode }}</td><td><span class="kind" [class.update]="entry.kind === 'update'" [class.delete]="entry.kind === 'delete'">{{ kindLabel(entry.kind) }}</span></td><td>{{ number(entry.oldRh) }}</td><td>{{ number(entry.newRh) }}</td><td>{{ entry.actorEmail || 'Inconnu' }}</td><td class="comment">{{ commentLabel(entry) }}</td></tr> }
          @empty { <tr><td colspan="9" class="empty">Aucune modification de relevé RH pour ces filtres.</td></tr> }
        </tbody></table></div> }
        <footer class="pagination"><span>{{ total }} modification{{ total > 1 ? 's' : '' }}</span><div><button type="button" class="secondary" [disabled]="offset === 0" (click)="previousPage()">Précédent</button><button type="button" class="secondary" [disabled]="offset + limit >= total" (click)="nextPage()">Suivant</button></div></footer>
      </div>
    </section>
  `,
  styles: `:host{display:block;padding:clamp(18px,4vw,44px);color:#252525}.history-page{max-width:1500px;margin:auto}.filters,.card{background:rgba(255,255,255,.95);border-radius:14px;padding:20px;box-shadow:0 12px 30px rgba(0,0,0,.1)}.filters{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:12px;margin-bottom:18px}.filters label{display:grid;gap:6px;font-weight:600}.filters input{min-width:0;padding:10px;border:1px solid #cdd3da;border-radius:7px;font:inherit}.filter-actions{display:flex;align-items:end;gap:8px;grid-column:1/-1;justify-content:flex-end}button{border:0;border-radius:8px;padding:10px 15px;font:inherit;cursor:pointer}.primary{color:#fff;background:#ff6700}.secondary{color:#333;background:#e8e8e8}.secondary:disabled{opacity:.5;cursor:not-allowed}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{color:#fff;background:#292929;white-space:nowrap}.comment{min-width:200px;overflow-wrap:anywhere;color:#52606d}.kind{display:inline-block;padding:4px 8px;border-radius:999px;color:#17652c;background:#dff4e4;white-space:nowrap}.kind.update{color:#795400;background:#fff0c2}.kind.delete{color:#9a2525;background:#fde6e6}.pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px}.pagination div{display:flex;gap:8px}.message{padding:12px 14px;border-radius:8px}.error{background:#fde6e6;color:#9a2525}.empty{text-align:center;color:#68788a;padding:24px}@media(max-width:980px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.filters{grid-template-columns:1fr}.pagination{align-items:stretch;flex-direction:column}}`,
})
export class RhHistoryPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly limit = 50;
  entries: RhHistoryRecord[] = [];
  total = 0;
  offset = 0;
  loading = true;
  error = '';
  filters = { site: '', group: '', from: '', to: '' };

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading = true; this.error = '';
    try { const page = await this.api.listRhHistory({ ...this.filters, limit: this.limit, offset: this.offset }); this.entries = page.items; this.total = page.total; }
    catch (reason) { this.error = this.api.errorMessage(reason, 'Impossible de charger l’historique RH.'); }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }
  applyFilters(): void { this.offset = 0; void this.load(); }
  resetFilters(): void { this.filters = { site: '', group: '', from: '', to: '' }; this.offset = 0; void this.load(); }
  previousPage(): void { this.offset = Math.max(0, this.offset - this.limit); void this.load(); }
  nextPage(): void { if (this.offset + this.limit < this.total) { this.offset += this.limit; void this.load(); } }
  kindLabel(kind: string): string { return ({ create: 'Saisie', update: 'Correction', delete: 'Suppression' } as Record<string, string>)[kind] || kind; }
  number(value: string | null): string { if (value === null || value === undefined) return '—'; const parsed = Number(value); return Number.isFinite(parsed) ? parsed.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : value; }
  commentLabel(entry: RhHistoryRecord): string {
    if (entry.kind === 'update' && entry.oldCommentaires !== entry.newCommentaires) return `« ${entry.oldCommentaires || '—'} » → « ${entry.newCommentaires || '—'} »`;
    return entry.newCommentaires || entry.oldCommentaires || '—';
  }
}
