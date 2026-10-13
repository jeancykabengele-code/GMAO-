# Migration vers Laragon (hébergement interne)

Ce guide remplace les services en ligne par une installation sur un serveur de l'entreprise :

| Avant | Après (Laragon) |
|---|---|
| Vercel (interface Angular) | Nginx de Laragon, fichiers statiques dans `C:\GMAO\web` |
| Render (API Django, gunicorn) | Django servi par **waitress** (gunicorn ne fonctionne pas sous Windows) |
| Aiven MySQL | MySQL 8.4 de Laragon, sur la même machine |
| GitHub Actions (sauvegarde, supervision) | Tâches planifiées Windows |

Tout passe par **un seul nom d'hôte** (`https://gmao.test` dans ce guide) : Nginx sert l'interface et transmet `/api/` et `/health` à l'API. L'interface et l'API partagent la même origine, il n'y a donc pas de réglage CORS particulier.

```
Navigateur ──https──▶ Nginx (443) ──┬─▶ fichiers statiques  C:\GMAO\web
                                    └─▶ API Django (waitress, 127.0.0.1:8081) ──▶ MySQL (127.0.0.1:3306)
```

Les chemins ci-dessous correspondent à l'installation constatée : Laragon dans `C:\laragon` avec MySQL 8.4.3, Nginx 1.30, Python 3.13 et Node 22. Adapter les numéros de version si votre installation diffère.

## 0. Avant de commencer

- Un poste ou serveur Windows qui reste allumé, avec Laragon, Git et Node.js (Laragon fournit Node et Python).
- Le dépôt cloné, par exemple dans `C:\GMAO\GMAO-Web`.
- Les accès actuels : mot de passe et certificat CA d'Aiven (pour copier les données), URL de l'application actuelle.
- Une période de **gel des saisies** pour la bascule finale (section 4).
- Les ports **80 et 443 libres** : le Nginx de Laragon en a besoin. Sous Windows, IIS (service `W3SVC`) et le service `http` les occupent souvent, ce qui fait échouer Nginx avec « bind() to 0.0.0.0:80 failed (10013) ». Vérifier avec `Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 80,443`. Si IIS n'est pas utilisé, l'arrêter (`Stop-Service W3SVC` puis désactiver son démarrage automatique). S'il doit rester, faire écouter Nginx sur d'autres ports (par exemple 8443) : l'adresse devient alors `https://gmao.test:8443`, à reporter dans `ServerName`/`-ApiUrl`/`FRONTEND_ORIGINS`.

## 1. Préparer Laragon

1. Menu Laragon → **Préférences → Services & Ports** : choisir **Nginx** comme serveur web et laisser Apache désactivé (les deux ne peuvent pas écouter le port 443).
2. Cocher le démarrage de Laragon avec Windows et le démarrage automatique des services.
3. Créer les dossiers :

```powershell
New-Item -ItemType Directory -Force C:\GMAO\web, C:\GMAO\backups
```

## 2. Créer la base MySQL

Ouvrir un terminal Laragon (ou HeidiSQL) puis exécuter, en remplaçant les mots de passe :

