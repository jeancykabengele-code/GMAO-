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
## Étape 3 validée — Schéma et import à blanc

- Les 16 jeux de données ont été importés dans Aiven MySQL depuis la sauvegarde vérifiée : 303 lignes au total.
- Chaque table cible a le même nombre de lignes que son CSV source. Django lit correctement MySQL en TLS strict (`manage.py check` sans erreur).
- Les données d'identité nécessaires à la liaison (`id`, e-mail et dates) sont conservées dans `gmao_legacy_auth_users` ; les mots de passe chiffrés, jetons et sessions Supabase ne sont volontairement pas réutilisés. La phase d'authentification créera un parcours de réinitialisation de mot de passe.
- Supabase et la production actuelle restent actifs et inchangés ; Aiven est encore une copie de préparation.
## Étape 4 préparée — Authentification Django/MySQL

- Le fournisseur actif reste `supabase`. Le fournisseur `django` est activable uniquement par la variable `GMAO_AUTH_PROVIDER=django` sur le backend et `authProvider: 'django'` dans le frontend construit pour la bascule.
- Les mots de passe temporaires sont hachés avec le mécanisme de Django dans `gmao_local_credentials`. Ils ne sont jamais retournés par une API, stockés dans Git ni importés depuis Supabase.
- Un mot de passe temporaire doit contenir au moins 12 caractères et doit être remplacé par son titulaire lors de sa première connexion.
- La commande `manage.py set_temporary_password <email>` demande le mot de passe de façon masquée. Elle sera utilisée d'abord pour le Manager de bascule, puis le Manager attribuera les mots de passe temporaires des autres comptes.
- La restriction de saisie est contrôlée par le serveur : seuls les Chefs de site peuvent créer des fiches.