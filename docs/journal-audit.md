# Journal d’audit métier

Le Manager consulte le journal dans **Administration → Journal d’audit**. Le Chargé des opérations conserve la gestion des sites et ses droits métier, sans accès à ce journal ni à son API `GET /api/audit-logs`.

La migration `login_guard.0003_auditlog` crée la table MySQL `audit_log`. Chaque entrée contient l’acteur, l’action, la cible, la date UTC, l’adresse IP obtenue depuis la source réseau de confiance, le résultat et uniquement les anciennes ou nouvelles valeurs utiles. Les mots de passe, jetons, secrets, autorisations et identifiants de connexion techniques sont refusés avant écriture.

Le modèle Django interdit `save()`, `update()` et `delete()` sur une entrée existante. Des déclencheurs MySQL et SQLite refusent aussi tout `UPDATE` ou `DELETE` exécuté directement en SQL. L’interface expose seulement une lecture paginée et filtrable, limitée à 100 événements par requête.

Événements couverts : connexions réussies, refusées ou bloquées, changements et réinitialisations de mot de passe, création/modification/suppression de comptes, suppressions de sites et suppressions de fiches métier.
