# Exploitation et mises à jour de GMAO

GMAO est hébergée sur un serveur de l'entreprise (Laragon sous Windows) : aucun service en ligne n'est nécessaire à son fonctionnement. **GitHub** héberge uniquement le code source et la CI.

| Élément | Rôle | Emplacement |
|---|---|---|
| `gmao-frontend/` | Interface Angular, fichiers statiques servis par Nginx | `C:\GMAO\web` |
| `gmao/` | API Django, servie par waitress sur `127.0.0.1:8081` | `.venv-laragon`, tâche planifiée `GMAO API` |
| MySQL 8.4 (Laragon) | Base de données `gmao`, écoute sur `127.0.0.1` uniquement | `C:\laragon\data` |
| Nginx (Laragon) | HTTPS, interface, proxy de `/api/` et `/health` vers l'API | `ops\laragon\gmao.test.conf` |
| Sauvegardes | Archive quotidienne de la base | `C:\GMAO\backups` (tâche `GMAO sauvegarde`) |

L'installation complète, pas à pas, est décrite dans [docs/installation-serveur.md](docs/installation-serveur.md).

## Publier une évolution

```powershell
git status
git add <fichiers>
git commit -m "Description de la modification"
git push origin main
```

Le push sur `main` déclenche la **CI GitHub Actions** (tests Angular avec couverture, validation de la CSP dans Chromium, tests Django avec couverture, tests MySQL de migration et de concurrence, parcours de bout en bout). Elle ne publie rien : la mise en production est une action explicite sur le serveur (section suivante). Ne pas contourner un échec par une désactivation de tests.

Pour reproduire uniquement les tests : `npm run test:ci` depuis `gmao-frontend`, et `python manage.py test profiles login_guard` depuis `gmao`.

## Mettre à jour le serveur

Sur le serveur, une fois la CI verte :

```powershell
git pull origin main
.\ops\laragon\build-frontend.ps1                         # interface (tests puis build, copie vers C:\GMAO\web)
Stop-ScheduledTask 'GMAO API'; Start-ScheduledTask 'GMAO API'   # API : migrations et contrôle du schéma au démarrage
```

Avant une mise à jour importante, lancer une sauvegarde manuelle : `.\ops\laragon\backup-mysql.ps1`.

## API Django

