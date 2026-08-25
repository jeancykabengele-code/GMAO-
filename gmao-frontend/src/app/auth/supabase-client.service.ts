import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

const REMEMBER_SESSION_KEY = 'gmao-remember-session';

class BrowserAuthStorage {
  getItem(key: string): string | null {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    if (localStorage.getItem(REMEMBER_SESSION_KEY) === 'true') {
      localStorage.setItem(key, value);
      sessionStorage.removeItem(key);
      return;
    }

    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  }

  removeItem(key: string): void {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  private instance: SupabaseClient | null = null;

  get configured(): boolean {
    return environment.supabaseUrl.startsWith('https://') && environment.supabasePublishableKey.length > 20;
  }

  get client(): SupabaseClient {
    if (!this.configured) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }

    this.instance ??= createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: new BrowserAuthStorage(),
      },
    });

    return this.instance;
  }

  setRememberSession(remember: boolean): void {
    localStorage.setItem(REMEMBER_SESSION_KEY, String(remember));
  }
}