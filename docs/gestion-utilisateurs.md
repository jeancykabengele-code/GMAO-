# Gestion des utilisateurs et séparation des responsabilités

La permission serveur `manageUsers` est accordée uniquement au rôle `manager`.

- Le Manager peut consulter, créer, modifier, désactiver et supprimer les profils, sous réserve des protections métier existantes.
- Le Chargé des opérations conserve son périmètre métier global, la gestion des sites, les exports et la modification des fiches, mais n’accède plus à la gestion des comptes.
- Le Chef de site reste limité à son site et n’accède à aucune administration des utilisateurs.

Le lien **Gestion des utilisateurs** est masqué lorsque `manageUsers=false` et une garde Angular redirige toute navigation directe. Ces contrôles améliorent l’interface mais ne constituent pas la sécurité principale : toutes les routes `/api/profiles` vérifient à nouveau le rôle Manager dans Django et répondent HTTP 403 aux autres rôles.

Avant de réinitialiser le mot de passe d’un autre profil, le Manager doit saisir son propre mot de passe actuel. Django le vérifie contre le hachage local avant d’enregistrer le nouveau mot de passe de la cible. Cette valeur n’est ni conservée dans le navigateur, ni journalisée, ni incluse dans une URL.
