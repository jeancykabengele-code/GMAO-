# Backend Django — GMAO

Ce backend assure l’authentification locale Django, applique les permissions métier et utilise Aiven MySQL en production.

## Installation locale

```powershell
cd C:\Users\JK\Projects\GMAO-Web\gmao
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\start-django.ps1
```

Le serveur écoute sur `http://localhost:8080`. Sans variables Aiven, le développement local utilise SQLite.

`DJANGO_DEBUG` vaut `false` si la variable est absente. Le lanceur local `start-django.ps1` active explicitement le debug ; le lanceur en arrière-plan utilise ce même script. Ne pas utiliser ces lanceurs pour la production. Django ne charge pas automatiquement les fichiers `.env` : pour lancer directement `manage.py` en développement, définir `$env:DJANGO_DEBUG = 'true'` dans le terminal local. En production, conserver `DJANGO_DEBUG=false` et fournir une véritable `DJANGO_SECRET_KEY` ; la clé de développement est refusée. La CI utilise le mode sans debug et une clé réservée aux tests.

- Santé : `GET /health`
- Base : `GET /health/database` avec `Authorization: Bearer <GMAO_HEALTH_TOKEN>` (secret de supervision distinct des sessions, refus HTTP 401 s'il est absent ou incorrect). La sonde vérifie uniquement la connexion ; aucun volume de table ni détail SQL n'est exposé. Voir [la procédure de configuration et de vérification](../DEPLOIEMENT.md#render--api-django).
- Profil connecté : `GET /api/me` avec `Authorization: Bearer <jeton_de_session_django>`

Les connexions sont limitées à 5 tentatives par IP/e-mail et 50 par IP sur 15 minutes, avec attente progressive. HTTP 429 indique le délai à respecter. Les compteurs sont partagés dans la table `gmao_login_buckets`. Pour un démarrage manuel, exécuter `python manage.py migrate --noinput`, puis `python manage.py verify_business_schema` avant le serveur ; les lanceurs locaux et Docker le font automatiquement. Voir [la procédure de déploiement et de vérification](../DEPLOIEMENT.md#protection-des-connexions) et [la gestion des migrations métier](../docs/migrations-metier.md).
