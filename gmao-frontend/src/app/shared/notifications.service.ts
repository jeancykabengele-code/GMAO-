import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AccessControlService } from '../auth/access-control.service';
import { SupabaseClientService } from '../auth/supabase-client.service';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface GmaoNotification {
  id: string;
  site: string | null;
  eventType: 'record_created' | 'generator_alert';
  resource: string;
  resourceId: string | null;
  title: string;
  message: string;
  severity: NotificationSeverity;
  actionPath: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationResponse {
  items: GmaoNotification[];
  unreadCount: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly supabase = inject(SupabaseClientService);
  private readonly access = inject(AccessControlService);
  private readonly router = inject(Router);
  private pollingTimer: number | null = null;

  readonly items = signal<GmaoNotification[]>([]);
  readonly unreadCount = signal(0);
  readonly open = signal(false);
  readonly loading = signal(false);

  constructor() {
    effect(() => {
      if (this.access.isGlobalRole) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.items.set([]);
        this.unreadCount.set(0);
        this.open.set(false);
      }
    });
  }

  toggle(): void {
    this.open.update((value) => !value);
    if (this.open()) void this.refresh();
  }

  close(): void {
    this.open.set(false);
  }

  async refresh(): Promise<void> {
    if (!this.access.isGlobalRole || this.loading()) return;
    this.loading.set(true);
    try {
      const response = await firstValueFrom(this.http.get<NotificationResponse>(
        `${environment.apiUrl}/api/notifications`,
        { headers: await this.authHeaders() },
      ));
      this.items.set(response.items.filter((notification) => !notification.readAt));
      this.unreadCount.set(response.unreadCount);
    } catch {
      // Le prochain cycle de polling réessaiera sans interrompre la navigation.
    } finally {
      this.loading.set(false);
    }
  }

  async openNotification(notification: GmaoNotification): Promise<void> {
    this.items.update((items) => items.filter((item) => item.id !== notification.id));
    if (!notification.readAt) {
      this.unreadCount.update((count) => Math.max(0, count - 1));
      void this.markAsRead(notification.id);
    }
    this.close();
    if (notification.actionPath) await this.router.navigateByUrl(notification.actionPath);
  }

  async markAllRead(): Promise<void> {
    if (!this.unreadCount()) return;
    this.items.set([]);
    this.unreadCount.set(0);
    try {
      await firstValueFrom(this.http.patch(
        `${environment.apiUrl}/api/notifications/read-all`,
        {},
        { headers: await this.authHeaders() },
      ));
    } catch {
      void this.refresh();
    }
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private startPolling(): void {
    if (this.pollingTimer !== null) return;
    void this.refresh();
    this.pollingTimer = window.setInterval(() => void this.refresh(), 30_000);
  }

  private stopPolling(): void {
    if (this.pollingTimer === null) return;
    window.clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  private async markAsRead(notificationId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.patch<GmaoNotification>(
        `${environment.apiUrl}/api/notifications/${notificationId}/read`,
        {},
        { headers: await this.authHeaders() },
      ));
    } catch {
      void this.refresh();
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.auth.getSession();
    if (!data.session?.access_token) throw new Error('Session Supabase absente.');
    return { Authorization: `Bearer ${data.session.access_token}` };
  }
}
