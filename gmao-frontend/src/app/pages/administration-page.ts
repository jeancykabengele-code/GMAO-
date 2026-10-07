import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccessControlService } from '../auth/access-control.service';

@Component({
  selector: 'app-administration-page',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="administration-shell">
      <header class="administration-header">
        <nav class="administration-tabs" aria-label="Sections d’administration">
          <a routerLink="sites" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Gestion des sites</a>
          @if (access.canManageUsers) { <a routerLink="utilisateurs" routerLinkActive="active">Gestion des utilisateurs</a> }
          @if (access.canViewAuditLog) { <a routerLink="journal-audit" routerLinkActive="active">Journal d’audit</a> }
          @if (access.canViewAuditLog) { <a routerLink="historique-rh" routerLinkActive="active">Historique RH</a> }
          @if (access.canManageUsers) { <a routerLink="sauvegardes" routerLinkActive="active">Sauvegardes</a> }
        </nav>
      </header>
      <router-outlet></router-outlet>
    </section>
  `,
  styles: `
    :host { display:block; min-height:100%; }
    .administration-shell { min-height:100%; }
    .administration-header { display:flex; align-items:end; justify-content:space-between; gap:24px; padding:clamp(22px,4vw,44px) clamp(18px,4vw,44px) 0; }
    .eyebrow { margin:0 0 6px; color:#ff6700; text-transform:uppercase; letter-spacing:.13em; font-weight:700; font-size:.78rem; }
    h1 { margin:0; color:#fff; font-size:clamp(1.8rem,3vw,2.45rem); }
    .administration-header p:last-child { margin:8px 0 0; color:rgba(255,255,255,.9); }
    .administration-tabs { display:flex; flex-wrap:wrap; gap:8px; }
    .administration-tabs a { color:#fff; text-decoration:none; border:1px solid rgba(255,255,255,.55); border-radius:8px; padding:10px 14px; font-weight:600; background:rgba(0,0,0,.18); }
    .administration-tabs a.active, .administration-tabs a:hover { color:#fff; background:#ff6700; border-color:#ff6700; }
    @media (max-width:800px) { .administration-header { align-items:stretch; flex-direction:column; } .administration-tabs { width:100%; } }
  `,
})
export class AdministrationPageComponent {
  readonly access = inject(AccessControlService);
}