```sql
-- Protéger le compte root (vide par défaut dans Laragon).
ALTER USER 'root'@'localhost' IDENTIFIED BY '<mot-de-passe-root>';

CREATE DATABASE gmao CHARACTER SET utf8mb4;

CREATE USER 'gmao_app'@'localhost'  IDENTIFIED BY '<mot-de-passe-app>';
CREATE USER 'gmao_app'@'127.0.0.1'  IDENTIFIED BY '<mot-de-passe-app>';
GRANT ALL PRIVILEGES ON gmao.* TO 'gmao_app'@'localhost', 'gmao_app'@'127.0.0.1';

-- Compte dédié à la sauvegarde : lecture seule.
CREATE USER 'gmao_backup'@'localhost' IDENTIFIED BY '<mot-de-passe-sauvegarde>';
CREATE USER 'gmao_backup'@'127.0.0.1' IDENTIFIED BY '<mot-de-passe-sauvegarde>';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON gmao.* TO 'gmao_backup'@'localhost', 'gmao_backup'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Le mot de passe root modifié doit aussi être reporté dans Laragon (**Base de données → Changer le mot de passe root**) pour que ses outils continuent de fonctionner.

Deux réglages du fichier `C:\laragon\bin\mysql\mysql-8.4.3-winx64\my.ini`, section `[mysqld]`, sont nécessaires (puis redémarrer MySQL depuis Laragon) :

```ini
# Laragon n'en définit pas : sans cette ligne MySQL écoute sur toutes les interfaces.
bind-address=127.0.0.1
# MySQL 8.4 active le journal binaire ; la migration du journal d'audit crée des déclencheurs
# (table en ajout seul) et échoue sans ce réglage : « (1419) You do not have the SUPER privilege ».
log_bin_trust_function_creators=1
```

Le pare-feu Windows ne doit pas ouvrir le port 3306.

## 3. Installer et configurer l'API

```powershell
cd C:\GMAO\GMAO-Web
.\ops\laragon\install-api.ps1          # crée gmao\.venv-laragon avec le Python de Laragon
Copy-Item .\ops\laragon\gmao.env.example .\gmao\.env.laragon
notepad .\gmao\.env.laragon            # remplacer chaque <...>
```

Générer chaque secret (`DJANGO_SECRET_KEY`, `GMAO_HEALTH_TOKEN`, `GMAO_BACKUP_TOKEN`) :

```powershell
C:\laragon\bin\python\python-3.13\python.exe -c "import secrets; print(secrets.token_urlsafe(50))"
```

Points importants du fichier `.env.laragon` :

- `GMAO_MYSQL_SSL=false` : MySQL est sur la même machine, sans TLS. Cette valeur n'est à utiliser que dans ce cas ; hors de ce cas, laisser TLS actif avec un certificat CA.
- Les variables `AIVEN_MYSQL_*` gardent leur nom historique, mais pointent vers `127.0.0.1` et l'utilisateur `gmao_app`.
- `GMAO_PWNED_PASSWORD_CHECK=false` : ce contrôle interroge un service en ligne. Les autres règles de mot de passe (14 caractères minimum, valeurs courantes, historique) restent actives.
- Ce fichier est ignoré par git et ne doit jamais être commité.

## 4. Copier les données d'Aiven vers MySQL local

Faire cette étape pour la **bascule finale**, après avoir demandé aux utilisateurs de cesser les saisies (ou en suspendant le service Render). Aiven n'est jamais modifié : seul un export en lecture est effectué.

1. Télécharger le certificat CA depuis la console Aiven et l'enregistrer dans `C:\GMAO\aiven-ca.pem`.
2. **Arrêter l'API locale** (le script refuse de s'exécuter tant qu'elle écoute sur le port 8081).
3. Lancer le script, en indiquant l'hôte et le port d'Aiven (visibles dans la console) :

```powershell
.\ops\laragon\import-from-aiven.ps1 -SourceHost <hote-aiven> -SourcePort <port-aiven>
```

Le script demande de taper `OUI`, puis le mot de passe d'Aiven (saisi à l'écran, jamais écrit en clair dans le dépôt). Il exécute quatre étapes :

| Étape | Action |
|---|---|
| 1 | Export de la base source avec `mysqldump` (transaction unique, TLS vérifié) |
| 2 | Retrait des `DEFINER` : l'utilisateur Aiven n'existe pas en local, les déclencheurs du journal d'audit seraient inutilisables |
| 3 | Import dans la base locale `gmao` (**remplacée**) |
| 4 | Comptage des lignes de chaque table, côté Aiven et côté local ; le script échoue si une table diffère |

Le fichier d'export, qui contient toutes les données, est supprimé à la fin. Les comptes (mots de passe hachés), les profils, le journal d'audit et l'historique des migrations Django sont conservés.

4. Démarrer l'API (section 5) : elle applique les migrations manquantes et contrôle le schéma. **La migration `profiles.0007` supprime les anciennes lignes PUE mensuelles** si elles n'avaient pas déjà été converties : c'est voulu, la feuille PUE est désormais journalière.

**Solution de repli** si `mysqldump` n'est pas utilisable : l'archive de **Administration → Sauvegardes** (réservée à l'Administrateur) contient un fichier JSON par table, qui se recharge avec `python manage.py loaddata`. Les mots de passe ne font volontairement pas partie de cet export : il faudra les réinitialiser un par un (`python manage.py reset_gmao_password --help`).

## 5. Démarrer l'API

```powershell
cd C:\GMAO\GMAO-Web
.\ops\laragon\start-api.ps1
```

Le script charge `gmao\.env.laragon`, applique `migrate`, vérifie les 16 tables métier avec `verify_business_schema`, purge les compteurs de connexion puis lance waitress sur `127.0.0.1:8081`.

Contrôle depuis un autre terminal :

```powershell
Invoke-RestMethod http://127.0.0.1:8081/health
Invoke-RestMethod http://127.0.0.1:8081/health/database -Headers @{ Authorization = "Bearer <GMAO_HEALTH_TOKEN>" }
```

Les deux doivent répondre `UP`.

## 6. Construire et publier l'interface

```powershell
cd C:\GMAO\GMAO-Web
.\ops\laragon\build-frontend.ps1 -ApiUrl https://gmao.test -Target C:\GMAO\web
```

Le script installe les dépendances (`npm ci`), exécute les tests, construit la version de production avec `GMAO_API_URL`, puis copie le résultat dans `C:\GMAO\web`. L'option `-SkipTests` saute les tests en cas d'urgence.

## 7. Nginx, nom d'hôte et HTTPS

1. Ajouter le nom d'hôte dans `C:\Windows\System32\drivers\etc\hosts` (en administrateur) :

```
127.0.0.1  gmao.test
```

2. Copier la configuration Nginx :

```powershell
Copy-Item .\ops\laragon\gmao.test.conf C:\laragon\etc\nginx\sites-enabled\gmao.test.conf
```

3. Générer le certificat HTTPS de `gmao.test` (le certificat joker `*.test` de Laragon est **refusé par Windows** : le nom doit figurer explicitement dans le certificat) :

```powershell
.\ops\laragon\new-certificate.ps1 -HostName gmao.test
```

   Le script crée `C:\GMAO\ssl\gmao.test.crt` et `gmao.test.key`, puis affiche la commande d'import à lancer dans un PowerShell **administrateur** :

```powershell
Import-Certificate -FilePath C:\GMAO\ssl\gmao.test.crt -CertStoreLocation Cert:\LocalMachine\Root
```
4. Tester la syntaxe puis recharger :

```powershell
& C:\laragon\bin\nginx\nginx-1.30.4\nginx.exe -t
```

puis **Menu Laragon → Nginx → Recharger**.

5. Ouvrir `https://gmao.test` : la page d'accueil doit s'afficher, et la connexion fonctionner.

