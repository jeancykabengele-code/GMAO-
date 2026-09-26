import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService login throttling', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the server waiting time and does not create a session on HTTP 429', async () => {
    const result = auth.signIn('user@example.invalid', 'password', false);
    const assertion = expect(result).rejects.toMatchObject({
      code: 'rate_limited', message: 'Trop de tentatives de connexion. Réessayez dans 900 secondes.',
    });
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush(
      { detail: 'Trop de tentatives de connexion. Réessayez dans 900 secondes.', retryAfter: 900 },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '900' } },
    );
    await assertion;
    expect(auth.authenticated()).toBe(false);
    expect(auth.accessToken()).toBeNull();
  });

  it('provides a clear fallback when a proxy returns an empty HTTP 429', async () => {
    const result = auth.signIn('user@example.invalid', 'password', false);
    const assertion = expect(result).rejects.toMatchObject({ code: 'rate_limited', message: 'Trop de tentatives de connexion. Patientez avant de réessayer.' });
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush(null, { status: 429, statusText: 'Too Many Requests' });
    await assertion;
  });

  it('reports temporary unavailability instead of invalid credentials on HTTP 503', async () => {
    const result = auth.signIn('user@example.invalid', 'password', false);
    const assertion = expect(result).rejects.toMatchObject({ code: 'unavailable', message: 'Connexion temporairement indisponible. Veuillez réessayer.' });
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush({}, { status: 503, statusText: 'Service Unavailable' });
    await assertion;
  });
});
