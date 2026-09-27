import { Injectable, Optional } from '@angular/core';
import { AuthService, UserProfile } from './auth.service';
import { ORANGE_RDC_SITES } from '../data/sites';

@Injectable({ providedIn: 'root' })
export class AccessControlService {
  constructor(@Optional() private readonly auth: AuthService | null = null) {}

  get profile(): UserProfile | null {
    return this.auth?.profile() ?? null;
  }

  get isGlobalRole(): boolean {
    if (this.profile?.permissions) return this.profile.permissions.globalScope;
    const role = this.profile?.role;
    return role === 'manager' || role === 'charge_operations';
  }

  get isChefSite(): boolean {
    return this.profile?.role === 'chef_site';
  }

  get canAccessGlobalPages(): boolean {
    const permissions = this.profile?.permissions;
    return permissions
      ? permissions.viewDashboard && permissions.viewDocumentation
      : !this.profile || this.isGlobalRole;
  }
  get canExportData(): boolean {
    return this.isGlobalRole;
  }

  get canCreateRecords(): boolean {
    return this.profile?.permissions?.createRecords ?? Boolean(this.profile?.active);
  }

  get canEnterSiteData(): boolean {
    return !this.profile || this.isChefSite;
  }

  get canModifyExisting(): boolean {
    return this.profile?.permissions?.modifyExisting ?? (!this.profile || this.isGlobalRole);
  }

  get canDeleteRecords(): boolean {
    return this.profile?.permissions?.deleteRecords ?? false;
  }

  get canManageUsers(): boolean {
    const permissions = this.profile?.permissions;
    return permissions ? permissions.manageUsers : this.profile?.role === 'manager';
  }

  get canViewAuditLog(): boolean {
    const permissions = this.profile?.permissions;
    return permissions ? permissions.viewAuditLog : this.profile?.role === 'manager';
  }

  get currentSite(): string | null {
    return this.isChefSite ? this.profile?.site ?? null : null;
  }

  get allowedSites(): string[] {
    const serverSites = this.profile?.permissions?.allowedSites;
    if (serverSites?.length) return [...serverSites];
    return this.currentSite ? [this.currentSite] : [...ORANGE_RDC_SITES];
  }

  canViewSite(site: string): boolean {
    return this.isGlobalRole || this.allowedSites.includes(site);
  }
}
