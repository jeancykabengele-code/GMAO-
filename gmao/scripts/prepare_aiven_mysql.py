"""Create the Aiven MySQL schema and run a reversible import from a verified backup."""
from __future__ import annotations
import argparse, csv, json, os, ssl, uuid
from datetime import datetime
from pathlib import Path
import pymysql

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_TABLES = ("user_profiles","sites","gmao_equipements","gmao_tickets","gmao_groupes_electrogenes","gmao_releves_rh_ge","gmao_fuel_ge","gmao_fuel_ravitaillements","gmao_consommations_groupes_ge","gmao_fuel_monthly_summary","gmao_pue","gmao_problemes_datacenter","gmao_interventions","gmao_pieces_rechange","gmao_notifications")
PRIMARY_KEYS = {"user_profiles":"id","sites":"name", **{name:"id" for name in PUBLIC_TABLES if name not in {"user_profiles","sites"}}}
UNIQUE_KEYS = {"gmao_equipements":("site","code"),"gmao_tickets":("site","numero"),"gmao_releves_rh_ge":("site","periode","groupe_code"),"gmao_fuel_ge":("site","periode"),"gmao_consommations_groupes_ge":("site","periode","groupe_code"),"gmao_pue":("site","mois"),"gmao_notifications":("recipient_id","dedupe_key")}
UUID_COLUMNS = {"id","created_by","updated_by","recipient_id","actor_id","resource_id","instance_id"}
TEXT_AS_VARCHAR = {"site","code","numero","periode","mois","groupe_code","email","role","event_type","resource","severity","dedupe_key"}
INDEXED_TEXT = {"site","code","numero","periode","mois","groupe_code","dedupe_key"}

def load_env():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1); os.environ.setdefault(key.strip(), value.strip())

def connect():
    load_env(); ca = ROOT / os.environ["AIVEN_MYSQL_CA_PATH"]
    return pymysql.connect(host=os.environ["AIVEN_MYSQL_HOST"], port=int(os.environ["AIVEN_MYSQL_PORT"]), user=os.environ["AIVEN_MYSQL_USER"], password=os.environ["AIVEN_MYSQL_PASSWORD"], database=os.environ["AIVEN_MYSQL_DATABASE"], ssl=ssl.create_default_context(cafile=str(ca)), charset="utf8mb4", autocommit=False)

def mysql_type(column):
    name, source_type = column["column_name"], column["data_type"]
    if name in UUID_COLUMNS: return "CHAR(32)"
    if name == "name" and column.get("table") == "sites": return "VARCHAR(255)"
    if name in INDEXED_TEXT: return "VARCHAR(191)"
    if name in TEXT_AS_VARCHAR: return "VARCHAR(320)"
    return {"text":"LONGTEXT","character varying":"VARCHAR(320)","numeric":"DECIMAL(30,6)","boolean":"TINYINT(1)","date":"DATE","timestamp with time zone":"DATETIME(6)","timestamp without time zone":"DATETIME(6)","integer":"INT","smallint":"SMALLINT","jsonb":"JSON"}.get(source_type, "LONGTEXT")

def target_columns(source):
    if source["schema"] == "auth": return [c for c in source["columns"] if c["column_name"] in {"id","email","created_at","updated_at"}]
    return source["columns"]

def target_name(source): return "gmao_legacy_auth_users" if source["schema"] == "auth" else source["table"]

def create_schema(connection, manifest):
    with connection.cursor() as cursor:
        for source in manifest["tables"]:
            target = target_name(source); columns = target_columns(source)
            definitions = []
            for column in columns:
                column = dict(column); column["table"] = target
                nullable = "NULL" if column["is_nullable"] == "YES" else "NOT NULL"
                definitions.append(f"`{column['column_name']}` {mysql_type(column)} {nullable}")
            key = "id" if target == "gmao_legacy_auth_users" else PRIMARY_KEYS[target]
            definitions.append(f"PRIMARY KEY (`{key}`)")
            if target in UNIQUE_KEYS: definitions.append("UNIQUE KEY `uq_%s` (%s)" % (target, ",".join(f"`{item}`" for item in UNIQUE_KEYS[target])))
            cursor.execute(f"CREATE TABLE IF NOT EXISTS `{target}` ({','.join(definitions)}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci")
    with connection.cursor() as cursor:
        cursor.execute("CREATE TABLE IF NOT EXISTS `gmao_local_credentials` (`profile_id` CHAR(32) NOT NULL, `password_hash` VARCHAR(255) NOT NULL, `must_change_password` TINYINT(1) NOT NULL DEFAULT 1, `password_changed_at` DATETIME(6) NULL, `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`profile_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci")
    connection.commit()

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
        for source in manifest["tables"]:
            target = target_name(source); columns = target_columns(source); names = [c["column_name"] for c in columns]
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
        create_schema(connection, manifest)
        if args.schema_only:
            print("Schéma Aiven préparé."); return
        report = import_data(connection, backup, manifest)
    output = ROOT / ".runtime" / "aiven-import-report.json"; output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Import Aiven valide : {len(report['tables'])} tables, rapport {output}")
if __name__ == "__main__": main()
