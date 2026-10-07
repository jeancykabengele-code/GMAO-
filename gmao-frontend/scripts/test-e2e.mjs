import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Parcours critique de bout en bout : vrai backend Django (SQLite jetable) + vrai build Angular + vrai navigateur.
// Un chef de site saisit puis corrige un relevé RH et crée un équipement ; l'Administrateur retrouve l'ancienne et
// la nouvelle valeur dans « Historique des modifications », sans que le chef de site n'accède à l'administration.
const apiPort = 8765;
const webPort = 4300;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const python = process.env.E2E_PYTHON || 'python';
const projectRoot = resolve(import.meta.dirname, '..');
const backendRoot = resolve(projectRoot, '..', 'gmao');
const environmentFile = join(projectRoot, 'src', 'environments', 'environment.production.ts');
const outputDirectory = 'dist-e2e';
const staticRoot = resolve(projectRoot, outputDirectory, 'browser');
const tokenKey = 'gmao-local-access-token';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

const vercel = JSON.parse(await readFile(join(projectRoot, 'vercel.json'), 'utf8'));
const policy = vercel.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value
  .replaceAll('https://gmao-ordc-api.onrender.com', apiUrl);

// Mots de passe jetables, générés à chaque exécution et jamais écrits dans le dépôt.
const password = () => `E2e-${randomBytes(12).toString('hex')}`;
const accounts = {
  admin: { email: 'e2e-admin@example.test', password: password() },
  chef: { email: 'e2e-chef@example.test', password: password() },
};
const workDirectory = mkdtempSync(join(tmpdir(), 'gmao-e2e-'));
const backendEnvironment = {
  ...process.env, PYTHONIOENCODING: 'utf-8', DJANGO_DEBUG: 'true', GMAO_PWNED_PASSWORD_CHECK: 'false',
  GMAO_SQLITE_PATH: join(workDirectory, 'e2e.sqlite3'), FRONTEND_ORIGINS: webUrl,
  E2E_ADMIN_PASSWORD: accounts.admin.password, E2E_CHEF_PASSWORD: accounts.chef.password,
};
delete backendEnvironment.GMAO_DATABASE_ENGINE;

