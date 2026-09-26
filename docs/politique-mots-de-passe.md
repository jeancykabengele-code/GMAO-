# Politique des mots de passe locaux

La même politique est appliquée par l’API lors de la création d’un compte, d’un changement volontaire, d’une réinitialisation administrative et de la commande `reset_gmao_password`.

- longueur minimale : 14 caractères ;
- refus des mots de passe courants et entièrement numériques avec les validateurs Django ;
- refus d’un mot de passe présent dans une fuite connue via Pwned Passwords ;
- refus du mot de passe actuel et des cinq mots de passe précédents.

Le contrôle Pwned Passwords calcule SHA-1 localement uniquement pour le protocole de recherche par plage. Il transmet les cinq premiers caractères du hachage, jamais le mot de passe ni son hachage complet, et demande une réponse rembourrée avec `Add-Padding`. Si le service est indisponible en production, la modification est refusée temporairement avec HTTP 503 afin de ne pas accepter un mot de passe non contrôlé.

Les anciens hachages sont stockés dans `gmao_password_history`. Ils ne permettent pas de retrouver le mot de passe et sont supprimés au-delà des cinq dernières valeurs. Les comptes existants continuent à se connecter avec leur mot de passe actuel ; la nouvelle politique s’applique au prochain changement ou à la prochaine réinitialisation.

`GMAO_PWNED_PASSWORD_CHECK=true` est explicite sur Render. Le développement local peut conserver `false` pour fonctionner hors ligne. Ne pas désactiver ce contrôle en production pour contourner une panne : diagnostiquer la sortie HTTPS vers `api.pwnedpasswords.com` et réessayer.

Référence : [API officielle Pwned Passwords](https://haveibeenpwned.com/API/v3#PwnedPasswords).
