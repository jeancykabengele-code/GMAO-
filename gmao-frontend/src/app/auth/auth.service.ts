import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TimeoutError, firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';

const LOCAL_TOKEN_KEY = 'gmao-local-access-token';
export type UserRole = 'administrator' | 'manager' | 'charge_operations' | 'chef_site';
export interface GmaoPermissions { globalScope: boolean; viewDashboard: boolean; viewDocumentation: boolean; createRecords: boolean; modifyExisting: boolean; deleteRecords: boolean; manageUsers: boolean; viewAuditLog: boolean; allowedSites: string[]; offGridSites?: string[]; }
export interface UserProfile { id: string; email: string; full_name: string; role: UserRole; site: string | null; active: boolean; created_at?: string | null; permissions?: GmaoPermissions; }
interface BackendUserProfile { id: string; email: string; fullName: string; role: string; site: string | null; active: boolean; createdAt?: string | null; permissions: GmaoPermissions; }
interface LocalSession { access_token: string; }
export class GmaoAuthError extends Error { constructor(readonly code: string, message: string) { super(message); } }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private initialization: Promise<void> | null = null;
  readonly session = signal<LocalSession | null>(null);
  readonly mustChangePassword = signal(false);
  readonly profile = signal<UserProfile | null>(null);
  readonly authenticated = computed(() => Boolean(this.session() && this.profile()?.active));
  constructor() { this.clearPersistentToken(); }
  initialize(): Promise<void> { this.initialization ??= this.initializeLocal(); return this.initialization; }
  async signIn(email: string, password: string): Promise<UserProfile> {
    try {
      const result = await firstValueFrom(this.http.post<{ accessToken: string; profile: BackendUserProfile }>(`${environment.apiUrl}/api/auth/local/login`, { email, password }).pipe(timeout({ first: 15_000 })));
      const profile = this.applyProfile(result.profile);
      this.clearPersistentToken();
      sessionStorage.setItem(LOCAL_TOKEN_KEY, result.accessToken);
      this.session.set({ access_token: result.accessToken });
      return profile;
    } catch (error) { throw this.mapError(error); }
  }
  async signOut(): Promise<void> {
    const token = this.accessToken();
    this.clearState();
    this.clearPersistentToken();
    sessionStorage.removeItem(LOCAL_TOKEN_KEY);
    if (!token) return;
    void firstValueFrom(this.http.post(`${environment.apiUrl}/api/auth/local/logout`, {}, { headers: { Authorization: `Bearer ${token}` } }).pipe(timeout({ first: 5_000 }))).catch(() => undefined);
  }
  accessToken(): string | null { return this.session()?.access_token ?? null; }
  async refreshProfile(): Promise<UserProfile | null> {
    const token = this.accessToken();
    return token ? this.loadProfile(token) : null;
  }
  async changeLocalPassword(currentPassword: string, newPassword: string): Promise<void> {
    const token = this.accessToken(); if (!token) throw new GmaoAuthError('invalid_session', 'Votre session n’est plus valide.');
    try {
      const result = await firstValueFrom(this.http.post<{ accessToken?: string }>(`${environment.apiUrl}/api/auth/local/change-password`, { currentPassword, newPassword }, { headers: { Authorization: `Bearer ${token}` } }).pipe(timeout({ first: 10_000 })));
      if (result?.accessToken) {
        sessionStorage.setItem(LOCAL_TOKEN_KEY, result.accessToken);
        this.session.set({ access_token: result.accessToken });
      }
    }
    catch (error) { throw this.mapError(error); }
  }
  isAuthenticated(): boolean { return this.authenticated(); }
  destinationFor(role: UserRole): string { return role === 'administrator' ? '/administration' : role === 'manager' ? '/tableau-de-bord' : '/accueil'; }
  private async initializeLocal(): Promise<void> {
    // Remove legacy persistent sessions instead of silently restoring them.
    this.clearPersistentToken();
    const token = sessionStorage.getItem(LOCAL_TOKEN_KEY);
    if (!token) return;
    this.session.set({ access_token: token });
    try { await this.loadProfile(token); } catch { await this.signOut(); }
  }
  private async loadProfile(token: string): Promise<UserProfile> { try { const data = await firstValueFrom(this.http.get<BackendUserProfile>(`${environment.apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } }).pipe(timeout({ first: 10_000 }))); return this.applyProfile(data); } catch (error) { throw this.mapError(error); } }
  private applyProfile(data: BackendUserProfile): UserProfile { if (!data.active || !this.isKnownRole(data.role)) throw new GmaoAuthError('invalid_profile', 'Votre profil n’est pas autorisé.'); const profile: UserProfile = { id:data.id,email:data.email,full_name:data.fullName,role:data.role,site:data.site,active:data.active,created_at:data.createdAt,permissions:data.permissions }; this.profile.set(profile); return profile; }
  private isKnownRole(role: unknown): role is UserRole { return role === 'administrator' || role === 'manager' || role === 'charge_operations' || role === 'chef_site'; }
  private clearState(): void { this.session.set(null); this.profile.set(null); this.mustChangePassword.set(false); }
  private clearPersistentToken(): void {
    try { localStorage.removeItem(LOCAL_TOKEN_KEY); }
    catch { /* Storage can be disabled by the browser; never read or restore it. */ }
  }
  private mapError(error: unknown): GmaoAuthError {
    if (error instanceof TimeoutError) return new GmaoAuthError('timeout', 'Le serveur GMAO met trop de temps à répondre.');
    if (error instanceof HttpErrorResponse) {
      const detail = typeof error.error?.detail === 'string' ? error.error.detail : '';
      if (error.status === 429) return new GmaoAuthError('rate_limited', detail || 'Trop de tentatives de connexion. Patientez avant de réessayer.');
      if (error.status === 401) return new GmaoAuthError('invalid_credentials', detail || 'Adresse e-mail ou mot de passe incorrect.');
      if (error.status === 403) return new GmaoAuthError('access_denied', detail || 'Ce profil n’est pas autorisé.');
      if (error.status === 503) return new GmaoAuthError('unavailable', 'Connexion temporairement indisponible. Veuillez réessayer.');
      if (error.status === 0) return new GmaoAuthError('unavailable', 'Le serveur GMAO est indisponible.');
    }
    return new GmaoAuthError('unavailable', 'Impossible de contacter le serveur GMAO.');
  }
}
