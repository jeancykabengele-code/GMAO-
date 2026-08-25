import { Component, inject } from '@angular/core';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { PORTAL_ENTRY_KEY } from '../auth/portal-entry.guard';

@Component({
  selector: 'app-public-home-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './public-home-page.html',
  styleUrl: './public-home-page.scss',
})
export class PublicHomePageComponent {
  private readonly route = inject(ActivatedRoute);

  allowPortalEntry(): void {
    sessionStorage.setItem(PORTAL_ENTRY_KEY, 'true');
  }

  get loginQueryParams(): Params | null {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return returnUrl?.startsWith('/') && !returnUrl.startsWith('//')
      ? { returnUrl }
      : null;
  }
}