import { readFile } from 'node:fs/promises';

// La politique de sécurité du contenu est définie une seule fois, dans la configuration Nginx.
export async function readCspPolicy() {
  const conf = await readFile(new URL('../../ops/laragon/gmao.test.conf', import.meta.url), 'utf8');
  const match = conf.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
  if (!match) throw new Error('Content-Security-Policy introuvable dans ops/laragon/gmao.test.conf');
  return match[1];
}
