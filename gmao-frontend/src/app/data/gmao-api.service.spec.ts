import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { environment } from '../../environments/environment';
import { GmaoApiService } from './gmao-api.service';

describe('GmaoApiService user administration', () => {
  let api: GmaoApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { accessToken: () => 'manager-session-token' } },
      ],
    });
    api = TestBed.inject(GmaoApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envoie la reconnexion du Manager avec la réinitialisation', async () => {
    const result = api.setPassword('target-id', 'Target-new-password-2026', 'Manager-current-password');
    await Promise.resolve();
    const request = http.expectOne(`${environment.apiUrl}/api/profiles/target-id/password`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer manager-session-token');
    expect(request.request.body).toEqual({
      password: 'Target-new-password-2026',
      managerPassword: 'Manager-current-password',
    });
    request.flush({ status: 'password_set' });
    await result;
  });

  it('charge le journal avec ses filtres et le jeton Manager', async () => {
    const result = api.listAuditLogs({ action: 'login', result: 'failure', actor: 'manager', limit: 50, offset: 0 });
    await Promise.resolve();
    const request = http.expectOne(`${environment.apiUrl}/api/audit-logs?action=login&result=failure&actor=manager&limit=50&offset=0`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer manager-session-token');
    expect(request.request.params.get('action')).toBe('login');
    expect(request.request.params.get('result')).toBe('failure');
    expect(request.request.params.get('actor')).toBe('manager');
    request.flush({ items: [], total: 0, limit: 50, offset: 0 });
    await expect(result).resolves.toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });
});
