# Bascule de production : Django + Aiven MySQL

## Préconditions

- La sauvegarde Supabase vérifiée est conservée hors Git.
- Les tables métier et les profils ont été importés dans Aiven MySQL.
- Le compte `manager@gmail.com` dispose d’un mot de passe temporaire créé dans Aiven. Il devra être remplacé dès sa première connexion.
- Les adresses e-mail restent des identifiants de connexion : aucune boîte e-mail n’est nécessaire.

## Ordre de bascule

### 1. Render — données MySQL, authentification Supabase encore active

Dans le service Render `gmao-ordc-api`, ajouter les variables suivantes depuis les informations de connexion Aiven, sans les publier dans Git :

- `GMAO_DATABASE_ENGINE=mysql`
- `AIVEN_MYSQL_HOST`
- `AIVEN_MYSQL_PORT`
- `AIVEN_MYSQL_DATABASE`
- `AIVEN_MYSQL_USER`
- `AIVEN_MYSQL_PASSWORD`
- `AIVEN_MYSQL_CA_PEM` : contenu complet du fichier `ca.pem`, y compris les lignes BEGIN/END.

Conserver `GMAO_AUTH_PROVIDER=supabase`, déployer, puis vérifier :

- `https://gmao-ordc-api.onrender.com/health`
- connexion avec un compte Supabase existant ;
- consultation des données, profils et sites.

Cette étape fait utiliser MySQL sans modifier le mode de connexion des utilisateurs.

### 2. Render — authentification Django locale

Après validation de l’étape 1, remplacer :

- `GMAO_AUTH_PROVIDER=django`

Déployer Render. Les jetons Supabase ne seront alors plus acceptés. Les comptes doivent se connecter avec leur identifiant et leur mot de passe temporaire ou personnel.

### 3. Vercel — interface de connexion locale

Dans les variables d’environnement du projet Vercel, ajouter :

- `GMAO_AUTH_PROVIDER=django`

Conserver `GMAO_API_URL` avec l’URL de l’API Render. Les variables Supabase peuvent rester présentes, mais ne seront plus exigées ni utilisées par le build Django.

Redéployer Vercel après le déploiement Render de l’étape 2.

## Vérifications après bascule

1. Se connecter avec `manager@gmail.com` et son mot de passe temporaire.
2. Vérifier l’obligation de changement du mot de passe à la première connexion.
3. Créer un compte depuis **Gestion des utilisateurs**, puis lui définir un mot de passe temporaire.
4. Vérifier que les managers et chefs des opérations ne peuvent pas créer de données métier ; seuls les chefs de site le peuvent.
5. Vérifier l’affichage des équipements, tickets, GE, PUE, fuel et notifications.
6. Vérifier les pages mobile et les actions de déconnexion.

## Retour arrière

En cas d’incident avant validation : remettre `GMAO_AUTH_PROVIDER=supabase` sur Render et retirer/mettre `GMAO_AUTH_PROVIDER=supabase` sur Vercel, puis redéployer les deux services. La sauvegarde Supabase reste intacte.