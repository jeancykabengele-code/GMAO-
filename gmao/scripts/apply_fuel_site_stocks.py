import os
from pathlib import Path

import psycopg


PROJECT_DIR = Path(__file__).resolve().parents[1]
SQL_FILE = PROJECT_DIR / "sql" / "006_fuel_site_stocks_2026.sql"


def connect():
    return psycopg.connect(
        host=os.getenv("SUPABASE_DB_HOST", "aws-0-eu-central-1.pooler.supabase.com"),
        port=int(os.getenv("SUPABASE_DB_PORT", "5432")),
        dbname=os.getenv("SUPABASE_DB_NAME", "postgres"),
        user=os.getenv("SUPABASE_DB_USERNAME", "postgres.rgujwidwlqesukqwgnib"),
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=8,
        autocommit=True,
    )


with connect() as connection:
    with connection.cursor() as cursor:
        cursor.execute(SQL_FILE.read_text(encoding="utf-8"))
        while cursor.nextset():
            pass

with connect() as connection:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select periode,
                   count(*) filter (where stock_initial is not null and stock_final is not null) as sites,
                   round(sum(stock_initial), 3) as stock_initial_total,
                   round(sum(stock_final), 3) as stock_final_total
            from public.gmao_fuel_ge
            where periode between '2026-01' and '2026-06'
            group by periode
            order by periode
            """
        )
        rows = cursor.fetchall()

if len(rows) != 6 or any(row[1] != 13 for row in rows):
    raise RuntimeError(f"Import incomplet: {rows!r}")

for row in rows:
    print(" | ".join(str(value) for value in row))
