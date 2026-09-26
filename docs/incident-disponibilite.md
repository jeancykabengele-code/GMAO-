# Disponibilité de production et procédure d’incident

## Supervision

Le workflow GitHub Actions **Disponibilité production** contrôle toutes les dix minutes :

- le frontend Vercel, son code HTTP et la présence de la CSP attendue ;
- l’API Render via `/health`, avec un seuil de réponse de 10 secondes ;
- Aiven MySQL via `/health/database`, avec un seuil de 5 secondes, lorsque le secret Actions `GMAO_HEALTH_TOKEN` est configuré.

Une exécution rouge constitue une alerte. Activer les notifications GitHub Actions par e-mail pour les responsables d’exploitation. Le moniteur n’envoie jamais le jeton dans ses résultats et ne journalise ni réponse SQL ni donnée métier.

Pour activer la sonde Aiven, créer dans **GitHub > Settings > Secrets and variables > Actions** un secret `GMAO_HEALTH_TOKEN` ayant exactement la même valeur que le secret Render. Ne jamais copier cette valeur dans le dépôt. Une exécution manuelle doit ensuite afficher trois contrôles verts.

Le workflow GitHub est une surveillance externe simple. Pour une exploitation contractuelle, dupliquer ces sondes dans un service de supervision indépendant disposant d’astreinte, d’escalade et d’un historique de SLA.

## Seuils et niveaux

| Niveau | Déclencheur | Première action attendue |
|---|---|---|
| SEV1 | Frontend ou API indisponible pendant deux contrôles, perte ou corruption possible de données | Prise en charge sous 15 minutes, gel des déploiements et information du responsable métier |
| SEV2 | MySQL indisponible, réponse API supérieure à 10 s ou réponse MySQL supérieure à 5 s | Prise en charge sous 30 minutes et diagnostic Render/Aiven |
| SEV3 | Échec isolé revenu au vert au contrôle suivant | Documenter, surveiller et rechercher une répétition |

## Procédure

1. Consulter l’exécution **Disponibilité production** et noter la cible, l’heure UTC, le code HTTP et la durée.
2. Tester `https://gmao-ordc-api.onrender.com/health`. Une attente proche d’une minute sur un plan Free indique généralement un réveil Render.
3. Tester `/health/database` avec le jeton de supervision. `401` indique une configuration du jeton ; `503` indique que Django répond mais que MySQL ne répond pas.
4. Consulter les événements et journaux du dernier déploiement Render, puis l’état, les métriques, les journaux et les notifications du service Aiven.
5. En cas de régression applicative, restaurer sur Render le dernier déploiement vert. Ne pas restaurer ou importer une base sans sauvegarde vérifiée et décision du responsable des données.
6. Après rétablissement, lancer manuellement le workflow, vérifier les trois sondes, consigner la cause, la durée, l’impact, les actions et le suivi préventif.

## Plans requis avant remise en exploitation critique

Au 26 septembre 2026, le plan Render Free met un service en veille après 15 minutes sans trafic et son réveil prend environ une minute. Le premier plan de calcul payant `0.5c-512mb` coûte 7 USD/mois et ne se met pas en veille. Le changement concerne le calcul du service, pas seulement le plan du workspace Render.

Aiven Free peut être arrêté après une absence d’activité continue et n’est couvert par aucun SLA. Les options actuelles sont notamment Developer à 5 USD/mois, Startup à partir de 75 USD/mois avec SLA 99,99 %, et Business à partir de 180 USD/mois avec un nœud de secours.

Le minimum technique sans offre gratuite est donc Render `0.5c-512mb` + Aiven Developer, environ 12 USD/mois. Pour une application d’entreprise nécessitant un engagement de disponibilité, retenir au minimum Render payant + Aiven Startup, environ 82 USD/mois. Aiven Business est nécessaire si la base doit disposer d’un nœud de secours.

Sources officielles : [limitations Render Free](https://render.com/docs/free), [plans de calcul Render](https://render.com/docs/compute-plans), [tarification Render](https://render.com/pricing), [limitations Aiven Free](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier), [tarification Aiven MySQL](https://aiven.io/pricing/mysql) et [haute disponibilité Aiven](https://aiven.io/docs/products/mysql/concepts/high-availability).
