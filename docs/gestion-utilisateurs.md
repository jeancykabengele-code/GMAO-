# Gestion des utilisateurs et séparation des responsabilités

La permission serveur `manageUsers` est accordée au rôle `administrator`.

- L'Administrateur peut consulter, créer, modifier, désactiver et supprimer les profils, gérer les sites et consulter le journal d'audit, sous réserve des protections existantes.
- Le Manager et le Chargé des opérations conservent leur périmètre métier global, les exports et la modification des fiches, sans accès à la feuille Administration.
- Le Chef de site reste limité à son site et n’accède à aucune administration des utilisateurs.
- L'Administrateur n'accède pas aux feuilles ni aux données métier.

Pour amorcer la transition, le Manager conserve `manageUsers=true` uniquement tant qu'aucun Administrateur actif n'existe. Il crée le premier compte Administrateur depuis l'interface ; dès cette création, Django retire automatiquement l'accès administratif au Manager. Le dernier Administrateur actif ne peut ni se désactiver ni changer de rôle.

Le lien **Administration** est masqué lorsque `manageUsers=false` et une garde Angular redirige toute navigation directe. Ces contrôles améliorent l’interface mais ne constituent pas la sécurité principale : les routes `/api/profiles`, les écritures `/api/sites` et `GET /api/audit-logs` vérifient à nouveau la permission dans Django et répondent HTTP 403 aux autres rôles.

Avant de réinitialiser le mot de passe d’un autre profil, l'Administrateur doit saisir son propre mot de passe actuel. Django le vérifie contre le hachage local avant d’enregistrer le nouveau mot de passe de la cible. Cette valeur n’est ni conservée dans le navigateur, ni journalisée, ni incluse dans une URL.
