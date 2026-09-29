import { Injectable, signal } from '@angular/core';

const VERSION_URL = '/version.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  readonly updateAvailable = signal(false);
  private knownVersion: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.checkForUpdate();
  };

  start(): void {
    if (this.timer !== null) return;
    void this.captureCurrentVersion();
    this.timer = setInterval(() => void this.checkForUpdate(), CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  reload(): void {
    window.location.reload();
  }

  private async captureCurrentVersion(): Promise<void> {
    this.knownVersion = await this.fetchVersion();
  }

  private async checkForUpdate(): Promise<void> {
    if (this.updateAvailable() || !this.knownVersion) return;
    const version = await this.fetchVersion();
    if (version && version !== this.knownVersion) this.updateAvailable.set(true);
  }

  private async fetchVersion(): Promise<string | null> {
    try {
      const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      const version = (data as { version?: unknown } | null)?.version;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  }
}
