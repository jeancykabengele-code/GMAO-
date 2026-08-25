import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const PORTAL_ENTRY_KEY = 'gmao-public-home-visited';

export const portalEntryGuard: CanActivateFn = () => {
  const router = inject(Router);
  return sessionStorage.getItem(PORTAL_ENTRY_KEY) === 'true'
    ? true
    : router.createUrlTree(['/']);
};