from uuid import UUID

from .models import Site, UserProfile


ALLOWED_ROLES = {"administrator", "manager", "charge_operations", "chef_site"}


class ProfileAccessError(Exception):
    pass


def load_active_profile(user_id: str) -> UserProfile:
    try:
        profile = UserProfile.objects.get(id=UUID(user_id), active=True)
    except (ValueError, UserProfile.DoesNotExist) as error:
        raise ProfileAccessError("Aucun profil GMAO actif ne correspond à ce compte.") from error

    if profile.role not in ALLOWED_ROLES:
        raise ProfileAccessError("Le rôle associé à ce profil GMAO n’est pas reconnu.")
    if profile.role == "chef_site" and not profile.site:
        raise ProfileAccessError("Le chef de site n’est associé à aucun site.")
    if profile.role == 'chef_site' and not Site.objects.filter(name=profile.site, active=True).exists():
        raise ProfileAccessError('Le site associé à ce chef de site est désactivé.')
    return profile


