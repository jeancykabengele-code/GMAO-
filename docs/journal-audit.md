# Journal d’audit métier

L'Administrateur consulte le journal dans **Administration → Journal d’audit**. Le Manager et le Chargé des opérations conservent leurs droits métier, sans accès à ce journal ni à son API `GET /api/audit-logs` après la création du premier Administrateur.

La migration `login_guard.0003_auditlog` crée la table MySQL `audit_log`. Chaque entrée contient l’acteur, l’action, la cible, la date UTC, l’adresse IP obtenue depuis la source réseau de confiance, le résultat et uniquement les anciennes ou nouvelles valeurs utiles. Les mots de passe, jetons, secrets, autorisations et identifiants de connexion techniques sont refusés avant écriture.

Le modèle Django interdit `save()`, `update()` et `delete()` sur une entrée existante. Des déclencheurs MySQL et SQLite refusent aussi tout `UPDATE` ou `DELETE` exécuté directement en SQL. L’interface expose seulement une lecture paginée et filtrable, limitée à 100 événements par requête.

Événements couverts : connexions réussies, refusées ou bloquées, changements et réinitialisations de mot de passe, création/modification/suppression de comptes, suppressions de sites et suppressions de fiches métier.

## Historique RH

L’Administrateur consulte les modifications des relevés RH dans **Administration → Historique RH** (`GET /api/rh-history`), une feuille distincte du journal d’audit. La saisie (`rh_reading_create`), la correction (`rh_reading_update`, ancien et nouveau compteur) et la suppression d’un relevé (`record_delete` sur `releves-rh-ge`, avec l’ancien compteur) y apparaissent avec la date, l’auteur, le site, le groupe et le mois, et se filtrent par site, groupe et période. Les événements restent stockés dans la table append-only `audit_log`, mais le journal d’audit n’affiche plus les saisies et corrections de relevés RH. Seules les modifications faites après la mise en service de cet historique sont disponibles.
