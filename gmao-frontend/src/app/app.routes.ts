import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { globalRoleGuard } from './auth/global-role.guard';
import { portalEntryGuard } from './auth/portal-entry.guard';
import { BlankPageComponent } from './pages/blank-page';
import { DocumentationsComponent } from './pages/documentations';
import { AccueilPageComponent } from './pages/accueil-page';
import { AProposComponent } from './pages/a-propos';
import { ConnexionPageComponent } from './pages/connexion-page';
import { EquipementsPageComponent } from './pages/equipements-page';
import { FuelGePageComponent } from './pages/fuel-ge-page';
import { GestionTicketsPageComponent } from './pages/gestion-tickets-page';
import { InterventionsRealiseesPageComponent } from './pages/interventions-realisees-page';
import { PiecesRechangePageComponent } from './pages/pieces-rechange-page';
import { ProblemesDatacenterPageComponent } from './pages/problemes-datacenter-page';
import { PublicHomePageComponent } from './pages/public-home-page';
import { PuePageComponent } from './pages/pue-page';
import { SuiviGroupesElectrogenesPageComponent } from './pages/suivi-groupes-electrogenes-page';
import { TableauDeBordPageComponent } from './pages/tableau-de-bord-page';

export const routes: Routes = [
  { path: '', component: PublicHomePageComponent, pathMatch: 'full' },
  { path: 'connexion', component: ConnexionPageComponent, canActivate: [portalEntryGuard] },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: 'accueil', component: AccueilPageComponent },
      { path: 'tableau-de-bord', component: TableauDeBordPageComponent, canActivate: [globalRoleGuard] },
      { path: 'equipements', component: EquipementsPageComponent },
      { path: 'maintenance', redirectTo: 'maintenance/interventions-realisees', pathMatch: 'full' },
      { path: 'maintenance/interventions-realisees', component: InterventionsRealiseesPageComponent },
      { path: 'maintenance/suivi-groupes-electrogenes', component: SuiviGroupesElectrogenesPageComponent },
      { path: 'gestion-tickets', component: GestionTicketsPageComponent },
      { path: 'pieces-rechange', component: PiecesRechangePageComponent },
      { path: 'fuel-ge', component: FuelGePageComponent },
      { path: 'pue', component: PuePageComponent },
      { path: 'problemes-datacenter', component: ProblemesDatacenterPageComponent },
      { path: 'documentations', component: DocumentationsComponent, canActivate: [globalRoleGuard] },
      { path: 'a-propos', component: AProposComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];