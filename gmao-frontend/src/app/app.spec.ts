import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService, UserProfile } from './auth/auth.service';
import { PORTAL_ENTRY_KEY } from './auth/portal-entry.guard';
import { AppComponent } from './app';
import { NotificationsService } from './shared/notifications.service';
import { routes } from './app.routes';

describe('App routing shell', () => {
  const managerProfile: UserProfile = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'manager@ordc.cd',
    full_name: 'Manager GMAO',
    role: 'manager',
    site: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  };

  let authenticatedState: ReturnType<typeof signal<boolean>>;
  let profileState: ReturnType<typeof signal<UserProfile | null>>;

  beforeEach(async () => {
    sessionStorage.removeItem(PORTAL_ENTRY_KEY);
    authenticatedState = signal(false);
    profileState = signal<UserProfile | null>(null);

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(routes),
        {
          provide: AuthService,
          useValue: {
            initialize: () => Promise.resolve(),
            authenticated: authenticatedState,
            mustChangePassword: signal(false),
            isAuthenticated: () => authenticatedState(),
            profile: profileState,
            destinationFor: () => '/tableau-de-bord',
            signOut: () => Promise.resolve(),
          } satisfies Pick<AuthService, 'initialize' | 'authenticated' | 'mustChangePassword' | 'isAuthenticated' | 'profile' | 'destinationFor' | 'signOut'>,
        },
        {
          provide: NotificationsService,
          useValue: {
            items: signal([]),
            unreadCount: signal(0),
            open: signal(false),
            loading: signal(false),
            toggle: () => undefined,
            markAllRead: () => Promise.resolve(),
            openNotification: () => Promise.resolve(),
            formatDate: () => '26/08/2026 10:00',
          },
        },
      ],
    }).compileComponents();
  });

  async function renderRoute(url: string) {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the public home without internal navigation', async () => {
    const compiled = await renderRoute('/');
    expect(compiled.querySelector('app-public-home-page')).toBeTruthy();
    expect(compiled.querySelector('.sidebar')).toBeNull();
    expect(compiled.querySelector('.sidebar-toggle')).toBeNull();
    expect(compiled.querySelector('.visual-entry')).toBeTruthy();
    expect(compiled.querySelector('.brand-header img')).toBeTruthy();
    expect(compiled.querySelector('a.login-button')?.getAttribute('href')).toBe('/connexion');
    expect(compiled.textContent).toContain('Outil de Gestion et de Planification Data Center ORDC');
  });

  it('redirects direct portal access to the public home', async () => {
    const compiled = await renderRoute('/connexion');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/');
    expect(compiled.querySelector('app-public-home-page')).toBeTruthy();
    expect(compiled.querySelector('app-connexion-page')).toBeNull();
  });
  it('renders the login portal after passing through the public home', async () => {
    sessionStorage.setItem(PORTAL_ENTRY_KEY, 'true');
    const compiled = await renderRoute('/connexion');
    expect(compiled.querySelector('app-connexion-page form')).toBeTruthy();
    expect(compiled.querySelector('.sidebar')).toBeNull();
    expect(compiled.querySelector('.sidebar-toggle')).toBeNull();
    expect(compiled.textContent).toContain('Portail de connexion');
  });

  it('sends an unauthenticated internal request through the public home first', async () => {
    const compiled = await renderRoute('/accueil');
    const router = TestBed.inject(Router);
    expect(router.url).toContain('returnUrl=%2Faccueil');
    expect(compiled.querySelector('app-public-home-page')).toBeTruthy();
    expect(compiled.querySelector('a.login-button')?.getAttribute('href')).toContain('/connexion?returnUrl=%2Faccueil');
  });
  it('denies dashboard and documentation navigation to a chef de site', async () => {
    authenticatedState.set(true);
    profileState.set({ ...managerProfile, role: 'chef_site', site: 'Goma' });

    const compiled = await renderRoute('/tableau-de-bord');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/accueil');
    expect(compiled.querySelector('a[href="/tableau-de-bord"]')).toBeNull();
    expect(compiled.querySelector('a[href="/documentations"]')).toBeNull();
    expect(compiled.querySelector('.notification-trigger')).toBeNull();
  });
  it('keeps the existing internal home and navigation for an authenticated user', async () => {
    authenticatedState.set(true);
    profileState.set(managerProfile);

    const compiled = await renderRoute('/accueil');
    expect(compiled.querySelector('app-accueil-page')).toBeTruthy();
    expect(compiled.querySelector('.sidebar')).toBeTruthy();
    expect(compiled.querySelector('.sidebar-toggle')).toBeTruthy();
    expect(compiled.querySelector('.notification-trigger')).toBeTruthy();
    expect(compiled.textContent).toContain('Bienvenue dans votre espace de travail.');
  });

  it('gives the administrator a Sauvegardes tab alongside the other administration tabs', async () => {
    authenticatedState.set(true);
    profileState.set({ ...managerProfile, id: 'admin-1', role: 'administrator', site: null });

    const compiled = await renderRoute('/administration');
    expect(compiled.querySelector('a[href="/administration"]')).toBeTruthy();
    expect(compiled.querySelector('app-sites-admin-page')).toBeTruthy();
    expect(compiled.querySelector('a[routerLink="utilisateurs"]')).toBeTruthy();
    expect(compiled.querySelector('a[routerLink="journal-audit"]')).toBeTruthy();
    expect(compiled.querySelector('a[routerLink="sauvegardes"]')).toBeTruthy();
  });

  it('keeps the Sauvegardes tab hidden and the route denied for the manager once handoff has happened', async () => {
    authenticatedState.set(true);
    profileState.set({
      ...managerProfile,
      permissions: {
        globalScope: true, viewDashboard: true, viewDocumentation: true, createRecords: false,
        modifyExisting: true, deleteRecords: true, manageUsers: false, viewAuditLog: false,
        allowedSites: ['Goma'],
      },
    });

    const compiled = await renderRoute('/administration/sauvegardes');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/accueil');
    expect(compiled.querySelector('a[routerLink="sauvegardes"]')).toBeNull();
  });
});
