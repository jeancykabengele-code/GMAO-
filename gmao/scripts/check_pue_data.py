import os

import psycopg


with psycopg.connect(
    host=os.getenv("SUPABASE_DB_HOST", "aws-0-eu-central-1.pooler.supabase.com"),
    port=int(os.getenv("SUPABASE_DB_PORT", "5432")),
    dbname=os.getenv("SUPABASE_DB_NAME", "postgres"),
    user=os.getenv("SUPABASE_DB_USERNAME", "postgres.rgujwidwlqesukqwgnib"),
    password=os.environ["SUPABASE_DB_PASSWORD"],
    sslmode="require",
    connect_timeout=8,
) as connection:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*) as rows,
                   count(distinct site) as sites,
                   min(mois) as first_month,
                   max(mois) as last_month,
                   count(*) filter (where pue is null) as missing_pue
            from public.gmao_pue
            """
        )
        print("summary", *cursor.fetchone())
        cursor.execute(
            """
            select mois, count(*) as sites, round(avg(pue), 3) as average_pue
            from public.gmao_pue
            group by mois
            order by mois
            """
        )
        for row in cursor.fetchall():
            print("month", *row)
