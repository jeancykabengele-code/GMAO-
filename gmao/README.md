# Backend Django — GMAO ORDC

Ce backend Django valide les sessions Supabase Auth et lit les profils dans la table PostgreSQL `public.user_profiles`.

## Installation locale

```powershell
cd C:\Users\JK\Projects\GMAO-Web\gmao
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\start-django.ps1
```

Le serveur écoute sur `http://localhost:8080`.

- Santé : `GET /health`
- Profil connecté : `GET /api/me` avec `Authorization: Bearer <access_token>`

Le mot de passe PostgreSQL n'est jamais enregistré dans le dépôt.

