from dataclasses import dataclass

from .models import Site, UserProfile


GLOBAL_ROLES = {"manager", "charge_operations"}
ADMINISTRATOR_ROLE = "administrator"


class PermissionDeniedError(Exception):
    pass


@dataclass(frozen=True)
class GmaoPermissions:
    global_scope: bool
    view_dashboard: bool
    view_documentation: bool
    create_records: bool
    modify_existing: bool
    delete_records: bool
    manage_users: bool
    view_audit_log: bool
    allowed_sites: list[str]

    def as_dict(self) -> dict:
        return {
            "globalScope": self.global_scope,
            "viewDashboard": self.view_dashboard,
            "viewDocumentation": self.view_documentation,
            "createRecords": self.create_records,
            "modifyExisting": self.modify_existing,
            "deleteRecords": self.delete_records,
            "manageUsers": self.manage_users,
            "viewAuditLog": self.view_audit_log,
            "allowedSites": self.allowed_sites,
        }


def build_permissions(profile: UserProfile) -> GmaoPermissions:
    is_global = profile.role in GLOBAL_ROLES
    manages_administration = _can_manage_administration(profile)
    allowed_sites = (
        list(Site.objects.filter(active=True).order_by("name").values_list("name", flat=True))
        if is_global
        else [profile.site]
    )
    return GmaoPermissions(
        global_scope=is_global,
        view_dashboard=is_global,
        view_documentation=is_global,
        create_records=profile.role == "chef_site",
        modify_existing=is_global,
        delete_records=is_global,
        manage_users=manages_administration,
        view_audit_log=manages_administration,
        allowed_sites=[site for site in allowed_sites if site],
    )


def assert_site_access(profile: UserProfile, site: str) -> None:
    if profile.role not in GLOBAL_ROLES and profile.site != site:
        raise PermissionDeniedError("Ce profil ne peut accéder qu’aux données de son propre site.")


def assert_can_create(profile: UserProfile, site: str) -> None:
    if profile.role != "chef_site":
        raise PermissionDeniedError("Seuls les Chefs de site peuvent renseigner une nouvelle fiche.")
    assert_site_access(profile, site)


def assert_can_modify(profile: UserProfile, site: str) -> None:
    assert_site_access(profile, site)
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Une fiche déjà enregistrée ne peut être modifiée que par un rôle global.")


def assert_can_delete_equipment(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer un équipement.")


def assert_can_delete(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer une fiche.")


def assert_can_delete_fuel_record(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer une ligne Fuel-GE.")


def assert_can_delete_ticket(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer un ticket.")

def assert_global_page_access(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Cette page est réservée au Manager GMAO et au Chargé des opérations.")


def assert_manage_users(profile: UserProfile) -> None:
    if not _can_manage_administration(profile):
        raise PermissionDeniedError("L’administration est réservée au profil Administrateur.")


def assert_view_audit_log(profile: UserProfile) -> None:
    if not _can_manage_administration(profile):
        raise PermissionDeniedError("Le journal d’audit est réservé au profil Administrateur.")


def _can_manage_administration(profile: UserProfile) -> bool:
    if profile.role == ADMINISTRATOR_ROLE:
        return True
    # Transition sûre : le Manager crée le premier Administrateur, puis perd
    # automatiquement l'accès administratif dès que ce compte existe.
    return profile.role == "manager" and not UserProfile.objects.filter(
        role=ADMINISTRATOR_ROLE,
        active=True,
    ).exists()
