import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccessControlService } from './auth/access-control.service';
import { AuthService } from './auth/auth.service';
import { GmaoDataStore } from './data/gmao-data-store';
import { PORTAL_ENTRY_KEY } from './auth/portal-entry.guard';
import { NotificationsService } from './shared/notifications.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly access = inject(AccessControlService);
  readonly notifications = inject(NotificationsService);
  private readonly auth = inject(AuthService);
  private readonly dataStore = inject(GmaoDataStore);

  maintenanceOpen = true;
  loggingOut = false;
  sidebarHidden = false;

  constructor() {
    effect(() => {
      if (this.auth.authenticated()) {
        void this.dataStore.loadAll(true);
      }
    });
  }

  get isPublicRoute(): boolean {
    const path = this.router.url.split(/[?#]/, 1)[0];
    return path === '/' || path === '/connexion';
  }

  get isAccueil(): boolean {
    return this.router.url.startsWith('/accueil');
  }

  toggleSidebar(): void {
    this.sidebarHidden = !this.sidebarHidden;
  }

  async logout(): Promise<void> {
    if (this.loggingOut) return;
    this.loggingOut = true;
    try {
      await this.auth.signOut();
      sessionStorage.removeItem(PORTAL_ENTRY_KEY);
      await this.router.navigateByUrl('/');
    } finally {
      this.loggingOut = false;
    }
  }
}