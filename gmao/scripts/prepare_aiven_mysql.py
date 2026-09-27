"""Import a verified backup into a schema created by Django migrations."""
from __future__ import annotations
import argparse, csv, json, os, ssl, uuid
from datetime import datetime
from pathlib import Path
import pymysql

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_TABLES = ("user_profiles","sites","gmao_equipements","gmao_tickets","gmao_groupes_electrogenes","gmao_releves_rh_ge","gmao_fuel_ge","gmao_fuel_ravitaillements","gmao_consommations_groupes_ge","gmao_fuel_monthly_summary","gmao_pue","gmao_problemes_datacenter","gmao_interventions","gmao_pieces_rechange","gmao_notifications")
UUID_COLUMNS = {"id","created_by","updated_by","recipient_id","actor_id","resource_id","instance_id"}

def load_env():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1); os.environ.setdefault(key.strip(), value.strip())

def connect():
    load_env(); ca = ROOT / os.environ["AIVEN_MYSQL_CA_PATH"]
    return pymysql.connect(host=os.environ["AIVEN_MYSQL_HOST"], port=int(os.environ["AIVEN_MYSQL_PORT"]), user=os.environ["AIVEN_MYSQL_USER"], password=os.environ["AIVEN_MYSQL_PASSWORD"], database=os.environ["AIVEN_MYSQL_DATABASE"], ssl=ssl.create_default_context(cafile=str(ca)), charset="utf8mb4", autocommit=False)

def target_columns(source):
    return source["columns"]

def import_sources(manifest):
    return [source for source in manifest["tables"] if source["schema"] != "auth" and source["table"] in PUBLIC_TABLES]

def require_versioned_schema(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()")
        existing = {row[0] for row in cursor.fetchall()}
        required = set(PUBLIC_TABLES) | {"gmao_local_credentials", "django_migrations"}
        missing = sorted(required - existing)
        if missing:
            raise RuntimeError("Exécuter `python manage.py migrate` avant l’import. Tables absentes: " + ", ".join(missing))
        cursor.execute("SELECT 1 FROM django_migrations WHERE app='profiles' AND name='0002_adopt_business_schema'")
        if cursor.fetchone() is None:
            raise RuntimeError("La migration profiles.0002_adopt_business_schema doit être appliquée avant l’import.")

def value(raw, column):
    if raw == "": return None if column["is_nullable"] == "YES" else ""
    name, kind = column["column_name"], column["data_type"]
    if name in UUID_COLUMNS: return uuid.UUID(raw).hex
    if kind == "boolean": return 1 if raw.lower() in {"t","true","1"} else 0
    if kind.startswith("timestamp"):
        return datetime.fromisoformat(raw.replace("Z","+00:00")).replace(tzinfo=None)
    return raw

def import_data(connection, backup, manifest):
    report = {"backup": backup.name, "tables": []}
    with connection.cursor() as cursor:
        for source in import_sources(manifest):
            target = source["table"]
            cursor.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s", [target])
            available = {row[0] for row in cursor.fetchall()}
            columns = [column for column in target_columns(source) if column["column_name"] in available]
            names = [c["column_name"] for c in columns]
            cursor.execute(f"SELECT COUNT(*) FROM `{target}`"); existing = cursor.fetchone()[0]
            if existing: raise RuntimeError(f"{target} contient déjà {existing} lignes : import interrompu.")
            with (backup / source["file"]).open(encoding="utf-8", newline="") as handle:
                rows = [[value(row[name], column) for column, name in zip(columns, names)] for row in csv.DictReader(handle)]
            if rows:
                placeholders = ",".join(["%s"] * len(names)); fields = ",".join(f"`{name}`" for name in names)
                cursor.executemany(f"INSERT INTO `{target}` ({fields}) VALUES ({placeholders})", rows)
            cursor.execute(f"SELECT COUNT(*) FROM `{target}`"); actual = cursor.fetchone()[0]
            if actual != source["rows"]: raise RuntimeError(f"{target}: {actual} lignes au lieu de {source['rows']}")
            report["tables"].append({"source":f"{source['schema']}.{source['table']}","target":target,"rows":actual})
    connection.commit(); return report

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--backup", type=Path); parser.add_argument("--schema-only", action="store_true"); args = parser.parse_args()
    backup = args.backup or max((ROOT / "backups").iterdir(), key=lambda item: item.name)
    manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
    if manifest["failures"]: raise RuntimeError("La sauvegarde source est incomplète.")
    with connect() as connection:
        require_versioned_schema(connection)
        if args.schema_only:
            print("Schéma Aiven versionné et prêt."); return
        report = import_data(connection, backup, manifest)
    output = ROOT / ".runtime" / "aiven-import-report.json"; output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Import Aiven valide : {len(report['tables'])} tables, rapport {output}")
if __name__ == "__main__": main()
