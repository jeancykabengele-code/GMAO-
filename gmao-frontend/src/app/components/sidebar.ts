import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: \<div class="d-flex flex-column p-3 bg-dark text-white min-vh-100" style="width: 260px;">
    <a routerLink="/" class="d-flex align-items-center mb-3 text-white text-decoration-none gap-2">
      <i class="solaris-icon solaris-gears text-warning fs-3"></i>
      <span class="fs-4 fw-bold">GMAO <span class="text-warning">Web</span></span>
    </a>
    <hr class="border-secondary">
    <ul class="nav nav-pills flex-column mb-auto gap-1">
      <li>
        <a routerLink="/accueil" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-home"></i> Accueil
        </a>
      </li>
      <li>
        <a routerLink="/tableau-de-bord" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-gauge"></i> Tableau de bord
        </a>
      </li>
      <li>
        <a routerLink="/equipements" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-equipment"></i> �quipements
        </a>
      </li>
      <li>
        <a routerLink="/maintenance" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-maintenance"></i> Maintenance
        </a>
      </li>
      <li>
        <a routerLink="/gestion-tickets" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-tickets"></i> Gestion des tickets
        </a>
      </li>
      <li>
        <a routerLink="/pieces-rechange" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-spare-parts"></i> Pi�ces de rechange
        </a>
      </li>
      <li>
        <a routerLink="/fuel-ge" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-fuel"></i> Carburant & GE
        </a>
      </li>
      <li>
        <a routerLink="/pue" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-energy"></i> PUE
        </a>
      </li>
      <li>
        <a routerLink="/problemes-datacenter" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-warning-triangle"></i> Probl�mes Data Center
        </a>
      </li>
      <li>
        <a routerLink="/documentations" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-documentation"></i> Documentations
        </a>
      </li>
      <li>
        <a routerLink="/a-propos" routerLinkActive="active" class="nav-link text-white d-flex align-items-center gap-2">
          <i class="solaris-icon solaris-information"></i> � propos
        </a>
      </li>
    </ul>
  </div>\
})
export class SidebarComponent {}
