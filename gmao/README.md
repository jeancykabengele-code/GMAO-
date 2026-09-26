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

- Santé : `GET /health`
- Base : `GET /health/database` avec `Authorization: Bearer <GMAO_HEALTH_TOKEN>` (secret de supervision distinct des sessions, refus HTTP 401 s'il est absent ou incorrect). La sonde vérifie uniquement la connexion ; aucun volume de table ni détail SQL n'est exposé. Voir [la procédure de configuration et de vérification](../DEPLOIEMENT.md#render--api-django).
- Profil connecté : `GET /api/me` avec `Authorization: Bearer <jeton_de_session_django>`