- Variables d'environnement dans `gmao\.env.laragon` (ignoré par git, modèle : `ops\laragon\gmao.env.example`).
- Base : `GMAO_DATABASE_ENGINE=mysql` et `GMAO_DB_HOST`, `GMAO_DB_PORT`, `GMAO_DB_NAME`, `GMAO_DB_USER`, `GMAO_DB_PASSWORD`. TLS est exigé par défaut (`GMAO_DB_CA_PATH` ou `GMAO_DB_CA_PEM`) ; `GMAO_MYSQL_SSL=false` n'est acceptable que pour un MySQL sur la même machine que l'API.
- `FRONTEND_ORIGINS` et `DJANGO_ALLOWED_HOSTS` portent le nom d'hôte de l'application.
- Le debug Django est désactivé par défaut. Conserver `DJANGO_DEBUG=false` et une `DJANGO_SECRET_KEY` secrète propre à l'installation : sans clé, le démarrage est refusé hors debug.
- `/health` est public et indépendant de MySQL. `/health/database` exige le secret dédié `GMAO_HEALTH_TOKEN` (32 octets aléatoires au moins, distinct de `DJANGO_SECRET_KEY` et d'un jeton utilisateur, jamais placé dans Angular ni dans une URL).

```powershell
Invoke-RestMethod https://gmao.test/health
Invoke-RestMethod https://gmao.test/health/database -Headers @{ Authorization = "Bearer $env:GMAO_HEALTH_TOKEN" }
```

`/health/database` répond HTTP 401 sans jeton ou avec un mauvais jeton, HTTP 200 (`status=UP`, `database=UP`, `responseTimeMs`) si la connexion fonctionne, HTTP 503 (`status=DOWN`) sinon. Aucun volume, nom de table ou détail SQL n'est retourné. La sonde exécute uniquement `SELECT 1` : elle vérifie la connexion, pas la conformité du schéma.

Au démarrage, `start-api.ps1` attend MySQL, applique `python manage.py migrate --noinput`, exécute `python manage.py verify_business_schema` (16 tables métier, colonnes, clés primaires et contraintes uniques) puis `purge_login_buckets`. L'API ne démarre pas si une étape échoue.

## Protection des connexions

`POST /api/auth/local/login` admet au maximum **5 échecs par couple IP/e-mail sur 15 minutes**, avec une attente minimale de **1, 2, 4 puis 8 secondes** entre les essais. Le sixième échec est bloqué jusqu'à la fin de la fenêtre initiale. Un second plafond de **50 échecs par IP sur 15 minutes**, tous e-mails confondus, limite la rotation des comptes.

Le refus retourne HTTP **429**, `Retry-After` et un message d'attente dans l'interface. Si le stockage des compteurs est indisponible, la connexion retourne **503** sans contourner la protection. Les blocages sont journalisés sans mot de passe, jeton, IP brute ni e-mail brut (identifiant HMAC pour corrélation).

L'adresse du client est lue dans l'en-tête `X-Real-IP`, **écrasé par Nginx**, uniquement lorsque la connexion TCP vient d'un proxy de confiance (`GMAO_TRUSTED_PROXIES`, par défaut `127.0.0.1,::1`). L'API n'écoute que sur `127.0.0.1` : elle n'est joignable que par Nginx. `X-Forwarded-For` est toujours ignoré.

`python manage.py purge_login_buckets` supprime uniquement les fenêtres de plus de 24 heures ; il est exécuté à chaque démarrage de l'API. Une modification de `DJANGO_SECRET_KEY` change les clés HMAC et redémarre les quotas.

Vérification : utiliser un identifiant de test inexistant, respecter les attentes entre les cinq essais, puis vérifier HTTP 429 au sixième. Ne pas utiliser un compte réel.

La [politique des mots de passe](docs/politique-mots-de-passe.md) impose 14 caractères, bloque les valeurs courantes et conserve cinq anciens hachages pour empêcher leur réutilisation. Le contrôle des mots de passe compromis (`GMAO_PWNED_PASSWORD_CHECK`) interroge un service en ligne : il est désactivé sur un serveur sans accès Internet.

La [gestion des utilisateurs](docs/gestion-utilisateurs.md) est réservée au rôle Administrateur par la permission serveur `manageUsers`. Le [journal d'audit](docs/journal-audit.md) est réservé à l'Administrateur ; la migration `login_guard.0003_auditlog` crée la table append-only `audit_log` et ses déclencheurs d'immutabilité (MySQL 8.4 exige `log_bin_trust_function_creators=1`, voir le guide d'installation).

## Supervision

La tâche planifiée `GMAO santé` exécute `ops\laragon\check-health.ps1` toutes les 10 minutes : elle contrôle l'interface, `/health` et `/health/database`, ajoute une ligne à `C:\GMAO\health.log` et échoue (code 1) si une vérification est en défaut. La procédure en cas d'alerte est dans [docs/incident-disponibilite.md](docs/incident-disponibilite.md).

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\GMAO\GMAO-Web\ops\laragon\check-health.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'GMAO santé' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force
```

## Sauvegardes

- **Quotidienne** : `ops\laragon\backup-mysql.ps1` (tâche `GMAO sauvegarde`, 2h00) produit une archive ZIP compressée de la base, avec rotation de 30 jours et copie facultative vers un second emplacement (`-CopyTo`).
- **À la demande** : la page **Sauvegardes** (permission `manageUsers`) génère une archive ZIP lisible (JSON par table : données métier, sites, comptes hors mots de passe, journal d'audit) via `POST /api/backups/export`, construite en mémoire et téléchargée immédiatement.
- Restaurer : importer le `.sql` de l'archive quotidienne dans une base vide (`mysql.exe -u root -p gmao_test < gmao.sql`). Tester la restauration au moins une fois par trimestre.

## Interface Angular

`ops\laragon\build-frontend.ps1 -ApiUrl https://gmao.test` construit la version de production, dont `GMAO_API_URL` est la seule variable. La politique de sécurité du contenu (CSP) est appliquée par Nginx (`ops\laragon\gmao.test.conf`) ; la CI la vérifie dans Chromium avec une API simulée. Les sessions sont limitées au stockage de l'onglet.

## Vérification finale

- Connexion avec un compte local Django.
- Lecture des équipements, PUE et GE.
- Vérification des rôles Administrateur, Manager, Chargé des opérations et Chef de site.
- Contrôle de `/health/database` après chaque changement de base.
- Une sauvegarde créée, copiée hors du serveur, et restaurée sur une base de test.
