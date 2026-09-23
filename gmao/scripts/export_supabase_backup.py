"""Export read-only Supabase backup; credentials stay in environment."""
from __future__ import annotations
import csv, hashlib, json, os, sys
from datetime import UTC, datetime
from pathlib import Path
import psycopg
from psycopg import sql

TABLES = (("auth","users"),("public","user_profiles"),("public","sites"),("public","gmao_equipements"),("public","gmao_tickets"),("public","gmao_groupes_electrogenes"),("public","gmao_releves_rh_ge"),("public","gmao_fuel_ge"),("public","gmao_fuel_ravitaillements"),("public","gmao_consommations_groupes_ge"),("public","gmao_fuel_monthly_summary"),("public","gmao_pue"),("public","gmao_problemes_datacenter"),("public","gmao_interventions"),("public","gmao_pieces_rechange"),("public","gmao_notifications"))

def db_options():
    password = os.getenv("SUPABASE_DB_PASSWORD")
    if not password: raise RuntimeError("SUPABASE_DB_PASSWORD est requis.")
    return dict(host=os.getenv("SUPABASE_DB_HOST","aws-0-eu-central-1.pooler.supabase.com"), port=int(os.getenv("SUPABASE_DB_PORT","5432")), dbname=os.getenv("SUPABASE_DB_NAME","postgres"), user=os.getenv("SUPABASE_DB_USERNAME"), password=password, sslmode="require", connect_timeout=15)

def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1048576), b""): value.update(chunk)
    return value.hexdigest()

def export(cursor, schema, table, destination):
    cursor.execute("select column_name,data_type,is_nullable,ordinal_position from information_schema.columns where table_schema=%s and table_name=%s order by ordinal_position", (schema, table))
    columns = [dict(row) for row in cursor.fetchall()]
    if not columns: raise RuntimeError(f"Table introuvable ou non accessible : {schema}.{table}")
    path = destination / f"{schema}.{table}.csv"
    statement = sql.SQL("COPY (SELECT * FROM {}.{}) TO STDOUT WITH (FORMAT CSV, HEADER true)").format(sql.Identifier(schema), sql.Identifier(table))
    with path.open("w", encoding="utf-8", newline="") as target:
        with cursor.copy(statement) as copy:
            for block in copy: target.write(bytes(block).decode("utf-8"))
    with path.open("r", encoding="utf-8", newline="") as source: rows = sum(1 for _ in csv.reader(source)) - 1
    return {"schema":schema,"table":table,"file":path.name,"rows":rows,"sha256":digest(path),"columns":columns}

def main():
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = Path(__file__).resolve().parents[1] / "backups" / f"supabase-{timestamp}"
    destination.mkdir(parents=True, exist_ok=False)
    manifest = {"createdAt":datetime.now(UTC).isoformat(),"tables":[],"failures":[]}
    try:
        with psycopg.connect(**db_options(), row_factory=psycopg.rows.dict_row) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            with connection.cursor() as cursor:
                for schema, table in TABLES:
                    try:
                        result = export(cursor,schema,table,destination); manifest["tables"].append(result); print(f"OK {schema}.{table}: {result['rows']} lignes")
                    except Exception as error:
                        manifest["failures"].append({"schema":schema,"table":table,"reason":str(error)}); print(f"ECHEC {schema}.{table}: {error}",file=sys.stderr)
    finally:
        manifest_path = destination / "manifest.json"; manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    if manifest["failures"]:
        print(f"Sauvegarde incomplète : consulter {manifest_path}",file=sys.stderr); return 1
    print(f"Sauvegarde vérifiée : {destination}"); return 0
if __name__ == "__main__": raise SystemExit(main())
