# Migrations versionnées des tables métier

Les 16 modèles de l'application `profiles` sont gérés par Django. Leur schéma est désormais suivi dans le dépôt et chaque évolution future doit être produite avec `python manage.py makemigrations`, relue, testée sur MySQL 8.4 puis appliquée avec `python manage.py migrate --noinput`.

## Adoption du schéma existant

La migration `profiles.0001_business_schema_state` enregistre l'état initial dans Django sans exécuter de `CREATE TABLE`. La migration `profiles.0002_adopt_business_schema` traite ensuite chaque table :

- si elle existe, la migration vérifie ses colonnes attendues, sa clé primaire et ses contraintes uniques avant toute écriture de schéma ;
- si elle manque, Django la crée à partir du modèle versionné ;
- les colonnes historiques supplémentaires sont conservées ;
- aucune ligne métier n'est lue, modifiée ou supprimée pendant l'adoption.

Ce contrôle accepte les types historiques compatibles et les colonnes supplémentaires d'Aiven. Il bloque en revanche le démarrage si une colonne obligatoire, une clé primaire ou une contrainte unique attendue manque.

Le conteneur exécute successivement :

```text
python manage.py migrate --noinput
python manage.py verify_business_schema
python manage.py purge_login_buckets
gunicorn ...
```

L'API n'est donc publiée que si les migrations et le contrôle des 16 tables aboutissent.

## Import d'une sauvegarde

`scripts/prepare_aiven_mysql.py` ne crée plus les tables. Il exige que `profiles.0002_adopt_business_schema` soit déjà enregistrée et importe uniquement les colonnes présentes dans le schéma versionné. L'ordre correct est :

1. configurer une base vide ou une base contenant les tables à adopter ;
2. exécuter `python manage.py migrate --noinput` ;
3. exécuter `python manage.py verify_business_schema` ;
4. lancer l'import si nécessaire.

## Retour arrière

Les migrations initiales ont un rollback non destructif : `python manage.py migrate profiles zero` retire leur état de l'historique Django mais conserve les tables et les données. Une nouvelle exécution de `python manage.py migrate --noinput` les adopte de nouveau après validation.

Pour revenir au code antérieur en production, redéployer le commit précédent. Les tables métier restent en place et ce code continue de les utiliser. Chaque future migration qui transforme des colonnes ou des données devra documenter et tester sa propre procédure inverse ; la garantie non destructive décrite ici concerne la migration initiale d'adoption.

La CI utilise MySQL 8.4 pour tester le cycle complet : création ou adoption, contrôle du schéma, insertion d'une ligne témoin, rollback vers zéro, vérification de la conservation de cette ligne, puis réadoption.
