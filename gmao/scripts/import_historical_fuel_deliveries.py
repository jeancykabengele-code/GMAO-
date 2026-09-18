import argparse
import calendar
import json
import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg

SITE_MAP = {
    "DC BUKAVU": "Bukavu", "DC FIKIN": "Fikin", "DC GOMA": "Goma",
    "DC KIKWIT": "Kikwit", "DC KISANGANI": "Kisangani", "DC MATADI": "Matadi",
    "DC MBANDAKA": "Mbandaka", "DC MBUJI-MAYI": "Mbuji mayi", "DC NEW MTC": "New MTC",
    "DC OLD MTC": "MTC", "DC PIGEON": "Pigeon", "DC TSHONDO": "Katanga",
    "UTEX DATA CENTER": "Utex",
}


def connect():
    return psycopg.connect(
        host=os.getenv("SUPABASE_DB_HOST", "aws-0-eu-central-1.pooler.supabase.com"),
        port=int(os.getenv("SUPABASE_DB_PORT", "5432")), dbname=os.getenv("SUPABASE_DB_NAME", "postgres"),
        user=os.getenv("SUPABASE_DB_USERNAME", "postgres.rgujwidwlqesukqwgnib"),
        password=os.environ["SUPABASE_DB_PASSWORD"], sslmode="require", connect_timeout=8,
    )


def main():
    parser = argparse.ArgumentParser(description="Importe les ravitaillements historiques mensuels.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    deliveries = json.loads(args.input.read_text(encoding="utf-8"))["deliveries"]
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("select id from public.user_profiles where active=true and role='manager' order by created_at limit 1")
            actor = cursor.fetchone()
            if not actor:
                raise RuntimeError("Aucun Manager actif disponible pour attribuer l’import.")
            cursor.execute("select name from public.sites where active=true")
            sites = {row[0] for row in cursor.fetchall()}
            prepared = []
            skipped_sites = []
            for delivery in deliveries:
                site = SITE_MAP[delivery["source_site"]]
                if site not in sites:
                    skipped_sites.append(delivery["source_site"])
                    continue
                month = int(delivery["month"])
                delivery_date = date(2026, month, calendar.monthrange(2026, month)[1])
                comment = ""
                prepared.append((site, delivery_date, Decimal(str(delivery["quantity"])), comment, actor[0]))
            cursor.execute(
                """
                select site, date_ravitaillement, quantite_recue
                from public.gmao_fuel_ravitaillements
                where fournisseur = 'Non renseigné'
                  and bon_livraison = 'Non renseigné'
                  and type_carburant = 'Diesel'
                  and stock_avant is null
                  and stock_apres is null
                  and commentaires = ''
                """
            )
            existing = {(site, day, quantity) for site, day, quantity in cursor.fetchall()}
            to_insert = [row for row in prepared if (row[0], row[1], row[2]) not in existing]
            print(f"Préparés : {len(prepared)} | déjà présents : {len(prepared) - len(to_insert)} | à créer : {len(to_insert)} | ignorés (site absent) : {len(skipped_sites)}")
            if skipped_sites:
                print("Sites ignorés : " + ", ".join(sorted(set(skipped_sites))))
            if args.dry_run:
                return
            cursor.executemany(
                """
                insert into public.gmao_fuel_ravitaillements
                    (site, date_ravitaillement, fournisseur, bon_livraison, type_carburant,
                     quantite_recue, stock_avant, stock_apres, numero_citerne,
                     receptionne_par, commentaires, difference_stock, created_by)
                values (%s, %s, 'Non renseigné', 'Non renseigné', 'Diesel',
                        %s, null, null, 'Non renseigné', 'Non renseigné', %s, false, %s)
                """,
                to_insert,
            )
        connection.commit()
    print(f"Import terminé : {len(to_insert)} ravitaillements créés.")


if __name__ == "__main__":
    main()