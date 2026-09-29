import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService login and session security', () => {
  const tokenKey = 'gmao-local-access-token';
  const profile = { id: 'test-user', email: 'user@example.invalid', fullName: 'Test', role: 'manager', site: null, active: true };
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(tokenKey);
    sessionStorage.removeItem(tokenKey);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(tokenKey);
    sessionStorage.removeItem(tokenKey);
  });

  it('stores a successful login only in sessionStorage', async () => {
    localStorage.setItem(tokenKey, 'old-persistent-token');
    const result = auth.signIn('user@example.invalid', 'password');
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush({ accessToken: 'tab-token', profile });
    await result;
    expect(auth.authenticated()).toBe(true);
    expect(sessionStorage.getItem(tokenKey)).toBe('tab-token');
    expect(localStorage.getItem(tokenKey)).toBeNull();
  });

  it('routes an administrator directly to administration', () => {
    expect(auth.destinationFor('administrator')).toBe('/administration');
  });

  it('discards legacy persistent tokens without restoring them', async () => {
    localStorage.setItem(tokenKey, 'old-persistent-token');
    await auth.initialize();
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(auth.authenticated()).toBe(false);
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    http.expectNone(request => request.url.endsWith('/api/me'));
  });

  it('restores the current tab session after a reload', async () => {
    sessionStorage.setItem(tokenKey, 'tab-token');
    const result = auth.initialize();
    const request = http.expectOne(request => request.url.endsWith('/api/me'));
    expect(request.request.headers.get('Authorization')).toBe('Bearer tab-token');
    request.flush(profile);
    await result;
    expect(auth.authenticated()).toBe(true);
    expect(localStorage.getItem(tokenKey)).toBeNull();
  });

  it('clears expired tab sessions', async () => {
    sessionStorage.setItem(tokenKey, 'expired-token');
    const result = auth.initialize();
    http.expectOne(request => request.url.endsWith('/api/me')).flush({}, { status: 401, statusText: 'Unauthorized' });
    await result;
    http.expectOne(request => request.url.endsWith('/api/auth/local/logout')).flush({ status: 'logged_out' });
    expect(auth.authenticated()).toBe(false);
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
  });

  it('revokes the server session when the tab is signed in', async () => {
    const signedIn = auth.signIn('user@example.invalid', 'password');
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush({ accessToken: 'tab-token', profile });
    await signedIn;
    const done = auth.signOut();
    const logout = http.expectOne(request => request.url.endsWith('/api/auth/local/logout'));
    expect(logout.request.method).toBe('POST');
    expect(logout.request.headers.get('Authorization')).toBe('Bearer tab-token');
    logout.flush({ status: 'logged_out' });
    await done;
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(auth.accessToken()).toBeNull();
  });

  it('keeps the new token returned after a password change', async () => {
    const signedIn = auth.signIn('user@example.invalid', 'password');
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush({ accessToken: 'tab-token', profile });
    await signedIn;
    const changed = auth.changeLocalPassword('password', 'Phrase-longue-2026!');
    http.expectOne(request => request.url.endsWith('/api/auth/local/change-password')).flush({ status: 'changed', accessToken: 'next-token' });
    await changed;
    expect(sessionStorage.getItem(tokenKey)).toBe('next-token');
    expect(auth.accessToken()).toBe('next-token');
  });

  it('reports a temporary password imposed by an administrator and clears it once changed', async () => {
    const signedIn = auth.signIn('user@example.invalid', 'password');
    http.expectOne(request => request.url.endsWith('/api/auth/local/login'))
      .flush({ accessToken: 'tab-token', profile: { ...profile, mustChangePassword: true } });
    await signedIn;
    expect(auth.mustChangePassword()).toBe(true);

    const changed = auth.changeLocalPassword('password', 'Phrase-longue-2026!');
    http.expectOne(request => request.url.endsWith('/api/auth/local/change-password')).flush({ status: 'changed', accessToken: 'next-token' });
    await changed;
    expect(auth.mustChangePassword()).toBe(false);
  });

  it('removes tokens from both stores on logout', async () => {
    localStorage.setItem(tokenKey, 'legacy');
    sessionStorage.setItem(tokenKey, 'tab-token');
    await auth.signOut();
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(auth.accessToken()).toBeNull();
  });

  it('shows the server waiting time and does not create a session on HTTP 429', async () => {
    const result = auth.signIn('user@example.invalid', 'password');
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
    const result = auth.signIn('user@example.invalid', 'password');
    const assertion = expect(result).rejects.toMatchObject({ code: 'rate_limited', message: 'Trop de tentatives de connexion. Patientez avant de réessayer.' });
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush(null, { status: 429, statusText: 'Too Many Requests' });
    await assertion;
  });

  it('reports temporary unavailability instead of invalid credentials on HTTP 503', async () => {
    const result = auth.signIn('user@example.invalid', 'password');
    const assertion = expect(result).rejects.toMatchObject({ code: 'unavailable', message: 'Connexion temporairement indisponible. Veuillez réessayer.' });
    http.expectOne(request => request.url.endsWith('/api/auth/local/login')).flush({}, { status: 503, statusText: 'Service Unavailable' });
    await assertion;
  });
});
