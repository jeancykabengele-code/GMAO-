# Politique des mots de passe locaux

La même politique est appliquée par l’API lors de la création d’un compte, d’un changement volontaire, d’une réinitialisation administrative et de la commande `reset_gmao_password`.

- longueur minimale : 14 caractères ;
- refus des mots de passe courants et entièrement numériques avec les validateurs Django ;
- refus d’un mot de passe présent dans une fuite connue via Pwned Passwords ;
- refus du mot de passe actuel et des cinq mots de passe précédents.

Le contrôle Pwned Passwords calcule SHA-1 localement uniquement pour le protocole de recherche par plage. Il transmet les cinq premiers caractères du hachage, jamais le mot de passe ni son hachage complet, et demande une réponse rembourrée avec `Add-Padding`. Si le service est indisponible en production, la modification est refusée temporairement avec HTTP 503 afin de ne pas accepter un mot de passe non contrôlé.

Les anciens hachages sont stockés dans `gmao_password_history`. Ils ne permettent pas de retrouver le mot de passe et sont supprimés au-delà des cinq dernières valeurs. Les comptes existants continuent à se connecter avec leur mot de passe actuel ; la nouvelle politique s’applique au prochain changement ou à la prochaine réinitialisation.

`GMAO_PWNED_PASSWORD_CHECK=true` est explicite sur un serveur connecté à Internet ; un serveur isolé le désactive (`false`) et s'appuie sur les autres règles. Le développement local peut conserver `false` pour fonctionner hors ligne. Ne pas désactiver ce contrôle en production pour contourner une panne : diagnostiquer la sortie HTTPS vers `api.pwnedpasswords.com` et réessayer.

Référence : [API officielle Pwned Passwords](https://haveibeenpwned.com/API/v3#PwnedPasswords).

## Mot de passe temporaire imposé

Quand l'Administrateur crée un compte ou réinitialise le mot de passe d'un profil existant, il choisit lui-même la valeur initiale et la communique au titulaire du compte : ce mot de passe est marqué comme temporaire (`must_change_password=true` sur `LocalCredential`). Tant qu'il n'a pas été remplacé, Django refuse HTTP 403 (`password_change_required`) toute route API autre que `/api/me`, `/api/auth/local/change-password` et `/api/auth/local/logout` — l'interface ne montre d'ailleurs que le formulaire « Choisissez votre mot de passe » tant que ce changement n'est pas fait. Un changement volontaire (l'utilisateur connaît déjà son mot de passe actuel) ne redemande jamais un nouveau changement par la suite. La commande `reset_gmao_password` (accès serveur direct) définit en revanche un mot de passe durable, sans ce marquage.
