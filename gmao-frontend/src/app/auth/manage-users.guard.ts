import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccessControlService } from './access-control.service';
import { AuthService } from './auth.service';

export const manageUsersGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const access = inject(AccessControlService);
  const router = inject(Router);

  await auth.initialize();
  return access.canManageUsers ? true : router.createUrlTree(['/administration/sites']);
};
