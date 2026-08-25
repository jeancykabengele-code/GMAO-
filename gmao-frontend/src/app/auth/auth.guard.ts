import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateChildFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.initialize();
  return auth.isAuthenticated()
    ? true
    : router.createUrlTree(['/'], { queryParams: { returnUrl: state.url } });
};