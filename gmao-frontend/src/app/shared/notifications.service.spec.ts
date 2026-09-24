import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AccessControlService } from '../auth/access-control.service';
import { AuthService } from '../auth/auth.service';
import { GmaoNotification, NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const navigateByUrl = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        NotificationsService,
        { provide: AccessControlService, useValue: { isGlobalRole: false } },
        { provide: AuthService, useValue: { accessToken: () => 'test-token' } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    navigateByUrl.mockClear();
  });

  it('retire une notification déjà lue et ferme le panneau avant de naviguer', async () => {
    const service = TestBed.inject(NotificationsService);
    const notification: GmaoNotification = {
      id: 'notification-1',
      site: 'Utex',
      eventType: 'generator_alert',
      resource: 'groupes-electrogenes',
      resourceId: 'generator-1',
      title: 'Alerte GE — PM dépassée',
      message: 'Le groupe doit être contrôlé.',
      severity: 'critical',
      actionPath: '/maintenance/suivi-groupes-electrogenes',
      readAt: '2026-08-26T05:37:00Z',
      createdAt: '2026-08-26T05:37:00Z',
    };
    service.items.set([notification]);
    service.open.set(true);

    await service.openNotification(notification);

    expect(service.items()).toEqual([]);
    expect(service.open()).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledWith('/maintenance/suivi-groupes-electrogenes?record=generator-1');
  });
});
