# Journal d’audit métier

L'Administrateur consulte le journal dans **Administration → Journal d’audit**. Le Manager et le Chargé des opérations conservent leurs droits métier, sans accès à ce journal ni à son API `GET /api/audit-logs` après la création du premier Administrateur.

La migration `login_guard.0003_auditlog` crée la table MySQL `audit_log`. Chaque entrée contient l’acteur, l’action, la cible, la date UTC, l’adresse IP obtenue depuis la source réseau de confiance, le résultat et uniquement les anciennes ou nouvelles valeurs utiles. Les mots de passe, jetons, secrets, autorisations et identifiants de connexion techniques sont refusés avant écriture.

Le modèle Django interdit `save()`, `update()` et `delete()` sur une entrée existante. Des déclencheurs MySQL et SQLite refusent aussi tout `UPDATE` ou `DELETE` exécuté directement en SQL. L’interface expose seulement une lecture paginée et filtrable, limitée à 100 événements par requête.

Événements couverts : connexions réussies, refusées ou bloquées, changements et réinitialisations de mot de passe, création/modification/suppression de comptes, suppressions de sites et suppressions de fiches métier.

## Historique des modifications

L’Administrateur consulte les modifications de toutes les fiches métier dans **Administration → Historique des modifications** (`GET /api/change-history`), une feuille distincte du journal d’audit : relevés RH, groupes électrogènes, Fuel-GE, ravitaillements, consommation par GE, PUE, équipements, tickets, interventions, pièces de rechange et problèmes Data Center.

Chaque création (`record_create`), modification (`record_update`, ancienne et nouvelle valeur de chaque champ) et suppression (`record_delete`, avec les valeurs supprimées) est conservée avec l’auteur, la date, le site et une référence de la fiche (code, numéro, groupe, mois…). Une sauvegarde qui ne change aucune valeur n’est pas enregistrée. La feuille se filtre par type de fiche, site, groupe GE et période.

Les événements restent stockés dans la table append-only `audit_log`, mais le journal d’audit n’affiche ni les créations ni les modifications de fiches (les suppressions y restent). Les valeurs recalculées automatiquement sur d’autres fiches (par exemple le stock final d’un mois suivant) ne sont pas enregistrées séparément : seule l’action de l’utilisateur l’est, avec les valeurs de la fiche après recalcul. Les textes de plus de 500 caractères sont tronqués. Seules les modifications faites après la mise en service de cet historique sont disponibles.
