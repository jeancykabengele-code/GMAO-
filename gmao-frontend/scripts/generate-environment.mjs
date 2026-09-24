import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const apiUrl = process.env.GMAO_API_URL?.trim();
if (!apiUrl) { console.error('Variable de production manquante : GMAO_API_URL'); process.exit(1); }
const environment = { production: true, apiUrl: apiUrl.replace(/\/+$/, '') };
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'environments', 'environment.production.ts');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `export const environment = ${JSON.stringify(environment, null, 2)} as const;\n`, { encoding: 'utf8' });
console.log('Configuration Angular de production générée.');