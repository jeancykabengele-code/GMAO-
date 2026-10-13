# Protection du navigateur et sessions

La CSP envoyée par Nginx autorise les scripts du site uniquement, sans `unsafe-inline` ni `unsafe-eval` pour JavaScript. Les gestionnaires HTML (`onclick`, `onload`…) sont interdits. Les connexions réseau sont limitées au site et à l'API du même site (même origine). Les objets, cadres et workers sont interdits. Trusted Types restreint les insertions HTML/scripts aux politiques Angular et au chargement des bundles sur les navigateurs compatibles.

Les styles Angular sont injectés à l'exécution : `style-src` conserve donc `unsafe-inline` pour les styles uniquement. Il ne s'agit pas d'une autorisation pour les scripts. Le build désactive l'insertion de CSS critique, qui créait un gestionnaire `onload` incompatible. Aucun script tiers n'est ajouté. Lors d'un changement de domaine d'API, adapter ensemble `GMAO_API_URL` et `connect-src`.

Le jeton n'est plus enregistré dans `localStorage`. Les anciens jetons persistants sont supprimés dès l'initialisation du service d'authentification, même sur l'accueil public, sans être réutilisés. Les utilisateurs qui avaient choisi « Rester connecté » doivent se reconnecter. Cette option est retirée du formulaire. `sessionStorage` conserve la connexion dans l'onglet et permet son rechargement ; la déconnexion explicite efface le jeton et demande au serveur de l'invalider. Un changement de mot de passe remplace le jeton de l'onglet par celui que l'API renvoie. Certains navigateurs peuvent restaurer des onglets et leur stockage : sur un poste partagé, utiliser la déconnexion. La durée maximale serveur reste applicable.

**Limite restante :** `sessionStorage` demeure accessible au JavaScript de l'application. La CSP réduit le risque XSS sans le supprimer. Le passage à un cookie `HttpOnly`, `Secure`, `SameSite=Strict` n'est pas réalisé par ce correctif. Il nécessite une architecture frontend/API de même site (ou un proxy de même origine), des protections CSRF et une validation complète de la connexion/déconnexion ; l'interface et l'API partagent la même origine (Nginx). Ne pas présenter ce stockage temporaire comme équivalent à un cookie HttpOnly.

## Vérifications

- `npm run test:ci` : stockage limité à l'onglet, suppression des anciennes sessions, rechargement, expiration, déconnexion et reste des tests Angular.
- Compiler en production, puis `npm run test:csp` : le serveur local applique l'en-tête exact de `ops/laragon/gmao.test.conf`. Chromium vérifie l'accueil, la connexion, les pages internes, l'export XLSX, la déconnexion et le refus d'injection/script et de connexion externe. L'API est entièrement simulée ; aucun compte réel n'est utilisé.
- Pour Chrome déjà installé sur Windows : définir `CSP_BROWSER_EXECUTABLE` avec son chemin avant ce test. Dans la CI, Chromium est installé via Playwright.
- Après déploiement : définir `CSP_TEST_BASE_URL=https://gmao.test` et relancer le même test. Il vérifie alors l'en-tête et les fichiers réellement publiés, toujours avec une API simulée. Les réponses d'API sont validées séparément par les tests backend.

Références : [sécurité Angular et CSP](https://angular.dev/best-practices/security), [OWASP et le stockage navigateur](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).
