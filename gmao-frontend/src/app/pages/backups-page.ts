import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { AuditLogRecord, GmaoApiService } from '../data/gmao-api.service';
import { downloadBlob } from '../shared/file-download.util';

@Component({
  selector: 'app-backups-page',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="backups-page">
      <div class="card intro">
        <p>Génère une archive complète des données métier, des sites, des comptes et du journal d’audit (hors mots de passe), au format ZIP, téléchargée immédiatement. Rien n’est conservé sur le serveur.</p>
        <button type="button" class="primary" [disabled]="exporting" (click)="generateBackup()">{{ exporting ? 'Génération…' : 'Générer une sauvegarde' }}</button>
      </div>
      @if (message) { <p class="message success">{{ message }}</p> }
      @if (error) { <p class="message error">{{ error }}</p> }
      <div class="card">
        <h2>Sauvegardes récentes</h2>
        @if (loading) { <p class="empty">Chargement…</p> }
        @else {
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Déclenchée par</th><th>Lignes exportées</th></tr></thead>
              <tbody>
                @for (entry of entries; track entry.id) {
                  <tr><td>{{ entry.createdAt | date:'dd/MM/yyyy HH:mm:ss' }}</td><td>{{ entry.actorEmail || 'Inconnu' }}</td><td>{{ rowCount(entry) }}</td></tr>
                }
                @empty { <tr><td colspan="3" class="empty">Aucune sauvegarde générée pour le moment.</td></tr> }
              </tbody>
            </table>
          </div>
        }
      </div>
    </section>
  `,
  styles: `:host{display:block;padding:clamp(18px,4vw,44px);color:#252525}.backups-page{max-width:1100px;margin:auto}.card{background:rgba(255,255,255,.95);border-radius:14px;padding:22px;box-shadow:0 12px 30px rgba(0,0,0,.1);margin-bottom:20px}.intro{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}.intro p{margin:0;color:#52606d;max-width:640px}h2{margin:0 0 14px;font-size:1.2rem}button{border:0;border-radius:8px;padding:11px 18px;font:inherit;cursor:pointer}.primary{color:#fff;background:#ff6700}.primary:disabled{opacity:.6;cursor:wait}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb}th{color:#fff;background:#292929;white-space:nowrap}.message{padding:12px 14px;border-radius:8px}.success{background:#e2f4e7;color:#216b35}.error{background:#fde6e6;color:#9a2525}.empty{text-align:center;color:#68788a;padding:24px}@media(max-width:620px){.intro{flex-direction:column;align-items:stretch}}`,
})
export class BackupsPageComponent {
  private readonly api = inject(GmaoApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  entries: AuditLogRecord[] = [];
  loading = true;
  exporting = false;
  message = '';
  error = '';

  constructor() { void this.loadHistory(); }

  async loadHistory(): Promise<void> {
    this.loading = true;
    try { const page = await this.api.listAuditLogs({ action: 'backup_export', limit: 20 }); this.entries = page.items; }
    catch (reason) { this.error = this.api.errorMessage(reason, 'Impossible de charger l’historique des sauvegardes.'); }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  async generateBackup(): Promise<void> {
    this.exporting = true; this.error = ''; this.message = '';
    try {
      const { blob, fileName } = await this.api.exportBackup();
      downloadBlob(blob, fileName);
      this.message = 'Sauvegarde générée et téléchargée.';
      await this.loadHistory();
    } catch (reason) {
      this.error = this.api.errorMessage(reason, 'Impossible de générer la sauvegarde.');
    } finally {
      this.exporting = false;
      this.cdr.detectChanges();
    }
  }

  rowCount(entry: AuditLogRecord): number {
    const counts = entry.details?.['rowCounts'] as Record<string, number> | undefined;
    if (!counts) return 0;
    return Object.values(counts).reduce((total, value) => total + value, 0);
  }
}