const originalEnvironment = readFileSync(environmentFile, 'utf8');
let backend;
let web;
let browser;
let page;
const errors = [];
const violations = [];

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command === 'npx', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} a échoué`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(account) {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('a.login-button').click();
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('button.submit-button').first().click();
  await page.locator('.sidebar').waitFor();
}

async function logout() {
  await page.locator('.logout-button').click();
  await page.waitForURL(`${webUrl}/`, { waitUntil: 'domcontentloaded' });
}

try {
  // 1. Backend jetable et build Angular pointant sur lui.
  run(python, ['scripts/seed_e2e.py'], { cwd: backendRoot, env: backendEnvironment });
  backend = spawn(python, ['manage.py', 'runserver', '--noreload', `127.0.0.1:${apiPort}`], { cwd: backendRoot, env: backendEnvironment, stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${apiUrl}/health`)).ok) break; } catch { /* le serveur démarre */ }
    assert.ok(attempt < 60, 'Le backend Django ne répond pas');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  writeFileSync(environmentFile, `export const environment = ${JSON.stringify({ production: true, apiUrl })} as const;\n`);
  run('npx', ['ng', 'build', '--configuration', 'production', '--output-path', outputDirectory], { cwd: projectRoot });

  web = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, webUrl).pathname);
      let file = resolve(staticRoot, `.${pathname}`);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep)) { response.writeHead(403).end(); return; }
      if (!extname(file)) file = resolve(staticRoot, 'index.html');
      if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': policy });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => web.listen(webPort, '127.0.0.1', resolve));

  // 2. Le chef de site saisit puis corrige un relevé RH et crée un équipement (API réelle).
  const chefSession = await api('/api/auth/local/login', { method: 'POST', body: accounts.chef });
  assert.equal(chefSession.status, 200, 'Connexion du chef de site');
  const chefToken = chefSession.body.accessToken;
  const reading = await api('/api/records/releves-rh-ge', { method: 'POST', token: chefToken, body: { site: 'Goma', periode: '2026-01', groupeCode: 'EQ-GOM-0001', rhActuel: 100, commentaires: '' } });
  assert.equal(reading.status, 201, JSON.stringify(reading.body));
  const correction = await api(`/api/records/releves-rh-ge/${reading.body.id}`, { method: 'PUT', token: chefToken, body: { site: 'Goma', periode: '2026-01', groupeCode: 'EQ-GOM-0001', rhActuel: 120.5, commentaires: 'Compteur relu' } });
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  const equipment = await api('/api/records/equipements', { method: 'POST', token: chefToken, body: { site: 'Goma', nom: 'Onduleur E2E', famille: 'Energie', localisation: 'Salle 1', marqueModele: 'X1', etat: 'Actif', criticite: 'Haute' } });
  assert.equal(equipment.status, 201, JSON.stringify(equipment.body));
  assert.equal((await api('/api/change-history', { token: chefToken })).status, 403, "L'historique reste réservé à l'Administrateur");

  // 3. Navigateur : le chef de site n'a pas accès à l'administration.
  browser = await chromium.launch({ headless: true, executablePath: process.env.CSP_BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext();
  await context.exposeBinding('__captureCsp', (_, violation) => violations.push(violation));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => { void window.__captureCsp({ directive: event.effectiveDirective, blocked: event.blockedURI }); });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));

  await login(accounts.chef);
  assert.equal(await page.locator('a[href^="/administration"]').count(), 0, "Pas de menu d'administration pour le chef de site");
  await page.goto(`${webUrl}/administration/historique-modifications`, { waitUntil: 'domcontentloaded' });
  await page.locator('.sidebar').waitFor();
  assert.ok(!new URL(page.url()).pathname.startsWith('/administration'), `Accès refusé attendu, URL : ${page.url()}`);
  await logout();

  // 4. L'Administrateur retrouve les anciennes et nouvelles valeurs dans la feuille dédiée.
  await login(accounts.admin);
  await page.locator('.subnav a[href="/administration/historique-modifications"]').click();
  await page.locator('app-change-history-page table tbody tr').first().waitFor();
  const rows = page.locator('app-change-history-page table tbody tr');
  const correctionRow = rows.filter({ hasText: 'Relevés RH' }).filter({ hasText: 'Modification' });
  assert.equal(await correctionRow.count(), 1, 'Une ligne de correction du relevé RH');
  const correctionText = await correctionRow.innerText();
  assert.match(correctionText, /RH actuel : 100 → 120,5/);
  assert.match(correctionText, /Commentaires : — → Compteur relu/);
  assert.match(correctionText, /e2e-chef@example\.test/);
  assert.match(correctionText, /Goma/);
  assert.equal(await rows.filter({ hasText: 'Relevés RH' }).filter({ hasText: 'Création' }).count(), 1, 'La saisie initiale du relevé');
  assert.equal(await rows.filter({ hasText: 'Onduleur E2E' }).filter({ hasText: 'Création' }).count(), 1, "La création de l'équipement");

  await page.locator('select[name="resource"]').selectOption('equipements');
  await page.locator('button.primary', { hasText: 'Filtrer' }).click();
  await page.locator('app-change-history-page table tbody tr', { hasText: 'Onduleur E2E' }).waitFor();
  assert.equal(await rows.filter({ hasText: 'Relevés RH' }).count(), 0, 'Le filtre par type de fiche exclut les relevés RH');

  // 5. Le journal d'audit reste dédié à la sécurité.
  await page.locator('.subnav a[href="/administration/journal-audit"]').click();
  await page.locator('app-audit-log-page table tbody tr', { hasText: 'Connexion' }).first().waitFor();
  const auditText = await page.locator('app-audit-log-page table').innerText();
  assert.doesNotMatch(auditText, /RH actuel|Onduleur E2E/, 'Les modifications de fiches ne polluent pas le journal d’audit');
  await logout();

  assert.deepEqual(errors, [], 'Aucune erreur applicative non interceptée');
  assert.deepEqual(violations, [], 'Aucune violation CSP');
  console.log("E2E OK : connexion, saisie et correction d'un relevé RH, droits du chef de site, historique des modifications et journal d'audit.");
} catch (error) {
  console.error(JSON.stringify({ url: page?.url(), errors, violations }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (web) await new Promise(resolve => web.close(resolve));
  if (backend) backend.kill();
  writeFileSync(environmentFile, originalEnvironment);
  rmSync(resolve(projectRoot, outputDirectory), { recursive: true, force: true });
  rmSync(workDirectory, { recursive: true, force: true });
}
