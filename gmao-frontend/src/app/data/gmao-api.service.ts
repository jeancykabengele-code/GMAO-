import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

export type GmaoResource =
  | 'equipements'
  | 'tickets'
  | 'groupes-electrogenes'
  | 'releves-rh-ge'
  | 'fuel-ge'
  | 'consommations-groupes-ge'
  | 'fuel-ravitaillements'
  | 'fuel-summary'
  | 'pue'
  | 'problemes-datacenter'
  | 'interventions'
  | 'pieces-rechange';

export type PersistedRow = Record<string, unknown> & { id?: string; site?: string };
export interface SiteRecord { name: string; code: string; active: boolean; gridConnected: boolean; }
export interface ProfileRecord { id: string; email: string; fullName: string; role: string; site: string | null; active: boolean; createdAt?: string | null; }
export interface AuditLogRecord { id: number; actorId: string | null; actorEmail: string; action: string; targetType: string; targetId: string; targetEmail?: string; result: 'success' | 'failure' | 'blocked'; ipAddress: string; details: Record<string, unknown>; createdAt: string; }
export interface RhHistoryRecord { id: number; createdAt: string; actorEmail: string; kind: 'create' | 'update' | 'delete'; site: string; groupeCode: string; periode: string; oldRh: string | null; newRh: string | null; oldCommentaires: string; newCommentaires: string; }
export interface RhHistoryPage { items: RhHistoryRecord[]; total: number; limit: number; offset: number; }
export interface RhHistoryFilters { site?: string; group?: string; from?: string; to?: string; limit?: number; offset?: number; }
export interface AuditLogPage { items: AuditLogRecord[]; total: number; limit: number; offset: number; }
export interface AuditLogFilters { action?: string; result?: string; actor?: string; targetType?: string; from?: string; to?: string; limit?: number; offset?: number; }

@Injectable({ providedIn: 'root' })
export class GmaoApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async list(resource: GmaoResource): Promise<PersistedRow[]> {
    return firstValueFrom(this.http.get<PersistedRow[]>(this.url(resource), {
      headers: await this.authHeaders(),
    }));
  }

  async listSites(): Promise<SiteRecord[]> {
    return firstValueFrom(this.http.get<SiteRecord[]>(`${environment.apiUrl}/api/sites`, {
      headers: await this.authHeaders(),
    }));
  }

  async createSite(site: Pick<SiteRecord, 'name' | 'code' | 'gridConnected'>): Promise<SiteRecord> {
    return firstValueFrom(this.http.post<SiteRecord>(`${environment.apiUrl}/api/sites`, site, {
      headers: await this.authHeaders(),
    }));
  }

  errorMessage(reason: unknown, fallback: string): string {
    const candidate = reason as { error?: { detail?: string; message?: string }; message?: string };
    return candidate?.error?.detail || candidate?.error?.message || candidate?.message || fallback;
  }

  async updateSite(name: string, changes: Partial<SiteRecord>): Promise<SiteRecord> {
    return firstValueFrom(this.http.patch<SiteRecord>(`${environment.apiUrl}/api/sites/${encodeURIComponent(name)}`, changes, {
      headers: await this.authHeaders(),
    }));
  }

  async listProfiles(): Promise<ProfileRecord[]> {
    return firstValueFrom(this.http.get<ProfileRecord[]>(`${environment.apiUrl}/api/profiles`, {
      headers: await this.authHeaders(),
    }));
  }

  async listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
    const parameters: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') parameters[key] = String(value);
    });
    return firstValueFrom(this.http.get<AuditLogPage>(`${environment.apiUrl}/api/audit-logs`, {
      headers: await this.authHeaders(),
      params: parameters,
    }));
  }

  async listRhHistory(filters: RhHistoryFilters = {}): Promise<RhHistoryPage> {
    const parameters: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') parameters[key] = String(value);
    });
    return firstValueFrom(this.http.get<RhHistoryPage>(`${environment.apiUrl}/api/rh-history`, {
      headers: await this.authHeaders(),
      params: parameters,
    }));
  }

  async exportBackup(): Promise<{ blob: Blob; fileName: string }> {
    const response = await firstValueFrom(this.http.post(`${environment.apiUrl}/api/backups/export`, {}, {
      headers: await this.authHeaders(),
      responseType: 'blob',
      observe: 'response',
    }));
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob: response.body as Blob, fileName: match?.[1] || `gmao-backup-${Date.now()}.zip` };
  }

  async createProfile(profile: { email: string; fullName: string; role: string; site: string | null; password?: string }): Promise<ProfileRecord> {
    return firstValueFrom(this.http.post<ProfileRecord>(`${environment.apiUrl}/api/profiles`, profile, {
      headers: await this.authHeaders(),
    }));
  }

  async updateProfile(id: string, changes: { fullName: string; role: string; site: string | null; active: boolean }): Promise<ProfileRecord> {
    return firstValueFrom(this.http.patch<ProfileRecord>(`${environment.apiUrl}/api/profiles/${id}`, changes, {
      headers: await this.authHeaders(),
    }));
  }

  async deleteProfile(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/api/profiles/${id}/delete`, {
      headers: await this.authHeaders(),
    }));
  }

  async setPassword(id: string, password: string, managerPassword: string): Promise<void> {
    await firstValueFrom(this.http.post(`${environment.apiUrl}/api/profiles/${id}/password`, { password, managerPassword }, {
      headers: await this.authHeaders(),
    }));
  }
  async assignProfileSite(id: string, site: string | null): Promise<ProfileRecord> {
    return firstValueFrom(this.http.patch<ProfileRecord>(`${environment.apiUrl}/api/profiles/${id}`, { site }, {
      headers: await this.authHeaders(),
    }));
  }
  async removeSite(name: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/api/sites/${encodeURIComponent(name)}`, {
      headers: await this.authHeaders(),
    }));
  }
  async create(resource: GmaoResource, row: PersistedRow): Promise<PersistedRow> {
    return firstValueFrom(this.http.post<PersistedRow>(this.url(resource), row, {
      headers: await this.authHeaders(),
    }));
  }

  async update(resource: GmaoResource, id: string, row: PersistedRow): Promise<PersistedRow> {
    return firstValueFrom(this.http.put<PersistedRow>(`${this.url(resource)}/${id}`, row, {
      headers: await this.authHeaders(),
    }));
  }

  async remove(resource: GmaoResource, id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.url(resource)}/${id}`, {
      headers: await this.authHeaders(),
    }));
  }

  private url(resource: GmaoResource): string {
    return `${environment.apiUrl}/api/records/${resource}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = this.auth.accessToken();
    if (!token) throw new Error("Session absente.");
    return { Authorization: `Bearer ${token}` };
  }
}
