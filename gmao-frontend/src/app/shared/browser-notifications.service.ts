import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { GmaoNotification } from './notifications.service';

@Injectable({ providedIn: 'root' })
export class BrowserNotificationsService {
  private readonly router = inject(Router);

  async requestPermission(): Promise<void> {
    if (!this.supported || Notification.permission !== 'default') return;
    try {
      await Notification.requestPermission();
    } catch {
      // Le centre de notifications GMAO reste disponible si le navigateur refuse la demande.
    }
  }

  show(notification: GmaoNotification): void {
    if (!this.supported || Notification.permission !== 'granted') return;
    try {
      const browserNotification = new Notification(notification.title, {
        body: notification.message,
        icon: '/assets/orange/logo/orange-master-logo.png',
        tag: `gmao-${notification.id}`,
        requireInteraction: notification.severity === 'critical',
      });
      browserNotification.onclick = () => {
        window.focus();
        browserNotification.close();
        if (notification.actionPath) {
          const targetPath = notification.resourceId
            ? `${notification.actionPath}?record=${encodeURIComponent(notification.resourceId)}`
            : notification.actionPath;
          void this.router.navigateByUrl(targetPath);
        }
      };
    } catch {
      // Une notification Windows indisponible ne doit jamais interrompre GMAO.
    }
  }

  private get supported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }
}