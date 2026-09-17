import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { SupabaseClientService } from '../auth/supabase-client.service';

export type GmaoResource =
  | 'equipements'
  | 'tickets'
  | 'groupes-electrogenes'
  | 'fuel-ge'
  | 'consommations-groupes-ge'
  | 'fuel-ravitaillements'
  | 'fuel-summary'
  | 'pue'
  | 'problemes-datacenter'
  | 'interventions'
  | 'pieces-rechange';

export type PersistedRow = Record<string, unknown> & { id?: string; site?: string };
export interface SiteRecord { name: string; code: string; active: boolean; }
export interface ProfileRecord { id: string; email: string; fullName: string; role: string; site: string | null; active: boolean; createdAt?: string | null; }

@Injectable({ providedIn: 'root' })
export class GmaoApiService {
  private readonly http = inject(HttpClient);
  private readonly supabase = inject(SupabaseClientService);

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

  async createSite(site: Pick<SiteRecord, 'name' | 'code'>): Promise<SiteRecord> {
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

  async createProfile(profile: { email: string; fullName: string; role: string; site: string | null }): Promise<ProfileRecord> {
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
    const { data } = await this.supabase.client.auth.getSession();
    if (!data.session?.access_token) throw new Error('Session Supabase absente.');
    return { Authorization: `Bearer ${data.session.access_token}` };
  }
}
