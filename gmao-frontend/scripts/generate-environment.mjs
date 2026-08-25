import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredVariables = [
  'GMAO_API_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());
if (missingVariables.length) {
  console.error(`Variables de production manquantes : ${missingVariables.join(', ')}`);
  process.exit(1);
}

const normalizeUrl = (value) => value.trim().replace(/\/+$/, '');
const environment = {
  production: true,
  apiUrl: normalizeUrl(process.env.GMAO_API_URL),
  supabaseUrl: normalizeUrl(process.env.SUPABASE_URL),
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY.trim(),
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, '..', 'src', 'environments', 'environment.production.ts');
const source = `export const environment = ${JSON.stringify(environment, null, 2)} as const;\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source, { encoding: 'utf8' });
console.log('Configuration Angular de production générée.');

