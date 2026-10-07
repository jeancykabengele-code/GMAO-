import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { auditLogGuard } from './auth/audit-log.guard';
import { globalRoleGuard } from './auth/global-role.guard';
import { manageUsersGuard } from './auth/manage-users.guard';
import { portalEntryGuard } from './auth/portal-entry.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/public-home-page').then((module) => module.PublicHomePageComponent), pathMatch: 'full' },
  { path: 'connexion', loadComponent: () => import('./pages/connexion-page').then((module) => module.ConnexionPageComponent), canActivate: [portalEntryGuard] },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: 'accueil', loadComponent: () => import('./pages/accueil-page').then((module) => module.AccueilPageComponent) },
      { path: 'tableau-de-bord', loadComponent: () => import('./pages/tableau-de-bord-page').then((module) => module.TableauDeBordPageComponent), canActivate: [globalRoleGuard] },
      { path: 'equipements', loadComponent: () => import('./pages/equipements-page').then((module) => module.EquipementsPageComponent) },
      { path: 'maintenance', redirectTo: 'maintenance/interventions-realisees', pathMatch: 'full' },
      { path: 'maintenance/interventions-realisees', loadComponent: () => import('./pages/interventions-realisees-page').then((module) => module.InterventionsRealiseesPageComponent) },
      { path: 'maintenance/suivi-groupes-electrogenes', loadComponent: () => import('./pages/suivi-groupes-electrogenes-page').then((module) => module.SuiviGroupesElectrogenesPageComponent) },
      { path: 'gestion-tickets', loadComponent: () => import('./pages/gestion-tickets-page').then((module) => module.GestionTicketsPageComponent) },
      { path: 'pieces-rechange', loadComponent: () => import('./pages/pieces-rechange-page').then((module) => module.PiecesRechangePageComponent) },
      { path: 'fuel-ge', loadComponent: () => import('./pages/fuel-ge-page').then((module) => module.FuelGePageComponent) },
      { path: 'consommation-groupes-ge', loadComponent: () => import('./pages/consommation-groupes-ge-page').then((module) => module.ConsommationGroupesGePageComponent) },
      { path: 'pue', loadComponent: () => import('./pages/pue-page').then((module) => module.PuePageComponent) },
      { path: 'ravitaillement-fuel', loadComponent: () => import('./pages/ravitaillement-fuel-page').then((module) => module.RavitaillementFuelPageComponent) },
      { path: 'problemes-datacenter', loadComponent: () => import('./pages/problemes-datacenter-page').then((module) => module.ProblemesDatacenterPageComponent) },
      { path: 'documentations', loadComponent: () => import('./pages/documentations').then((module) => module.DocumentationsComponent), canActivate: [globalRoleGuard] },
      {
        path: 'administration',
        loadComponent: () => import('./pages/administration-page').then((module) => module.AdministrationPageComponent),
        canActivate: [manageUsersGuard],
        children: [
          { path: '', redirectTo: 'sites', pathMatch: 'full' },
          { path: 'sites', loadComponent: () => import('./pages/sites-admin-page').then((module) => module.SitesAdminPageComponent), canActivate: [manageUsersGuard] },
          { path: 'utilisateurs', loadComponent: () => import('./pages/users-admin-page').then((module) => module.UsersAdminPageComponent), canActivate: [manageUsersGuard] },
          { path: 'journal-audit', loadComponent: () => import('./pages/audit-log-page').then((module) => module.AuditLogPageComponent), canActivate: [auditLogGuard] },
          { path: 'historique-rh', loadComponent: () => import('./pages/rh-history-page').then((module) => module.RhHistoryPageComponent), canActivate: [auditLogGuard] },
          { path: 'sauvegardes', loadComponent: () => import('./pages/backups-page').then((module) => module.BackupsPageComponent), canActivate: [manageUsersGuard] },
        ],
      },
      { path: 'a-propos', loadComponent: () => import('./pages/a-propos').then((module) => module.AProposComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
