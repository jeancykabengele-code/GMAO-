import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccessControlService } from './access-control.service';
import { AuthService } from './auth.service';

export const auditLogGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const access = inject(AccessControlService);
  const router = inject(Router);

  await auth.initialize();
  return access.canViewAuditLog ? true : router.createUrlTree(['/accueil']);
};
