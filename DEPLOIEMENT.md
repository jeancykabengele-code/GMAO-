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

Le push sur `main` déclenche la CI et les intégrations de déploiement. Le blueprint Render demande `autoDeployTrigger: checksPass` : vérifier que le service existant utilise bien **After CI Checks Pass** dans ses paramètres, car une modification du fichier ne prouve pas à elle seule son application au service. Vercel exécute les tests Angular avant la compilation via `npm run vercel-build` ; tout échec empêche ce build d'être publié. Ce contrôle Vercel porte sur le frontend et ne remplace pas un verrou global dépendant aussi du backend.

La disponibilité de la production est contrôlée toutes les dix minutes par le workflow **Disponibilité production**. Configurer le secret GitHub Actions `GMAO_HEALTH_TOKEN` pour inclure la sonde Aiven protégée et suivre la [procédure d’incident](docs/incident-disponibilite.md). Une surveillance ne supprime pas la mise en veille : avant une exploitation critique, remplacer les plans gratuits conformément aux options et coûts documentés dans cette procédure.

La CI exécute la même commande frontend et conserve le rapport JUnit dans l'artefact **angular-test-results** pendant 14 jours, même si les tests échouent. Pour reproduire uniquement les tests : `npm run test:ci` depuis `gmao-frontend`. Ne pas contourner un échec par une désactivation de tests ou une publication manuelle.

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

## Protection des connexions

`POST /api/auth/local/login` admet au maximum **5 échecs par couple IP/e-mail sur 15 minutes**, avec une attente minimale de **1, 2, 4 puis 8 secondes** entre les essais. Le sixième échec est bloqué jusqu'à la fin de la fenêtre initiale. Un second plafond de **50 échecs par IP sur 15 minutes**, tous e-mails confondus, limite la rotation des comptes. Une place est réservée avant la vérification du mot de passe, puis libérée si la connexion réussit : cinq ouvertures de session successives ne bloquent pas le compte. Les requêtes rejetées ne prolongent pas la fenêtre. Une déconnexion, un changement de mot de passe, une réinitialisation ou une désactivation invalide les jetons déjà émis.

Le refus retourne HTTP **429**, `Retry-After` et un message d'attente dans l'interface. Si le stockage des compteurs est indisponible, la connexion retourne **503** sans contourner la protection. Les blocages sont journalisés sans mot de passe, jeton, IP brute ni e-mail brut (identifiant HMAC pour corrélation). La base conserve uniquement les clés HMAC et les compteurs ; elle est partagée par tous les workers et instances utilisant la même base et la même clé Django.

Au démarrage Docker, `python manage.py migrate --noinput` applique toutes les migrations versionnées, puis `python manage.py verify_business_schema` contrôle les 16 tables métier, leurs colonnes, clés primaires et contraintes uniques. Gunicorn ne démarre pas si une migration ou ce contrôle échoue. Le lanceur local exécute les mêmes étapes. La migration initiale adopte les tables Aiven déjà présentes sans les recréer et crée uniquement celles qui manquent. La CI reproduit l'adoption et un retour arrière non destructif sur MySQL 8.4, sans identifiants Aiven. Voir [la procédure de migration et de rollback](docs/migrations-metier.md).

La [politique des mots de passe](docs/politique-mots-de-passe.md) impose 14 caractères, bloque les valeurs courantes ou compromises et conserve cinq anciens hachages pour empêcher leur réutilisation. Render active explicitement la vérification anonymisée Pwned Passwords avec `GMAO_PWNED_PASSWORD_CHECK=true`.

La [gestion des utilisateurs](docs/gestion-utilisateurs.md) est réservée au rôle Administrateur par la permission serveur `manageUsers`. Tant qu'aucun Administrateur actif n'existe, le Manager conserve provisoirement cet accès afin de créer le premier compte. Une réinitialisation exige le mot de passe actuel de l'Administrateur ; le masquage du lien et la garde Angular complètent le contrôle Django sans le remplacer.

Le [journal d’audit](docs/journal-audit.md) est réservé à l'Administrateur. La migration `login_guard.0003_auditlog`, exécutée automatiquement au démarrage Render, crée la table append-only `audit_log` et ses déclencheurs d’immutabilité.

La page **Sauvegardes** (même permission `manageUsers`) génère à la demande une archive ZIP de toutes les données métier, des sites, des comptes (hors mots de passe) et du journal d'audit, via `POST /api/backups/export`, téléchargée immédiatement par le navigateur. L'archive est construite en mémoire et jamais écrite sur le disque du conteneur (éphémère sur Render) ; chaque export est tracé dans le journal d'audit (action `backup_export`). Cette fonctionnalité couvre un export ponctuel à la demande ; elle ne remplace pas une sauvegarde automatisée et testée de la base Aiven MySQL, à mettre en place séparément pour une exploitation critique.

Sur Render (`RENDER=true`, fourni par la plateforme), la source est l'en-tête `CF-Connecting-IP` seulement lorsque l'adresse TCP est le proxy : boucle locale, réseau privé, ou plage Cloudflare publiée. Une adresse publique qui envoie cet en-tête est comptée sur sa propre adresse, pas sur la valeur de l'en-tête. `X-Forwarded-For` est ignoré ; en local, seule `REMOTE_ADDR` est utilisée. Un en-tête absent ou invalide derrière un proxy de confiance partage le quota `unknown`. Les IPv6 sont regroupées par `/64`. Voir [les indications Render sur le proxy](https://render.com/articles/host-pocketbase-on-render).

`python manage.py purge_login_buckets` supprime uniquement les fenêtres de plus de 24 heures. Cette purge est exécutée au démarrage Docker ; la planifier aussi quotidiennement sur l'environnement d'exploitation pour éviter l'accumulation entre deux déploiements. Une modification de `DJANGO_SECRET_KEY` change les clés HMAC et redémarre les quotas.

Vérification en production : utiliser un identifiant de test inexistant, respecter les attentes entre les cinq essais, puis vérifier HTTP 429 au sixième. Ne pas utiliser un compte réel. En cas de retour arrière du code, conserver la nouvelle table : l'ancien code l'ignore et les données métier restent intactes. Un retour arrière désactive cette protection tant que le correctif n'est pas rétabli.

## Vercel — frontend Angular

1. Connecter le dépôt `Projet_Reporting_DC`.
2. Régler **Root Directory** sur `gmao-frontend`.
3. Utiliser `npm run vercel-build`.
4. Définir uniquement `GMAO_API_URL=https://gmao-ordc-api.onrender.com`.

Le dossier de sortie est `dist/gmao-frontend/browser`.

Vercel applique la CSP définie dans `gmao-frontend/vercel.json`. La CI vérifie le build dans Chromium avec cette politique et une API simulée. Les jetons persistants existants sont supprimés et les utilisateurs concernés doivent se reconnecter ; les nouvelles sessions sont limitées au stockage de l'onglet. La migration vers les cookies HttpOnly reste distincte. Voir [la politique, les limites et la procédure de test navigateur](gmao-frontend/docs/security-browser.md).

## Vérification finale

- Connexion avec un compte local Django.
- Lecture des équipements, PUE et GE.
- Vérification des rôles Administrateur, Manager, Chargé des opérations et Chef de site.
- Contrôle de `/health/database` après chaque changement de base.
