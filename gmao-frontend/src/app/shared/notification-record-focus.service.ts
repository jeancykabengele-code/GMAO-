import { Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

export interface NotificationFocusRow {
  id?: string;
}

export interface NotificationFocusConfig<T extends NotificationFocusRow> {
  rows: () => T[];
  clearFilters: () => void;
  setPage: (page: number) => void;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationRecordFocusService {
  private readonly targetRecordId = signal<string | null>(null);
  private focusAttempt = 0;

  bind<T extends NotificationFocusRow>(route: ActivatedRoute, config: NotificationFocusConfig<T>): void {
    route.queryParamMap.subscribe((params) => {
      const recordId = params.get('record');
      this.focusAttempt++;
      const attempt = this.focusAttempt;
      this.targetRecordId.set(recordId);
      if (!recordId) return;

      config.clearFilters();
      this.locateRecord(recordId, config, attempt, 0);
    });
  }

  isTarget(recordId: string | undefined): boolean {
    return Boolean(recordId && recordId === this.targetRecordId());
  }

  private locateRecord<T extends NotificationFocusRow>(
    recordId: string,
    config: NotificationFocusConfig<T>,
    attempt: number,
    retry: number,
  ): void {
    if (attempt !== this.focusAttempt) return;
    const index = config.rows().findIndex((row) => row.id === recordId);
    if (index < 0) {
      if (retry < 60) window.setTimeout(() => this.locateRecord(recordId, config, attempt, retry + 1), 250);
      return;
    }

    config.setPage(Math.floor(index / config.pageSize) + 1);
    window.setTimeout(() => {
      if (attempt !== this.focusAttempt) return;
      const row = document.querySelector<HTMLElement>(`[data-record-id="${recordId}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        if (this.targetRecordId() === recordId) this.targetRecordId.set(null);
      }, 5000);
    }, 100);
  }
}
