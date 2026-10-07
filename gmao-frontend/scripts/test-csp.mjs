import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const policy = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value;
const api = 'https://gmao-ordc-api.onrender.com';
const tokenKey = 'gmao-local-access-token';
const profile = { id: 'csp-test-user', email: 'csp@example.invalid', fullName: 'Test CSP', role: 'manager', site: null, active: true,
  permissions: { globalScope: true, viewDashboard: true, viewDocumentation: true, createRecords: false, modifyExisting: true, deleteRecords: true, manageUsers: true, viewAuditLog: true, allowedSites: ['Goma'] } };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const root = resolve('dist/gmao-frontend/browser');
let server;
let browser;
let page;
const errors = [];
const violations = [];
const failedRequests = [];
let apiCalls = 0;

try {
  let base = process.env.CSP_TEST_BASE_URL;
  if (!base) {
    // Serve the real production build with the exact Vercel policy.
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let file = resolve(root, `.${pathname}`);
        if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
        if (!extname(file)) file = resolve(root, 'index.html');
        if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': policy });
        response.end(await readFile(file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const origin = new URL(base).origin;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CSP_BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext({ acceptDownloads: true });
  // No real account, token, or business data is used, even against production HTML.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === api) {
      apiCalls++;
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      let data = [];
      if (url.pathname.endsWith('/auth/local/login')) data = { accessToken: 'csp-fake-tab-token', profile };
      else if (url.pathname.endsWith('/me')) data = profile;
      else if (url.pathname.includes('/notifications')) data = { items: [], unreadCount: 0 };
      else if (url.pathname.endsWith('/audit-logs')) data = { items: [], total: 0, limit: 50, offset: 0 };
      else if (url.pathname.endsWith('/rh-history')) data = { items: [], total: 0, limit: 50, offset: 0 };
      else if (url.pathname.endsWith('/sites')) data = [{ name: 'Goma', code: 'GOM', active: true }];
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
    } else if (url.origin === origin || url.protocol === 'blob:') {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await context.exposeBinding('__captureCsp', (_, violation) => violations.push(violation));
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      const violation = { directive: event.effectiveDirective, blocked: event.blockedURI };
      window.__cspViolations.push(violation);
      void window.__captureCsp(violation);
    });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const home = await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(home.headers()['content-security-policy'], policy, 'Exact deployed CSP header required');
  await page.locator('app-public-home-page').waitFor();
  // Old remembered tokens must be removed and must not silently authenticate.
  await page.evaluate(key => localStorage.setItem(key, 'legacy-fake-token'), tokenKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('app-public-home-page').waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), tokenKey), null);
  await page.locator('a.login-button').click();
  await page.locator('app-connexion-page form').first().waitFor();
  assert.equal(await page.getByText('Rester connecté', { exact: true }).count(), 0);
  await page.locator('#email').fill(profile.email);
  await page.locator('#password').fill('fake-browser-test-password');
  await page.locator('button.submit-button').first().click();
  await page.waitForURL('**/tableau-de-bord', { waitUntil: 'domcontentloaded' });
  await page.locator('.sidebar').waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), tokenKey), null);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), tokenKey), 'csp-fake-tab-token');
  for (const path of ['accueil', 'equipements', 'gestion-tickets', 'maintenance/interventions-realisees', 'maintenance/suivi-groupes-electrogenes', 'pieces-rechange', 'fuel-ge', 'consommation-groupes-ge', 'pue', 'ravitaillement-fuel', 'problemes-datacenter', 'administration/sites', 'administration/utilisateurs', 'administration/journal-audit', 'administration/historique-rh', 'documentations']) {
    await page.goto(`${base}/${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor();
    await page.locator('main > router-outlet + *').waitFor();
    assert.equal(new URL(page.url()).pathname, `/${path}`);
  }
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.export-excel-button').first().click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.xlsx$/);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'Export must remain an XLSX archive');
  await page.locator('.logout-button').click();
  await page.waitForURL(base + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), tokenKey), null);
  assert.ok(apiCalls > 0, 'Mock API must actually have been used');
  assert.deepEqual(errors, [], 'No uncaught application errors');
  assert.deepEqual(violations, [], 'No CSP violations during legitimate workflows');
  // Negative security checks after the legitimate workflows.
  await page.evaluate(() => {
    try {
      const script = document.createElement('script');
      script.textContent = 'window.__injectedScriptRan = true';
      document.body.append(script);
    } catch { /* Trusted Types rejects the write before execution. */ }
  });
  assert.equal(await page.evaluate(() => window.__injectedScriptRan), undefined);
  await page.evaluate(async () => { try { await fetch('https://example.invalid/csp-exfiltration-test'); } catch { /* Expected. */ } });
  await page.waitForFunction(() => window.__cspViolations.some(item => item.directive === 'connect-src'));
  console.log('CSP browser checks passed: public home, login, 15 internal routes, reload, XLSX, logout, blocked injection and external connection. API fully mocked.');
} catch (error) {
  console.error(JSON.stringify({ url: page?.url(), apiCalls, errors, violations, failedRequests,
    loginError: page ? await page.locator('.login-message').allTextContents().catch(() => []) : [] }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
