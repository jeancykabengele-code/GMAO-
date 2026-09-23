import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthError, Session } from '@supabase/supabase-js';
import { TimeoutError, firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { SupabaseClientService } from './supabase-client.service';

const LOCAL_TOKEN_KEY = 'gmao-local-access-token';

export type UserRole = 'manager' | 'charge_operations' | 'chef_site';

export interface GmaoPermissions {
  globalScope: boolean;
  viewDashboard: boolean;
  viewDocumentation: boolean;
  createRecords: boolean;
  modifyExisting: boolean;
  deleteRecords: boolean;
  allowedSites: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  site: string | null;
  active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  permissions?: GmaoPermissions;
}

interface BackendUserProfile {
  id: string;
  email: string;
  fullName: string;
  role: string;
  site: string | null;
  active: boolean;
  createdAt?: string | null;
  permissions: GmaoPermissions;
  mustChangePassword?: boolean;
}

export class GmaoAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly http = inject(HttpClient);
  private initialization: Promise<void> | null = null;

  readonly session = signal<Session | null>(null);
  readonly mustChangePassword = signal(false);
  get usesLocalAuth(): boolean { return (environment.authProvider as string) === 'django'; }
  readonly profile = signal<UserProfile | null>(null);
  readonly authenticated = computed(() => Boolean(this.session() && this.profile()?.active));

  initialize(): Promise<void> {
    if (this.usesLocalAuth) { this.initialization ??= this.initializeLocal(); return this.initialization; }
    if (!this.supabase.configured) {
      return Promise.resolve();
    }

    this.initialization ??= this.usesLocalAuth ? this.initializeLocal() : this.initializeSupabase();
    return this.initialization;
  }

  async signIn(email: string, password: string, remember: boolean): Promise<UserProfile> {
    if (this.usesLocalAuth) return this.signInLocal(email, password, remember);
    if (!this.supabase.configured) {
      throw new GmaoAuthError('not_configured', 'La connexion Supabase n’est pas encore configurée.');
    }

    this.supabase.setRememberSession(remember);
    const { data, error } = await this.withTimeout(
      this.supabase.client.auth.signInWithPassword({ email, password }),
      15_000,
      new GmaoAuthError('auth_timeout', 'Supabase Auth met trop de temps à répondre. Réessayez.'),
    );

    if (error || !data.session) {
      throw this.mapAuthError(error);
    }

    this.session.set(data.session);

    try {
      return await this.loadProfile(data.session);
    } catch (profileError) {
      this.clearState();
      void this.supabase.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      throw profileError;
    }
  }

  async signOut(): Promise<void> {
    this.clearState();
    localStorage.removeItem(LOCAL_TOKEN_KEY);
    sessionStorage.removeItem(LOCAL_TOKEN_KEY);
    if (this.usesLocalAuth) return;
    if (this.supabase.configured) {
      await this.withTimeout(
        this.supabase.client.auth.signOut(),
        5_000,
        new GmaoAuthError('signout_timeout', 'La déconnexion distante a expiré.'),
      ).catch(() => undefined);
    }
  }

  accessToken(): string | null { return this.session()?.access_token ?? null; }

  private async signInLocal(email: string, password: string, remember: boolean): Promise<UserProfile> {
    try {
      const result = await firstValueFrom(this.http.post<{ accessToken: string; profile: BackendUserProfile; mustChangePassword: boolean }>(`${environment.apiUrl}/api/auth/local/login`, { email, password }).pipe(timeout({ first: 15_000 })));
      const storage = remember ? localStorage : sessionStorage;
      const other = remember ? sessionStorage : localStorage;
      storage.setItem(LOCAL_TOKEN_KEY, result.accessToken); other.removeItem(LOCAL_TOKEN_KEY);
      this.session.set({ access_token: result.accessToken } as Session);
      this.mustChangePassword.set(result.mustChangePassword);
      return this.applyLocalProfile(result.profile);
    } catch (error) { throw this.mapBackendError(error); }
  }

  private async initializeLocal(): Promise<void> {
    const token = localStorage.getItem(LOCAL_TOKEN_KEY) ?? sessionStorage.getItem(LOCAL_TOKEN_KEY);
    if (!token) return;
    this.session.set({ access_token: token } as Session);
    try { await this.loadProfile({ access_token: token } as Session); }
    catch { this.clearState(); localStorage.removeItem(LOCAL_TOKEN_KEY); sessionStorage.removeItem(LOCAL_TOKEN_KEY); }
  }

  async changeLocalPassword(currentPassword: string, newPassword: string): Promise<void> {
    const token = this.accessToken();
    if (!this.usesLocalAuth || !token) throw new GmaoAuthError('invalid_session', 'Votre session n’est plus valide.');
    await firstValueFrom(this.http.post(`${environment.apiUrl}/api/auth/local/change-password`, { currentPassword, newPassword }, { headers: { Authorization: `Bearer ${token}` } }).pipe(timeout({ first: 10_000 })));
    this.mustChangePassword.set(false);
  }

  private applyLocalProfile(data: BackendUserProfile): UserProfile {
    if (!data.active || !this.isKnownRole(data.role)) throw new GmaoAuthError('invalid_profile', 'Votre profil n’est pas autorisé.');
    const profile: UserProfile = { id: data.id, email: data.email, full_name: data.fullName, role: data.role, site: data.site, active: data.active, created_at: data.createdAt, permissions: data.permissions };
    this.profile.set(profile); return profile;
  }
  isAuthenticated(): boolean {
    return this.authenticated();
  }

  destinationFor(role: UserRole): string {
    return role === 'manager' ? '/tableau-de-bord' : '/accueil';
  }

  private async initializeSupabase(): Promise<void> {
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      if (!session) {
        this.profile.set(null);
      }
    });

    const { data, error } = await this.supabase.client.auth.getSession();
    if (error || !data.session) {
      this.clearState();
      return;
    }

    this.session.set(data.session);
    try {
      await this.loadProfile(data.session);
    } catch {
      this.clearState();
      void this.supabase.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  }

  private async loadProfile(session: Session): Promise<UserProfile> {
    let data: BackendUserProfile;
    try {
      data = await firstValueFrom(
        this.http.get<BackendUserProfile>(`${environment.apiUrl}/api/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).pipe(timeout({ first: 10_000 })),
      );
    } catch (error) {
      throw this.mapBackendError(error);
    }

    if (!data.active) {
      throw new GmaoAuthError('inactive', 'Ce compte est désactivé. Contactez un administrateur.');
    }
    if (!this.isKnownRole(data.role)) {
      throw new GmaoAuthError('invalid_role', 'Le rôle associé à ce compte n’est pas reconnu.');
    }

    const profile: UserProfile = {
      id: data.id,
      email: data.email,
      full_name: data.fullName,
      role: data.role,
      site: data.site,
      active: data.active,
      created_at: data.createdAt,
      permissions: data.permissions,
    };
    this.mustChangePassword.set(Boolean(data.mustChangePassword));
    this.profile.set(profile);
    return profile;
  }

  private isKnownRole(role: unknown): role is UserRole {
    return role === 'manager' || role === 'charge_operations' || role === 'chef_site';
  }

  private mapBackendError(error: unknown): GmaoAuthError {
    if (error instanceof TimeoutError) {
      return new GmaoAuthError('backend_timeout', 'Le serveur GMAO met trop de temps à charger votre profil.');
    }
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        const detail = this.backendErrorDetail(error);
        const message = !environment.production && detail
          ? `Session refusée par le serveur Django : ${detail}`
          : 'Votre session n’est plus valide. Veuillez vous reconnecter.';
        return new GmaoAuthError('invalid_session', message);
      }
      if (error.status === 403) {
        return new GmaoAuthError('access_denied', 'Ce profil n’est pas autorisé à accéder à GMAO ORDC.');
      }
      if (error.status === 0) {
        return new GmaoAuthError('backend_unavailable', 'Le serveur GMAO est indisponible. Réessayez dans quelques instants.');
      }
    }
    return new GmaoAuthError('profile_unavailable', 'Impossible de charger votre profil utilisateur.');
  }

  private backendErrorDetail(error: HttpErrorResponse): string | null {
    const detail = error.error && typeof error.error === 'object'
      ? (error.error as { detail?: unknown }).detail
      : null;
    return typeof detail === 'string' && detail.trim() ? detail.trim() : null;
  }

  private clearState(): void {
    this.session.set(null);
    this.profile.set(null);
    this.mustChangePassword.set(false);
  }

  private withTimeout<T>(promise: PromiseLike<T>, milliseconds: number, timeoutError: Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(timeoutError), milliseconds);
      Promise.resolve(promise).then(
        value => {
          window.clearTimeout(timer);
          resolve(value);
        },
        error => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private mapAuthError(error: AuthError | null): GmaoAuthError {
    if (error?.code === 'email_not_confirmed') {
      return new GmaoAuthError('email_not_confirmed', 'Cette adresse e-mail n’a pas encore été confirmée.');
    }
    return new GmaoAuthError('invalid_credentials', 'Adresse e-mail ou mot de passe incorrect.');
  }
}