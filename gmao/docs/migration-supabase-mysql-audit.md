# Audit de migration — Supabase vers Aiven MySQL

Date d'audit : 23 septembre 2026. Cette étape est en lecture seule : aucune donnée de production et aucune configuration ne sont modifiées.

## État actuel

Supabase assure actuellement PostgreSQL, Supabase Auth (identité, mots de passe, sessions JWT) et Realtime. Django sert l’API métier ; Angular se connecte avec Supabase et transmet le jeton à Django. Le stockage de fichiers Supabase n’est pas utilisé : les exports Excel sont générés dans le navigateur.

## Périmètre de sauvegarde

| Domaine | Tables Supabase |
| --- | --- |
| Identité | `auth.users`, `public.user_profiles` |
| Référentiel | `public.sites` |
| Équipements et tickets | `gmao_equipements`, `gmao_tickets` |
| Groupes électrogènes | `gmao_groupes_electrogenes`, `gmao_releves_rh_ge` |
| PUE | `gmao_pue` |
| Fuel | `gmao_fuel_ge`, `gmao_fuel_ravitaillements`, `gmao_consommations_groupes_ge`, `gmao_fuel_monthly_summary` |
| Autres opérations | `gmao_problemes_datacenter`, `gmao_interventions`, `gmao_pieces_rechange` |
| Notifications | `gmao_notifications` |

`gmao/scripts/export_supabase_backup.py` écrit un CSV UTF-8 par table et un `manifest.json` avec le nombre de lignes, la structure et une empreinte SHA-256. Les sauvegardes vont dans `gmao/backups/`, ignoré par Git.

## Dépendances à remplacer

| Élément | Usage actuel | Cible |
| --- | --- | --- |
| Base | PostgreSQL Supabase, modèles Django non gérés | Aiven MySQL, migrations Django et modèles gérés |
| Auth | `@supabase/supabase-js`, JWT, API Auth Supabase | Auth Django, jetons signés ou cookies HttpOnly, réinitialisation des mots de passe |
| Comptes | API admin Supabase + clé de service | Administration Django/MySQL |
| Realtime | canal `gmao-ge-realtime` pour les groupes électrogènes | actualisation API périodique ; WebSocket Django seulement si nécessaire |
| RLS | politiques PostgreSQL Supabase | contrôles Django, tests d’autorisation et contraintes MySQL |

## Rôles relevés

- `manager` et `charge_operations` : lecture globale, modification et suppression ; tableau de bord et profils.
- `chef_site` : périmètre de son seul site.
- L’interface masque la saisie aux rôles globaux, mais l’API Django autorise encore la création à tous les rôles. La migration doit corriger cette règle côté serveur.
- Les notifications persistantes visent les rôles globaux. Les notifications navigateur sont locales et indépendantes de Realtime.

## Contrôle avant bascule

1. Lancer l’export avec le mot de passe PostgreSQL Supabase disponible localement, sans l’afficher ni le committer.
2. Vérifier dans le manifeste qu’il n’y a aucun échec, que toutes les tables sont présentes et que chaque empreinte SHA-256 est calculée.
3. Comparer les nombres de lignes exportés avec ceux lus directement dans Supabase, dans la même transaction.
4. Conserver la sauvegarde hors Git et hors du répertoire publié.
5. Ne créer la base Aiven/MySQL qu’après validation de ce manifeste.

## Étape 2 validée — Aiven MySQL

- Service : `gmao-ordc-mysql`, MySQL 8.4.8, plan Free, état Running.
- Base initiale : `defaultdb` ; accès chiffré TLS obligatoire.
- Connexion de lecture validée le 23 septembre 2026 avec vérification stricte du certificat d’autorité Aiven.
- Le mot de passe et le certificat sont uniquement stockés dans `gmao/.env` et `gmao/.runtime/` : ces emplacements sont ignorés par Git.
- Aucun schéma, aucune donnée et aucune configuration de production n’ont encore été basculés vers Aiven.
