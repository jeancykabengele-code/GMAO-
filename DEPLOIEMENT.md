# Déploiement GitHub, Vercel, Render et Aiven MySQL

L’application GMAO utilise un seul dépôt GitHub :

- `gmao-frontend/` : interface Angular déployée sur Vercel ;
- `gmao/` : API Django déployée sur Render ;
- Aiven MySQL : base de données ;
- Django : authentification locale, profils, rôles et sessions signées.

## Publier une évolution

```powershell
cd C:\Users\JK\Projects\GMAO-Web
git status
git add .
git commit -m "Description de la modification"
git push origin main
```

Le push sur `main` déclenche les déploiements automatiques Render et Vercel.

## Render — API Django

Render lit `render.yaml` et construit `gmao/Dockerfile`. Dans **Environment**, définir `GMAO_DATABASE_ENGINE=mysql`, les variables `AIVEN_MYSQL_HOST`, `AIVEN_MYSQL_PORT`, `AIVEN_MYSQL_DATABASE`, `AIVEN_MYSQL_USER`, `AIVEN_MYSQL_PASSWORD`, `AIVEN_MYSQL_CA_PEM`, ainsi que `FRONTEND_ORIGINS=https://gmao-ordc.vercel.app`.

Le contrôle automatique Render reste `/health`, public et indépendant de MySQL.

Le debug Django est désactivé par défaut, même si `DJANGO_DEBUG` est omis. Conserver néanmoins `DJANGO_DEBUG=false` explicitement dans Render et une `DJANGO_SECRET_KEY` secrète propre à l'environnement. Sans clé configurée, le démarrage est refusé en mode sans debug. Le debug est activé uniquement par les lanceurs de développement local.

Le diagnostic `/health/database` exige un secret dédié `GMAO_HEALTH_TOKEN` dans **Environment**. Le blueprint prévoit sa génération ; pour un service existant, vérifier sa présence et, si nécessaire, ajouter une valeur aléatoire d'au moins 32 octets avant de redéployer. Ne pas réutiliser `DJANGO_SECRET_KEY` ni un jeton utilisateur. Ne jamais placer ce secret dans Angular, une URL, le dépôt ou les journaux.

Depuis un poste de supervision où le secret est chargé dans l'environnement :

```powershell
Invoke-RestMethod https://gmao-ordc-api.onrender.com/health
Invoke-RestMethod https://gmao-ordc-api.onrender.com/health/database -Headers @{ Authorization = "Bearer $env:GMAO_HEALTH_TOKEN" }
```

Vérification après déploiement : `/health` répond HTTP 200 avec `status=UP`. `/health/database` sans jeton ou avec un mauvais jeton répond HTTP 401 ; avec le secret de supervision, il répond HTTP 200 avec `status=UP`, `database=UP` et `responseTimeMs`, ou HTTP 503 avec `status=DOWN` et `database=DOWN` si la connexion échoue. Aucun volume, nom de table ou détail SQL n'est retourné. Les réponses du diagnostic ne doivent pas être mises en cache. Si le secret est absent ou vide, ce diagnostic reste inaccessible (HTTP 401).

Cette sonde exécute uniquement `SELECT 1` : elle vérifie la connexion, pas la conformité du schéma ni la disponibilité de toutes les tables métier.

## Vercel — frontend Angular

1. Connecter le dépôt `Projet_Reporting_DC`.
2. Régler **Root Directory** sur `gmao-frontend`.
3. Utiliser `npm run vercel-build`.
4. Définir uniquement `GMAO_API_URL=https://gmao-ordc-api.onrender.com`.

Le dossier de sortie est `dist/gmao-frontend/browser`.

## Vérification finale

- Connexion avec un compte local Django.
- Lecture des équipements, PUE et GE.
- Vérification des rôles Manager, Chargé des opérations et Chef de site.
- Contrôle de `/health/database` après chaque changement de base.
