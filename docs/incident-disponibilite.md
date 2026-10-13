# Disponibilité et procédure d'incident

## Supervision

La tâche planifiée `GMAO santé` (`ops/laragon/check-health.ps1`) contrôle toutes les dix minutes :

- l'interface (`https://gmao.test/`), son code HTTP ;
- l'API via `/health` ;
- MySQL via `/health/database`, avec le secret `GMAO_HEALTH_TOKEN` du fichier `.env.laragon`.

Chaque exécution ajoute une ligne à `C:\GMAO\health.log` (`OK` ou `ECHEC` avec le détail). Une exécution en échec retourne le code 1 : elle apparaît comme tâche en erreur dans le Planificateur de tâches. Le script n'écrit jamais le jeton dans le journal.

Une seule machine héberge l'application : pour un engagement de disponibilité, doubler cette sonde par un contrôle externe au serveur (autre poste ou outil de supervision de l'entreprise).

## Seuils et niveaux

| Niveau | Déclencheur | Première action attendue |
|---|---|---|
| SEV1 | Interface ou API indisponible pendant deux contrôles, perte ou corruption possible de données | Prise en charge sous 15 minutes, gel des mises à jour et information des responsables |
| SEV2 | MySQL indisponible, réponse API supérieure à 10 s ou réponse MySQL supérieure à 5 s | Prise en charge sous 30 minutes et diagnostic Laragon / MySQL |
| SEV3 | Échec isolé revenu au vert au contrôle suivant | Documenter, surveiller et rechercher une répétition |

## Procédure

1. Consulter `C:\GMAO\health.log` : cible en défaut, heure, code HTTP et durée.
2. Tester `https://gmao.test/health`. Pas de réponse : vérifier que Laragon est ouvert, que Nginx est démarré (ports 80 et 443) et que la session Windows est ouverte.
3. Réponse `502` de Nginx : l'API est arrêtée. Redémarrer la tâche `GMAO API` (`Stop-ScheduledTask` puis `Start-ScheduledTask`).
4. Tester `/health/database` avec le jeton. `401` indique une erreur de jeton ; `503` indique que Django répond mais que MySQL ne répond pas : vérifier MySQL dans Laragon et `C:\laragon\data\mysql-8.4\mysqld.log`.
5. Journaux utiles : `C:\laragon\bin\nginx\nginx-1.30.4\logs\error.log` (Nginx), `C:\laragon\data\mysql-8.4\mysqld.log` (MySQL), Planificateur de tâches > Historique (API).
6. En cas de régression applicative, revenir au commit précédent (`git checkout <commit>`), reconstruire l'interface (`ops/laragon/build-frontend.ps1`) et redémarrer l'API. Ne pas restaurer ou importer une base sans sauvegarde vérifiée et décision du responsable des données.
7. Après rétablissement, relancer `check-health.ps1`, vérifier les trois sondes, consigner la cause, la durée, l'impact, les actions et le suivi préventif.

## Reprise après panne de la machine

1. Redémarrer Windows et ouvrir la session du compte d'exploitation : Laragon démarre MySQL et Nginx, puis la tâche `GMAO API` démarre l'API dès que MySQL répond.
2. En cas de perte de la base, restaurer la dernière archive `C:\GMAO\backups\gmao-*.zip` (ou sa copie hors machine) dans une base vide, puis démarrer l'API pour appliquer les migrations manquantes.

## Points d'attention avant une exploitation critique

- **Un seul serveur** : aucune redondance. Prévoir un onduleur, des mises à jour de Windows planifiées et un second serveur de reprise si l'engagement de disponibilité l'exige.
- **Sauvegardes hors machine** : activer `-CopyTo` (autre disque, disque externe ou partage réseau) et tester la restauration régulièrement.
- **Certificat** : prévoir son renouvellement avant la date d'expiration affichée par `new-certificate.ps1`.
