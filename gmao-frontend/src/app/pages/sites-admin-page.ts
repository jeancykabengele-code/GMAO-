import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoApiService, SiteRecord } from '../data/gmao-api.service';

@Component({
  selector: 'app-sites-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="sites-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Administration</p>
          <h1>Gestion des sites</h1>
          <p class="intro">Ajoutez, modifiez ou désactivez les sites sans toucher au code.</p>
        </div>
        <button type="button" class="primary" (click)="startCreate()">+ Ajouter un site</button>
      </header>

      @if (message) { <p class="message success">{{ message }}</p> }
      @if (error) { <p class="message error">{{ error }}</p> }

      @if (formOpen) {
        <form class="site-form" (ngSubmit)="save()">
          <h2>{{ editing ? 'Modifier le site' : 'Nouveau site' }}</h2>
          <label>Nom du site
            <input name="name" [(ngModel)]="form.name" [readonly]="!!editing" required maxlength="120" />
          </label>
          <label>Code du site
            <input name="code" [(ngModel)]="form.code" required maxlength="30" placeholder="Ex. LUB" />
          </label>
          @if (editing) {
            <label class="checkbox"><input type="checkbox" name="active" [(ngModel)]="form.active" /> Site actif</label>
          }
          <div class="form-actions">
            <button type="button" class="secondary" (click)="cancel()">Annuler</button>
            <button type="submit" class="primary" [disabled]="saving">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
          </div>
        </form>
      }

      <div class="table-card">
        <div class="table-heading"><strong>Sites enregistrés</strong><span>{{ sites.length }} site(s)</span></div>
        @if (loading) { <p class="empty">Chargement…</p> }
        @else {
          <div class="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Code</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                @for (site of sites; track site.name) {
                  <tr [class.inactive]="!site.active">
                    <td>{{ site.name }}</td><td>{{ site.code }}</td>
                    <td><span class="status" [class.off]="!site.active">{{ site.active ? 'Actif' : 'Désactivé' }}</span></td>
                    <td><button type="button" class="link-button" (click)="startEdit(site)">{{ site.active ? 'Modifier' : 'Réactiver' }}</button></td>
                  </tr>
                } @empty { <tr><td colspan="4" class="empty">Aucun site enregistré.</td></tr> }
              </tbody>
            </table>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; padding: clamp(18px, 4vw, 44px); color: #252525; }
    .sites-page { max-width: 1100px; margin: 0 auto; }
    .page-header { display: flex; justify-content: space-between; gap: 24px; align-items: end; margin-bottom: 24px; }
    .eyebrow { margin: 0 0 6px; color: #ff6700; text-transform: uppercase; letter-spacing: .13em; font-weight: 700; font-size: .78rem; }
    h1 { margin: 0; font-size: clamp(1.7rem, 3vw, 2.4rem); } h2 { margin-top: 0; font-size: 1.25rem; }
    .intro { margin: 8px 0 0; color: #68788a; }
    button { border: 0; border-radius: 8px; padding: 11px 16px; cursor: pointer; font: inherit; }
    .primary { background: #ff6700; color: white; } .primary:disabled { opacity: .6; cursor: wait; }
    .secondary { background: #e8e8e8; color: #333; }
    .site-form, .table-card { background: rgba(255,255,255,.94); border-radius: 14px; padding: 22px; box-shadow: 0 12px 30px rgba(0,0,0,.1); margin-bottom: 22px; }
    .site-form { max-width: 520px; } label { display: grid; gap: 6px; margin: 14px 0; font-weight: 600; } input:not([type=checkbox]) { padding: 11px 12px; border: 1px solid #cdd3da; border-radius: 7px; font: inherit; } input[readonly] { background: #f3f3f3; }
    .checkbox { display: flex; grid-template-columns: none; align-items: center; gap: 8px; } .checkbox input { width: 18px; height: 18px; }
    .form-actions { display: flex; justify-content: end; gap: 10px; margin-top: 20px; }
    .message { padding: 12px 14px; border-radius: 8px; margin: 0 0 16px; } .success { background: #e2f4e7; color: #216b35; } .error { background: #fde6e6; color: #9a2525; }
    .table-heading { display: flex; justify-content: space-between; margin-bottom: 14px; } .table-heading span { color: #68788a; }
    .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 13px 10px; border-bottom: 1px solid #e5e7eb; } th { background: #292929; color: white; } tr.inactive { opacity: .62; }
    .status { display: inline-block; padding: 4px 9px; border-radius: 999px; color: #17652c; background: #dff4e4; font-size: .85rem; } .status.off { color: #7b3434; background: #f4dddd; }
    .link-button { padding: 5px 8px; color: #d95300; background: transparent; } .empty { text-align: center; color: #68788a; padding: 24px; }
    @media (max-width: 650px) { .page-header { align-items: stretch; flex-direction: column; } .page-header .primary { align-self: start; } }
  `,
})
export class SitesAdminPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  sites: SiteRecord[] = [];
  loading = true;
  saving = false;
  formOpen = false;
  editing: SiteRecord | null = null;
  form: SiteRecord = { name: '', code: '', active: true };
  message = '';
  error = '';

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try { this.sites = await this.api.listSites(); }
    catch { this.error = 'Impossible de charger les sites.'; }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  startCreate(): void { this.message = ''; this.error = ''; this.editing = null; this.form = { name: '', code: '', active: true }; this.formOpen = true; }
  startEdit(site: SiteRecord): void { this.message = ''; this.error = ''; this.editing = site; this.form = { ...site }; this.formOpen = true; }
  cancel(): void { this.formOpen = false; this.editing = null; }

  async save(): Promise<void> {
    this.message = ''; this.error = '';
    if (!this.form.name.trim() || !this.form.code.trim()) { this.error = 'Le nom et le code sont obligatoires.'; return; }
    this.saving = true;
    try {
      const saved = this.editing
        ? await this.api.updateSite(this.editing.name, { code: this.form.code, active: this.form.active })
        : await this.api.createSite({ name: this.form.name, code: this.form.code });
      this.sites = this.editing ? this.sites.map(site => site.name === this.editing!.name ? saved : site) : [...this.sites, saved].sort((a, b) => a.name.localeCompare(b.name));
      this.message = this.editing ? 'Site mis à jour.' : 'Site ajouté. Actualisez la page après la création pour le voir dans tous les filtres.';
      this.cancel();
    } catch (reason) {
      this.error = reason instanceof Error ? reason.message : 'Enregistrement impossible.';
    } finally { this.saving = false; this.cdr.detectChanges(); }
  }
}