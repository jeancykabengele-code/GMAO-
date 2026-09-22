import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BrowserNotificationsService } from './browser-notifications.service';
import { GmaoNotification } from './notifications.service';

describe('BrowserNotificationsService', () => {
  const navigateByUrl = vi.fn().mockResolvedValue(true);
  const notification: GmaoNotification = {
    id: 'notification-1',
    site: 'Goma',
    eventType: 'generator_alert',
    resource: 'groupes-electrogenes',
    resourceId: 'generator-1',
    title: 'Alerte GE',
    message: 'Une action est nécessaire.',
    severity: 'critical',
    actionPath: '/maintenance/suivi-groupes-electrogenes',
    readAt: null,
    createdAt: '2026-09-23T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BrowserNotificationsService,
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    navigateByUrl.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('affiche une alerte Windows et ouvre la fiche au clic', () => {
    const close = vi.fn();
    const NativeNotification = vi.fn(function (this: { close: typeof close }, _title: string, _options: NotificationOptions) {
      this.close = close;
    });
    Object.assign(NativeNotification, { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('Notification', NativeNotification);
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);

    const service = TestBed.inject(BrowserNotificationsService);
    service.show(notification);

    expect(NativeNotification).toHaveBeenCalledWith(notification.title, expect.objectContaining({
      body: notification.message,
      tag: 'gmao-notification-1',
      requireInteraction: true,
    }));
    const browserNotification = NativeNotification.mock.instances[0] as unknown as { onclick: (() => void) | null };
    browserNotification.onclick?.();
    expect(close).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/maintenance/suivi-groupes-electrogenes?record=generator-1');
  });
});