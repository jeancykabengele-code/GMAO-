import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AccessControlService } from '../auth/access-control.service';
import { AuthService } from '../auth/auth.service';
import { BrowserNotificationsService } from './browser-notifications.service';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface GmaoNotification {
  id: string;
  site: string | null;
  eventType: 'record_created' | 'generator_alert' | 'generator_reading_stale';
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
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessControlService);
  private readonly router = inject(Router);
  private readonly browserNotifications = inject(BrowserNotificationsService);
  private pollingTimer: number | null = null;
  private knownNotificationIds = new Set<string>();
  private initialLoadComplete = false;

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
        this.knownNotificationIds.clear();
        this.initialLoadComplete = false;
      }
    });
  }

  toggle(): void {
    this.open.update((value) => !value);
    if (this.open()) {
      void this.browserNotifications.requestPermission();
      void this.refresh();
    }
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
      const unreadItems = response.items.filter((notification) => !notification.readAt);
      if (this.initialLoadComplete) {
        unreadItems
          .filter((notification) => !this.knownNotificationIds.has(notification.id))
          .forEach((notification) => this.browserNotifications.show(notification));
      }
      this.knownNotificationIds = new Set(unreadItems.map((notification) => notification.id));
      this.initialLoadComplete = true;
      this.items.set(unreadItems);
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
    if (notification.actionPath) {
      const targetPath = notification.resourceId
        ? `${notification.actionPath}?record=${encodeURIComponent(notification.resourceId)}`
        : notification.actionPath;
      await this.router.navigateByUrl(targetPath);
    }
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
    const token = this.auth.accessToken();
    if (!token) throw new Error('Session GMAO absente.');
    return { Authorization: `Bearer ${token}` };
  }
}
