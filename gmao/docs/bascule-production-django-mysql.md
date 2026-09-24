# Exploitation de production — Django + Aiven MySQL

## Configuration Render

Le service `gmao-ordc-api` utilise exclusivement Aiven MySQL. Conserver uniquement les variables suivantes :

- `GMAO_DATABASE_ENGINE=mysql`
- `AIVEN_MYSQL_HOST`
- `AIVEN_MYSQL_PORT`
- `AIVEN_MYSQL_DATABASE`
- `AIVEN_MYSQL_USER`
- `AIVEN_MYSQL_PASSWORD`
- `AIVEN_MYSQL_CA_PEM`
- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG=false`
- `FRONTEND_ORIGINS=https://gmao-ordc.vercel.app`

Après un déploiement, vérifier :

- `https://gmao-ordc-api.onrender.com/health`
- `https://gmao-ordc-api.onrender.com/health/database`

Les deux routes doivent répondre avec `UP`.

## Configuration Vercel

Le frontend utilise uniquement :

- `GMAO_API_URL=https://gmao-ordc-api.onrender.com`

La racine du projet est `gmao-frontend` et la commande de build est `npm run vercel-build`. Publier le déploiement en **Production**.

## Comptes locaux

Les identifiants e-mail sont des noms de connexion, sans obligation de boîte e-mail. Le Manager crée ou réinitialise les mots de passe depuis **Administration → Gestion des utilisateurs**. Les mots de passe sont enregistrés sous forme de hachage dans MySQL.

## Contrôles après déploiement

1. Connexion avec un compte Manager.
2. Consultation des profils et des sites.
3. Connexion avec un Chef de site et vérification que lui seul peut créer des données métier.
4. Contrôle des équipements, PUE, GE, fuel et notifications.