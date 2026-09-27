import { signal } from '@angular/core';
import { AccessControlService } from './access-control.service';
import { UserProfile } from './auth.service';
import { GmaoDataStore } from '../data/gmao-data-store';

describe('AccessControlService', () => {
  const profileState = signal<UserProfile | null>(null);
  const authStub = { profile: profileState } as never;
  const access = new AccessControlService(authStub);
  const store = new GmaoDataStore(access);

  beforeEach(() => {
    profileState.set(null);
    store.equipmentRows = [];
  });

  it('limits a chef de site to their site and preserves existing records', () => {
    store.equipmentRows = [
      { site: 'Goma', code: 'GOM-01', nom: 'GE Goma' },
      { site: 'Bukavu', code: 'BKV-01', nom: 'GE Bukavu' },
    ];
    profileState.set({
      id: 'chef-goma', email: 'goma@ordc.cd', full_name: 'Chef Goma', role: 'chef_site',
      site: 'Goma', active: true, created_at: '2026-01-01T00:00:00Z',
    });

    expect(access.allowedSites).toEqual(['Goma']);
    expect(access.canExportData).toBe(false);
    expect(store.canExportData).toBe(false);
    expect(store.equipmentRows).toEqual([{ site: 'Goma', code: 'GOM-01', nom: 'GE Goma' }]);

    store.equipmentRows = [{ site: 'Bukavu', code: 'NEW-01', nom: 'Nouvel équipement' }, ...store.equipmentRows];
    expect(store.equipmentRows).toHaveLength(2);
    expect(store.equipmentRows.every((row) => (row as { site: string }).site === 'Goma')).toBe(true);

    store.equipmentRows = [];
    expect(store.equipmentRows).toHaveLength(2);
  });

  it('allows global roles to access every site and modify existing rows', () => {
    profileState.set({
      id: 'manager', email: 'manager@ordc.cd', full_name: 'Manager', role: 'manager',
      site: null, active: true, created_at: '2026-01-01T00:00:00Z',
    });
    expect(access.canAccessGlobalPages).toBe(true);
    expect(access.canModifyExisting).toBe(true);
    expect(access.canExportData).toBe(true);
    expect(store.canExportData).toBe(true);
    expect(access.allowedSites.length).toBeGreaterThan(1);
  });

  it('allows the operations lead to export data', () => {
    profileState.set({
      id: 'operations', email: 'operations@ordc.cd', full_name: 'Chef des opérations',
      role: 'charge_operations', site: null, active: true,
    });

    expect(access.canExportData).toBe(true);
    expect(store.canExportData).toBe(true);
  });

  it('reserves user management to the manager permission', () => {
    const basePermissions = {
      globalScope: true, viewDashboard: true, viewDocumentation: true,
      createRecords: false, modifyExisting: true, deleteRecords: true,
      viewAuditLog: false,
      allowedSites: ['Goma'],
    };
    profileState.set({
      id: 'operations', email: 'operations@ordc.cd', full_name: 'Chef des opérations',
      role: 'charge_operations', site: null, active: true,
      permissions: { ...basePermissions, manageUsers: false },
    });
    expect(access.canManageUsers).toBe(false);
    expect(access.canViewAuditLog).toBe(false);

    profileState.set({
      id: 'manager', email: 'manager@ordc.cd', full_name: 'Manager',
      role: 'manager', site: null, active: true,
      permissions: { ...basePermissions, manageUsers: true, viewAuditLog: true },
    });
    expect(access.canManageUsers).toBe(true);
    expect(access.canViewAuditLog).toBe(true);
  });

  it('reserves new data entry to chefs de site while global roles retain editing', () => {
    profileState.set({
      id: 'manager', email: 'manager@ordc.cd', full_name: 'Manager', role: 'manager',
      site: null, active: true, created_at: '2026-01-01T00:00:00Z',
    });
    expect(access.canEnterSiteData).toBe(false);
    expect(store.canEnterData).toBe(false);
    expect(access.canModifyExisting).toBe(true);

    profileState.set({
      id: 'chef-goma', email: 'goma@ordc.cd', full_name: 'Chef Goma', role: 'chef_site',
      site: 'Goma', active: true, created_at: '2026-01-01T00:00:00Z',
    });
    expect(access.canEnterSiteData).toBe(true);
    expect(store.canEnterData).toBe(true);
  });
});
