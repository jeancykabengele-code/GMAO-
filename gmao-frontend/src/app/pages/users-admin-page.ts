import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmaoApiService, ProfileRecord, SiteRecord } from '../data/gmao-api.service';

@Component({
  selector: 'app-users-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="users-page">
      <header class="page-header"><h1>Gestion des utilisateurs</h1><p>Consultez les profils, leurs rôles et leurs affectations.</p></header>
      @if (message) { <p class="message success">{{ message }}</p> } @if (error) { <p class="message error">{{ error }}</p> }
      <div class="card">
        @if (loading) { <p class="empty">Chargement…</p> } @else {
          <div class="table-wrap"><table><thead><tr><th>Nom complet</th><th>Adresse e-mail</th><th>Rôle</th><th>Site associé</th><th>Statut</th><th>Date de création</th><th>Actions</th></tr></thead><tbody>
            @for (profile of profiles; track profile.id) {
              <tr><td>{{ profile.fullName || '—' }}</td><td>{{ profile.email }}</td><td>{{ roleLabel(profile.role) }}</td>
                <td>{{ profile.site || '—' }}</td><td><span class="status" [class.inactive]="!profile.active">{{ profile.active ? 'Actif' : 'Inactif' }}</span></td><td>{{ profile.createdAt ? (profile.createdAt | date:'dd/MM/yyyy HH:mm') : '—' }}</td>
                <td class="actions-cell">@if (profile.role === 'chef_site') { <select [ngModel]="profile.site || ''" (ngModelChange)="assign(profile, $event)" aria-label="Associer le site"><option value="">Choisir un site</option>@for (site of activeSites; track site.name) { <option [value]="site.name">{{ site.name }}</option> }</select> } @else { Profil global }</td>
              </tr>
            } @empty { <tr><td colspan="7" class="empty">Aucun utilisateur.</td></tr> }
          </tbody></table></div>
        }
      </div>
    </section>
  `,  styles: `
    :host { display:block; padding:clamp(18px,4vw,44px); color:#252525; } .users-page{max-width:1250px;margin:auto} .page-header{margin-bottom:24px}.page-header h1{margin:0;color:#fff;font-size:clamp(1.7rem,3vw,2.4rem)}.page-header p{margin:8px 0 0;color:rgba(255,255,255,.9)}.eyebrow{text-transform:uppercase;letter-spacing:.13em;color:#ff6700;font-weight:700;font-size:.78rem;margin:0 0 6px}h1{margin:0;color:#fff}.intro{color:rgba(255,255,255,.9);margin:8px 0 24px}.card{background:rgba(255,255,255,.94);border-radius:14px;padding:22px;box-shadow:0 12px 30px rgba(0,0,0,.1)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:13px 10px;border-bottom:1px solid #e5e7eb}th{background:#292929;color:white;white-space:nowrap}td small{display:block;color:#68788a;margin-top:3px}select{padding:9px;border:1px solid #cdd3da;border-radius:7px;font:inherit}.actions-cell{white-space:nowrap}.status{display:inline-block;padding:4px 9px;border-radius:999px;color:#17652c;background:#dff4e4;font-size:.85rem}.status.inactive{color:#7b3434;background:#f4dddd}.message{padding:12px 14px;border-radius:8px}.success{background:#e2f4e7;color:#216b35}.error{background:#fde6e6;color:#9a2525}.empty{text-align:center;color:#68788a;padding:24px}
  `,
})
export class UsersAdminPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  profiles: ProfileRecord[] = []; sites: SiteRecord[] = []; loading = true; message = ''; error = '';
  get activeSites(): SiteRecord[] { return this.sites.filter(site => site.active); }
  constructor() { void this.load(); }
  async load(): Promise<void> { try { [this.profiles, this.sites] = await Promise.all([this.api.listProfiles(), this.api.listSites()]); } catch { this.error = 'Impossible de charger les utilisateurs.'; } finally { this.loading = false; this.cdr.detectChanges(); } }
  roleLabel(role: string): string { return role === 'chef_site' ? 'Chef de site' : role === 'charge_operations' ? 'Chef des opérations' : 'Manager'; }
  async assign(profile: ProfileRecord, site: string): Promise<void> { this.message = ''; this.error = ''; try { const saved = await this.api.assignProfileSite(profile.id, site || null); Object.assign(profile, saved); this.message = `Site de ${profile.email} mis à jour.`; } catch { this.error = 'Impossible de modifier l’affectation.'; } finally { this.cdr.detectChanges(); } }
}