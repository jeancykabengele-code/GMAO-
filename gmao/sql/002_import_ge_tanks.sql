-- Import idempotent : 29 groupes électrogènes et 26 réservoirs.
begin;
alter table public.gmao_equipements alter column date_mise_en_service drop not null;
alter table public.gmao_equipements
  add column if not exists site_code text,
  add column if not exists marque text,
  add column if not exists modele text,
  add column if not exists numero_serie text,
  add column if not exists unite_releve text,
  add column if not exists quantite_associee numeric(14,2),
  add column if not exists source_document text,
  add column if not exists source_page integer,
  add column if not exists periode_source text,
  add column if not exists confiance text,
  add column if not exists statut_revision text,
  add column if not exists note_revision text,
  add column if not exists description text;
do $$
begin
  if not exists (select 1 from public.user_profiles where active = true and role in ('manager', 'charge_operations')) then
    raise exception 'Aucun profil global actif disponible pour created_by.';
  end if;
end
$$;
with actor as (
  select id from public.user_profiles
  where active = true and role in ('manager', 'charge_operations')
  order by case role when 'manager' then 0 else 1 end, created_at limit 1
), source (site, site_code, code, nom, famille, localisation, marque_modele, marque, modele,
  numero_serie, etat, criticite, unite_releve, quantite_associee, source_document,
  source_page, periode_source, confiance, statut_revision, note_revision, description) as (
  values
    ('Goma', 'DC-GOM', 'DC-GOM-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'DATA CENTER GOMA Monthly power report for JUNE 2026 [Read-Only].pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Goma', 'DC-GOM', 'DC-GOM-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'DATA CENTER GOMA Monthly power report for JUNE 2026 [Read-Only].pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Goma', 'DC-GOM', 'DC-GOM-GE-001', 'Groupe électrogène 1 LINZ', 'Energie', 'Local groupes', 'LINZ 135 kVA', 'LINZ', '135 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DATA CENTER GOMA Monthly power report for JUNE 2026 [Read-Only].pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Goma', 'DC-GOM', 'DC-GOM-GE-002', 'Groupe électrogène 2 LINZ', 'Energie', 'Local groupes', 'LINZ 150 kVA', 'LINZ', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DATA CENTER GOMA Monthly power report for JUNE 2026 [Read-Only].pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Bukavu', 'DC-BKV', 'DC-BKV-TANK-001', 'Réservoir fuel 2 m³', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'DC BUKAVU Monthly power report for JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Bukavu', 'DC-BKV', 'DC-BKV-TANK-002', 'Réservoir fuel 5 m³', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'DC BUKAVU Monthly power report for JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Bukavu', 'DC-BKV', 'DC-BKV-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 250 kVA', 'VISA', '250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC BUKAVU Monthly power report for JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Bukavu', 'DC-BKV', 'DC-BKV-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 250 kVA', 'VISA', '250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC BUKAVU Monthly power report for JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Fikin', 'DC-FIK', 'DC-FIK-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'DC FIKIN Monthly power report for JUNE 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Fikin', 'DC-FIK', 'DC-FIK-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '1.5 m³', NULL, '1.5 m³', NULL, 'En service', 'Critique', 'L', 1, 'DC FIKIN Monthly power report for JUNE 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Fikin', 'DC-FIK', 'DC-FIK-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC FIKIN Monthly power report for JUNE 2026.pdf', 3, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Fikin', 'DC-FIK', 'DC-FIK-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC FIKIN Monthly power report for JUNE 2026.pdf', 3, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Fikin', 'DC-FIK', 'DC-FIK-GE-003', 'Groupe électrogène LINZ', 'Energie', 'Local groupes', 'LINZ 80 kVA', 'LINZ', '80 kVA', NULL, 'En service', 'Critique', 'h', 1, 'Donnée GE.xlsx', NULL, '2026-08', 'high', 'VALIDE', 'Équipement complémentaire identifié dans le relevé de maintenance GE; état déduit de la présence d''un compteur actif.', NULL),
    ('Mbuji mayi', 'DC-MBM', 'DC-MBM-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '2000 L', NULL, '2000 L', NULL, 'En service', 'Critique', 'L', 1, 'DC MBUJIMAYI, Monthly power report for Jun 2026 (1).pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Mbuji mayi', 'DC-MBM', 'DC-MBM-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2000 L', NULL, '2000 L', NULL, 'En service', 'Critique', 'L', 1, 'DC MBUJIMAYI, Monthly power report for Jun 2026 (1).pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Mbuji mayi', 'DC-MBM', 'DC-MBM-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC MBUJIMAYI, Monthly power report for Jun 2026 (1).pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Mbuji mayi', 'DC-MBM', 'DC-MBM-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'DC MBUJIMAYI, Monthly power report for Jun 2026 (1).pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Utex', 'DC-UTX', 'DC-UTX-TANK-001', 'Réservoir fuel 15 m³', 'Energie', 'Zone fuel', '15 m³', NULL, '15 m³', NULL, 'En service', 'Critique', 'L', 1, 'HQ UTEX POWER MANAGEMENT SERVICE 06.2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Utex', 'DC-UTX', 'DC-UTX-TANK-002', 'Réservoir fuel 30 m³', 'Energie', 'Zone fuel', '30 m³', NULL, '30 m³', NULL, 'En service', 'Critique', 'L', 1, 'HQ UTEX POWER MANAGEMENT SERVICE 06.2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Utex', 'DC-UTX', 'DC-UTX-GE-001', 'Groupe électrogène CAT', 'Energie', 'Local groupes', 'CAT 810 kVA', 'CAT', '810 kVA', NULL, 'En service', 'Critique', 'h', 1, 'HQ UTEX POWER MANAGEMENT SERVICE 06.2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Utex', 'DC-UTX', 'DC-UTX-GE-002', 'Groupe électrogène FG Wilson', 'Energie', 'Local groupes', 'FG Wilson 900 kVA', 'FG Wilson', '900 kVA', NULL, 'En service', 'Critique', 'h', 1, 'HQ UTEX POWER MANAGEMENT SERVICE 06.2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Utex', 'DC-UTX', 'DC-UTX-GE-003', 'Groupe électrogène Gesan', 'Energie', 'Local groupes', 'Gesan 800 kVA', 'Gesan', '800 kVA', NULL, 'Hors service', 'Critique', 'h', 1, 'HQ UTEX POWER MANAGEMENT SERVICE 06.2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Katanga', 'DC-KAT', 'DC-KAT-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '4 m³', NULL, '4 m³', NULL, 'En service', 'Critique', 'L', 1, 'KATANGA , Monthly power report  JUIN  2026.pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Katanga', 'DC-KAT', 'DC-KAT-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'KATANGA , Monthly power report  JUIN  2026.pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Katanga', 'DC-KAT', 'DC-KAT-GE-001', 'Groupe électrogène FG Wilson 1', 'Energie', 'Local groupes', 'FG Wilson 250 kVA', 'FG Wilson', '250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'KATANGA , Monthly power report  JUIN  2026.pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Katanga', 'DC-KAT', 'DC-KAT-GE-002', 'Groupe électrogène FG Wilson 2', 'Energie', 'Local groupes', 'FG Wilson 250 kVA', 'FG Wilson', '250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'KATANGA , Monthly power report  JUIN  2026.pdf', 4, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Kisangani', 'DC-KIS', 'DC-KIS-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'La fourchette Monthly report for June 2026.pdf', 5, '2026-06', 'high', 'A_CONFIRMER', NULL, NULL),
    ('Kisangani', 'DC-KIS', 'DC-KIS-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'La fourchette Monthly report for June 2026.pdf', 5, '2026-06', 'high', 'A_CONFIRMER', NULL, NULL),
    ('Kisangani', 'DC-KIS', 'DC-KIS-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Power room', 'VISA 200 kVA', 'VISA', '200 kVA', NULL, 'En service', 'Critique', 'h', 1, 'La fourchette Monthly report for June 2026.pdf', 5, '2026-06', 'high', 'A_CONFIRMER', NULL, NULL),
    ('Kisangani', 'DC-KIS', 'DC-KIS-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Power room', 'VISA 200 kVA', 'VISA', '200 kVA', NULL, 'En service', 'Critique', 'h', 1, 'La fourchette Monthly report for June 2026.pdf', 5, '2026-06', 'high', 'A_CONFIRMER', NULL, NULL),
    ('Matadi', 'DC-MAT', 'DC-MAT-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'MONTHLY POWER JUIN.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Matadi', 'DC-MAT', 'DC-MAT-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'MONTHLY POWER JUIN.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Matadi', 'DC-MAT', 'DC-MAT-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MONTHLY POWER JUIN.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Matadi', 'DC-MAT', 'DC-MAT-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MONTHLY POWER JUIN.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Mbandaka', 'DC-MBD', 'DC-MBD-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'Monthly power report Data Center Mbandaka for April 2026.pdf', 5, '2026-04', 'high', 'VALIDE', NULL, NULL),
    ('Mbandaka', 'DC-MBD', 'DC-MBD-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'Monthly power report Data Center Mbandaka for April 2026.pdf', 5, '2026-04', 'high', 'VALIDE', NULL, NULL),
    ('Mbandaka', 'DC-MBD', 'DC-MBD-TANK-003', 'Réservoir fuel 3', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'Monthly power report Data Center Mbandaka for April 2026.pdf', 5, '2026-04', 'high', 'VALIDE', NULL, NULL),
    ('Mbandaka', 'DC-MBD', 'DC-MBD-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'Monthly power report Data Center Mbandaka for April 2026.pdf', 5, '2026-04', 'high', 'VALIDE', NULL, NULL),
    ('Mbandaka', 'DC-MBD', 'DC-MBD-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'Monthly power report Data Center Mbandaka for April 2026.pdf', 5, '2026-04', 'high', 'VALIDE', NULL, NULL),
    ('Pigeon', 'DC-PIG', 'DC-PIG-TANK-001', 'Réservoir fuel principal', 'Energie', 'Zone fuel', '40 m³', NULL, '40 m³', NULL, 'En service', 'Critique', 'L', 1, 'MONTHLY POWER REPORT FOR JUNE 2026 DC PIGEON.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Pigeon', 'DC-PIG', 'DC-PIG-GE-001', 'Groupe électrogène FG Wilson', 'Energie', 'Local groupes', 'FG Wilson 1250 kVA', 'FG Wilson', '1250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MONTHLY POWER REPORT FOR JUNE 2026 DC PIGEON.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Pigeon', 'DC-PIG', 'DC-PIG-GE-002', 'Groupe électrogène CAT', 'Energie', 'Local groupes', 'CAT 500 kVA', 'CAT', '500 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MONTHLY POWER REPORT FOR JUNE 2026 DC PIGEON.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Pigeon', 'DC-PIG', 'DC-PIG-GE-003', 'Groupe électrogène Teksan', 'Energie', 'Local groupes', 'Teksan 500 kVA', 'Teksan', '500 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MONTHLY POWER REPORT FOR JUNE 2026 DC PIGEON.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('MTC', 'DC-MTC', 'DC-MTC-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'MTC DC, Monthly power report for  JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('MTC', 'DC-MTC', 'DC-MTC-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '5 m³', NULL, '5 m³', NULL, 'En service', 'Critique', 'L', 1, 'MTC DC, Monthly power report for  JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('MTC', 'DC-MTC', 'DC-MTC-GE-001', 'Groupe électrogène Perkins', 'Energie', 'Local groupes', 'Perkins 380 kVA', 'Perkins', '380 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MTC DC, Monthly power report for  JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('MTC', 'DC-MTC', 'DC-MTC-GE-002', 'Groupe électrogène Génélec', 'Energie', 'Local groupes', 'Génélec 400 kVA', 'Génélec', '400 kVA', NULL, 'En service', 'Critique', 'h', 1, 'MTC DC, Monthly power report for  JUIN 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('New MTC', 'DC-NMTC', 'DC-NMTC-GE-001', 'Groupe électrogène PRAMAC 1', 'Energie', 'Outdoor', 'PRAMAC 1250 kVA', 'PRAMAC', '1250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'New MTC POWER MANAGEMENT SERVICE FOR JUNE 2026.pdf', 7, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('New MTC', 'DC-NMTC', 'DC-NMTC-GE-002', 'Groupe électrogène PRAMAC 2', 'Energie', 'Outdoor', 'PRAMAC 1250 kVA', 'PRAMAC', '1250 kVA', NULL, 'En service', 'Critique', 'h', 1, 'New MTC POWER MANAGEMENT SERVICE FOR JUNE 2026.pdf', 7, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('New MTC', 'DC-NMTC', 'DC-NMTC-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '14 m³', NULL, '14 m³', NULL, 'En service', 'Critique', 'L', 1, 'New MTC POWER MANAGEMENT SERVICE FOR JUNE 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('New MTC', 'DC-NMTC', 'DC-NMTC-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '14 m³', NULL, '14 m³', NULL, 'En service', 'Critique', 'L', 1, 'New MTC POWER MANAGEMENT SERVICE FOR JUNE 2026.pdf', 5, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Kikwit', 'DC-KIK', 'DC-KIK-TANK-001', 'Réservoir fuel 1', 'Energie', 'Zone fuel', '4 m³', NULL, '4 m³', NULL, 'En service', 'Critique', 'L', 1, 'POWER MANAGED JUNE 2026 DC KIKWIT OCPT ID_1017.pdf', 3, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Kikwit', 'DC-KIK', 'DC-KIK-TANK-002', 'Réservoir fuel 2', 'Energie', 'Zone fuel', '2 m³', NULL, '2 m³', NULL, 'En service', 'Critique', 'L', 1, 'POWER MANAGED JUNE 2026 DC KIKWIT OCPT ID_1017.pdf', 3, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Kikwit', 'DC-KIK', 'DC-KIK-GE-001', 'Groupe électrogène VISA 1', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En panne', 'Critique', 'h', 1, 'POWER MANAGED JUNE 2026 DC KIKWIT OCPT ID_1017.pdf', 10, '2026-06', 'high', 'VALIDE', NULL, NULL),
    ('Kikwit', 'DC-KIK', 'DC-KIK-GE-002', 'Groupe électrogène VISA 2', 'Energie', 'Local groupes', 'VISA 150 kVA', 'VISA', '150 kVA', NULL, 'En service', 'Critique', 'h', 1, 'POWER MANAGED JUNE 2026 DC KIKWIT OCPT ID_1017.pdf', 10, '2026-06', 'high', 'VALIDE', NULL, NULL)
)
insert into public.gmao_equipements (
  site, site_code, code, nom, date_mise_en_service, famille, localisation, marque_modele,
  marque, modele, numero_serie, etat, criticite, unite_releve, quantite_associee,
  source_document, source_page, periode_source, confiance, statut_revision,
  note_revision, description, created_by)
select source.site, source.site_code, source.code, source.nom, null::date, source.famille,
  source.localisation, source.marque_modele, source.marque, source.modele, source.numero_serie,
  source.etat, source.criticite, source.unite_releve, source.quantite_associee,
  source.source_document, source.source_page, source.periode_source, source.confiance,
  source.statut_revision, source.note_revision, source.description, actor.id
from source cross join actor
on conflict (site, code) do update set
  site_code = excluded.site_code, nom = excluded.nom, famille = excluded.famille,
  localisation = excluded.localisation, marque_modele = excluded.marque_modele,
  marque = excluded.marque, modele = excluded.modele, numero_serie = excluded.numero_serie,
  etat = excluded.etat, criticite = excluded.criticite, unite_releve = excluded.unite_releve,
  quantite_associee = excluded.quantite_associee, source_document = excluded.source_document,
  source_page = excluded.source_page, periode_source = excluded.periode_source,
  confiance = excluded.confiance, statut_revision = excluded.statut_revision,
  note_revision = excluded.note_revision, description = excluded.description,
  updated_by = excluded.created_by, updated_at = now();
commit;
select count(*) filter (where code like '%-GE-%') as groupes_electrogenes,
       count(*) filter (where code like '%-TANK-%') as reservoirs,
       count(*) filter (where statut_revision = 'A_CONFIRMER') as a_confirmer
from public.gmao_equipements where code like 'DC-%';
