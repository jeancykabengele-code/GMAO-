# Déploiement GitHub, Vercel et Render

L’application utilise un seul dépôt GitHub :

- `gmao-frontend/` est déployé sur Vercel ;
- `gmao/` est déployé sur Render ;
- Supabase fournit Auth et PostgreSQL.

## 1. Publier le dépôt sur GitHub

```powershell
cd C:\Users\JK\Projects\GMAO-Web
git add .
git commit -m "Préparation du déploiement"
git remote add origin https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
git push -u origin main
```

Avant le commit, contrôler `git status`. Le fichier `.gitignore` racine exclut
les dépendances, builds, environnements virtuels, bases SQLite, identifiants locaux
et fichiers d’environnement.

Le workflow `.github/workflows/ci.yml` vérifie automatiquement le frontend et le
backend lors des pushes et pull requests vers `main`.

## 2. Déployer le backend sur Render

1. Dans Render, créer un **Blueprint** depuis le dépôt GitHub.
2. Render détecte `render.yaml` et construit `gmao/Dockerfile`.
3. Renseigner `SUPABASE_DB_PASSWORD`.
4. Renseigner temporairement `FRONTEND_ORIGINS` avec l’origine locale ou l’URL
   Vercel dès qu’elle est connue.
5. Lancer le déploiement.

Vérifier ensuite :

- `https://VOTRE-BACKEND.onrender.com/health`
- `https://VOTRE-BACKEND.onrender.com/health/database`

Les deux routes doivent répondre avec le statut `UP`.

## 3. Déployer le frontend sur Vercel

1. Importer le même dépôt GitHub dans Vercel.
2. Définir **Root Directory** sur `gmao-frontend`.
3. Sélectionner le framework **Angular** s’il n’est pas détecté automatiquement.
4. Ajouter ces variables pour les environnements Production et Preview :

| Variable | Valeur |
|---|---|
| `GMAO_API_URL` | URL HTTPS du backend Render, sans barre finale |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Clé publique `sb_publishable_...` |

`npm run vercel-build` génère la configuration Angular de production sans
enregistrer ces valeurs dans Git. `vercel.json` publie le dossier
`dist/gmao-frontend/browser` et gère les routes de l’application Angular.

## 4. Finaliser CORS et Supabase Auth

Après le premier déploiement Vercel :

1. Copier l’URL `https://votre-projet.vercel.app`.
2. Définir cette URL exacte dans `FRONTEND_ORIGINS` sur Render, sans barre finale.
3. Ajouter cette URL dans les URL autorisées de Supabase Auth.
4. Redéployer le backend.
5. Tester la connexion, la lecture, une création autorisée et un export PDF.

Les URL temporaires des previews Vercel doivent aussi être autorisées si elles
doivent communiquer avec l’API.

## 5. Contrôles après déploiement

- La page publique et la page de connexion s’ouvrent directement.
- Une actualisation sur une route Angular ne renvoie pas d’erreur 404.
- Les trois rôles reçoivent les bonnes permissions.
- Un chef de site ne voit que son site.
- Le tableau de bord et Documentations sont réservés aux rôles globaux.
- Les exports PDF fonctionnent.
- Les routes `/health` et `/health/database` restent opérationnelles.

