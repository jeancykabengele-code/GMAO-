import { Component } from '@angular/core';
import { GmaoDataStore } from '../data/gmao-data-store';
import { PdfExportService, PdfTableColumn } from '../shared/pdf-export.service';

type ReportRow = Record<string, unknown>;

interface PdfReport {
  title: string;
  description: string;
  fileName: string;
  rows: () => ReportRow[];
  columns: PdfTableColumn<ReportRow>[];
}

@Component({
  selector: 'app-documentations',
  standalone: true,
  templateUrl: './documentations-page.html',
  styleUrls: ['./documentations-page.scss'],
})
export class DocumentationsComponent {
  constructor(
    private readonly dataStore: GmaoDataStore = new GmaoDataStore(),
    private readonly pdfExporter: PdfExportService = new PdfExportService(),
  ) {}

  get canExportPdf(): boolean { return this.dataStore.canExportData; }

  get reports(): PdfReport[] {
    return [
      this.report('Équipements', 'Registre complet des actifs techniques.', 'registre-equipements', () => this.dataStore.equipmentRows, [
        this.column('Site', 'site'), this.column('Code', 'code'), this.column('Nom', 'nom'),
        this.column('Mise en service', 'dateMiseEnService'), this.column('Famille', 'famille'),
        this.column('Localisation', 'localisation'), this.column('Marque / Modèle', 'marqueModele'),
        this.column('État', 'etat'), this.column('Criticité', 'criticite'),
      ]),
      this.report('Gestion des tickets', 'File complète des tickets enregistrés.', 'gestion-des-tickets', () => this.dataStore.ticketRows, [
        this.column('Numéro', 'numero'), this.column('Site', 'site'), this.column('Nature', 'nature'),
        this.column('Équipement', 'equipement'), this.column('Date', 'date'), this.column('Porteur / agent', 'porteur'),
        this.column('Entreprise', 'entreprise'), this.column('Motif', 'motif'), this.column('Description', 'description'),
      ]),
      this.report('Interventions réalisées', 'Journal des travaux de maintenance effectués.', 'interventions-realisees', () => this.dataStore.interventionRows, [
        this.column('Ticket', 'ticketNumber'), this.column('Date', 'date'), this.column('Site', 'site'),
        this.column('Équipement', 'equipement'), this.column('Type', 'type'), this.column('Travail réalisé', 'travailRealise'),
        this.column('Agent', 'agent'), this.column('Durée (h)', 'dureeHeures'), this.column('Statut', 'statut'),
      ]),
      this.report('Groupes électrogènes', 'Compteurs et état de maintenance des groupes.', 'suivi-groupes-electrogenes', () => this.dataStore.generatorRows, [
        this.column('Site', 'site'), this.column('Code', 'code'), this.column('Groupe', 'typeGe'),
        this.column('Mois relevé', 'moisReleve'), this.column('RH actuel', 'rhActuel'), this.column('RH dernière PM', 'rhDernierePm'),
        this.column('RH depuis PM', 'rhDepuisDernierePm'), this.column('Prochaine PM', 'rhProchainePm'),
        this.column('État', 'etat'), this.column('Commentaires', 'commentaires'),
      ]),
      this.report('Fuel-GE', 'Journal mensuel du carburant et de la disponibilité Grid.', 'journal-fuel-ge', () => this.dataStore.fuelRows, [
        this.column('Site', 'site'), this.column('Mois et année', 'periode'), this.column('Stock initial (L)', 'stockInitial'),
        this.column('Consommé (L)', 'sortie'), this.column('Stock final (L)', 'stockFinal'), this.column('Heures GE', 'heuresGe'),
        this.column('L/h', 'litresHeure'), this.column('SNEL kWh', 'snelKwh'), this.column('Disponibilité Grid (%)', 'disponibiliteGrid'),
      ]),
      this.report('Suivi du PUE', 'Mesures énergétiques et valeurs PUE.', 'suivi-pue', () => this.dataStore.pueRows, [
        this.column('Site', 'site'), this.column('Mois', 'mois'), this.column('Énergie IT', 'energieIt'),
        this.column('Énergie totale', 'energieTotale'), this.column('PUE', 'pue'),
      ]),
      this.report('Problèmes Data Center', 'Journal des incidents et actions de résolution.', 'problemes-data-center', () => this.dataStore.problemRows, [
        this.column('Site', 'site'), this.column('Date', 'date'), this.column('Équipement', 'equipement'),
        this.column('Constat', 'constat'), this.column('Statut', 'statut'), this.column('Priorité', 'priorite'),
        this.column('Responsable', 'responsable'), this.column('Échéance', 'echeance'),
        this.column('Besoin spare', 'besoinSpare'), this.column('Prochaine étape', 'prochaineEtape'),
      ]),
      this.report('Pièces de rechange', 'Journal des mouvements de pièces.', 'pieces-de-rechange', () => this.dataStore.sparePartRows, [
        this.column('Site', 'site'), this.column('Date', 'date'), this.column('Ticket', 'ticketNumber'),
        this.column('Équipement', 'equipement'), this.column('Désignation', 'designation'),
        this.column('Quantité', 'quantite'), this.column('Agent', 'agent'), this.column('Statut', 'statut'),
      ]),
    ];
  }

  exportReport(report: PdfReport): void {
    if (!this.canExportPdf) return;
    void this.pdfExporter.exportTable({
      title: report.title,
      fileName: report.fileName,
      rows: report.rows(),
      columns: report.columns,
    });
  }

  private report(
    title: string,
    description: string,
    fileName: string,
    rows: () => unknown[],
    columns: PdfTableColumn<ReportRow>[],
  ): PdfReport {
    return { title, description, fileName, rows: () => rows() as ReportRow[], columns };
  }

  private column(header: string, key: string): PdfTableColumn<ReportRow> {
    return { header, value: (row) => row[key] };
  }
}