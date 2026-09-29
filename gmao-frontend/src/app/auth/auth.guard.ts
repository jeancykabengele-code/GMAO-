import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateChildFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.initialize();
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.mustChangePassword()) {
    return router.createUrlTree(['/connexion']);
  }
  if (auth.profile()?.role === 'administrator'
      && !state.url.startsWith('/administration')
      && !state.url.startsWith('/a-propos')) {
    return router.createUrlTree(['/administration']);
  }
  return true;
};