Le fichier `gmao.test.conf` est dans le dépôt pour être versionné : toute adaptation (nom d'hôte, certificat) se fait dans la copie de `sites-enabled`, puis se reporte dans le dépôt.

## 8. Ouvrir l'accès aux autres postes

Un navigateur d'un autre poste doit pouvoir résoudre `gmao.test` et faire confiance au certificat :

- **Nom d'hôte** : un enregistrement DNS interne, ou à défaut une ligne dans le fichier `hosts` de chaque poste, vers l'adresse IP du serveur.
- **Certificat** : `gmao.test.crt` est auto-signé. Il faut l'importer sur chaque poste (magasin « Autorités de certification racines de confiance », commande `Import-Certificate` ci-dessus), ou utiliser le certificat de l'autorité interne de l'entreprise. Il expire à la date affichée par `new-certificate.ps1` (825 jours) : prévoir son renouvellement.
- **Pare-feu** : ouvrir uniquement le port 443 (et 80 pour la redirection) vers le serveur. Les ports 8081 (API) et 3306 restent fermés au réseau.

Pour changer le nom ou l'extension (`gmao.test` est la valeur par défaut de Laragon), cinq éléments sont à mettre à jour, sans toucher au code ni aux données :

| Où | Quoi | Rebuild ou redémarrage |
|---|---|---|
| `hosts` ou DNS interne | Le nouveau nom pointe vers le serveur | Aucun |
| `gmao.test.conf` (Nginx) | `server_name` | Rechargement de Nginx |
| `gmao\.env.laragon` | `DJANGO_ALLOWED_HOSTS` et `FRONTEND_ORIGINS` | Redémarrage de l'API |
| Commande de build | `-ApiUrl https://<nouveau-nom>` | Nouveau build du frontend |
| Certificat HTTPS | Régénéré pour le nouveau nom | Rechargement de Nginx |

Les utilisateurs doivent ensuite utiliser la nouvelle adresse et se reconnecter une fois.

## 9. Démarrage automatique de l'API

Planifier l'API au démarrage de Windows (à exécuter dans PowerShell administrateur) :

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\GMAO\GMAO-Web\ops\laragon\start-api.ps1"'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'GMAO API' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
```

Laragon (MySQL et Nginx) démarre à l'ouverture de session de Windows. Sur un serveur sans session ouverte en permanence, il faut soit une ouverture de session automatique, soit enregistrer `mysqld.exe` et `nginx.exe` comme services ou tâches planifiées au démarrage. Cette partie dépend de la version de Laragon et de la politique du serveur : à valider lors de l'installation.

## 10. Sauvegardes

Remplacent le workflow GitHub « Sauvegarde hebdomadaire ».

```powershell
# Mot de passe du compte gmao_backup, défini une fois pour la machine :
[Environment]::SetEnvironmentVariable('GMAO_BACKUP_DB_PASSWORD', '<mot-de-passe-sauvegarde>', 'Machine')

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\GMAO\GMAO-Web\ops\laragon\backup-mysql.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName 'GMAO sauvegarde' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest
```

- Une archive `gmao-AAAAMMJJTHHMMSS.zip` est créée dans `C:\GMAO\backups` ; celles de plus de 30 jours sont supprimées.
- **Copier ces archives hors du serveur** (partage réseau, disque externe) : une sauvegarde sur le même disque ne protège pas d'une panne du serveur.
- **Tester la restauration** au moins une fois par trimestre sur une base vide : `cmd /c "mysql.exe -u root -p gmao_test < gmao.sql"`.
- L'export JSON de l'administration reste disponible en complément.

## 11. Supervision

Le workflow GitHub « Disponibilité production » interroge l'adresse Render : il doit être désactivé. En remplacement, une tâche planifiée peut appeler `https://gmao.test/health` toutes les 10 minutes et alerter en cas d'échec.

## 12. Mettre à jour l'application

```powershell
cd C:\GMAO\GMAO-Web
git pull origin main
.\ops\laragon\build-frontend.ps1            # interface
Stop-ScheduledTask 'GMAO API'; Start-ScheduledTask 'GMAO API'   # API (migrations automatiques)
```

Avant une mise à jour importante, lancer une sauvegarde manuelle (`ops\laragon\backup-mysql.ps1`) et les tests de l'API :

```powershell
cd gmao
$env:DJANGO_DEBUG='true'; .\.venv-laragon\Scripts\python.exe manage.py test profiles login_guard
```

## 13. Points d'attention connus

- **Adresse IP des connexions** : derrière Nginx, l'API voit `127.0.0.1` pour tous les postes. La limitation des essais de connexion (5 échecs par couple IP / e-mail sur 15 minutes) s'applique donc par adresse e-mail seulement. Un utilisateur qui se trompe cinq fois est temporairement bloqué, comme avant, mais sans distinction du poste d'origine.
- **Plus de contrôle automatique à la publication** : Vercel et Render exécutaient la CI avant de publier. Ici, les tests ne tournent que si vous les lancez (le script de build les exécute par défaut).
- **Un seul serveur** : plus de redondance. Une panne du serveur ou du disque coupe l'application ; d'où l'importance des sauvegardes hors machine.
- **Certificats** : prévoir leur renouvellement et la confiance sur les postes clients.
- **Mises à jour de sécurité** : Windows, Laragon, Python, Node et les dépendances du projet ne se mettent plus à jour automatiquement.

## 14. Retour arrière

Pendant la période de validation, **ne pas supprimer** Render, Vercel et Aiven. Si un problème bloquant apparaît, les utilisateurs reprennent l'ancienne adresse. Les données saisies sur Laragon après la bascule ne reviennent pas toutes seules sur Aiven : décider avant la bascule de la durée de validation et de la façon de les rattraper (nouvel export puis import inverse).

Les services en ligne ne se résilient qu'après la période de validation, une sauvegarde finale d'Aiven archivée et une restauration locale testée.

## 15. Recette de la migration

- [ ] `https://gmao.test/health` répond `UP` depuis le serveur et depuis un autre poste.
- [ ] Connexion d'un Manager, d'un Chef de site et de l'Administrateur.
- [ ] Les volumes de lignes correspondent à ceux d'Aiven.
- [ ] Création d'un équipement, d'un relevé RH et d'un relevé PUE par un Chef de site ; ils apparaissent dans l'historique des modifications.
- [ ] Notifications, export Excel et documentation fonctionnent.
- [ ] Une sauvegarde est créée, copiée hors du serveur et restaurée avec succès sur une base de test.
- [ ] Après un redémarrage de la machine, MySQL, Nginx et l'API redémarrent seuls.
