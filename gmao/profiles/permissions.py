from dataclasses import dataclass

from .models import Site, UserProfile


GLOBAL_ROLES = {"manager", "charge_operations"}


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
    allowed_sites: list[str]

    def as_dict(self) -> dict:
        return {
            "globalScope": self.global_scope,
            "viewDashboard": self.view_dashboard,
            "viewDocumentation": self.view_documentation,
            "createRecords": self.create_records,
            "modifyExisting": self.modify_existing,
            "deleteRecords": self.delete_records,
            "allowedSites": self.allowed_sites,
        }


def build_permissions(profile: UserProfile) -> GmaoPermissions:
    is_global = profile.role in GLOBAL_ROLES
    allowed_sites = (
        list(Site.objects.filter(active=True).order_by("name").values_list("name", flat=True))
        if is_global
        else [profile.site]
    )
    return GmaoPermissions(
        global_scope=is_global,
        view_dashboard=is_global,
        view_documentation=is_global,
        create_records=True,
        modify_existing=is_global,
        delete_records=False,
        allowed_sites=[site for site in allowed_sites if site],
    )


def assert_site_access(profile: UserProfile, site: str) -> None:
    if profile.role not in GLOBAL_ROLES and profile.site != site:
        raise PermissionDeniedError("Ce profil ne peut accéder qu’aux données de son propre site.")


def assert_can_create(profile: UserProfile, site: str) -> None:
    assert_site_access(profile, site)


def assert_can_modify(profile: UserProfile, site: str) -> None:
    assert_site_access(profile, site)
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Une fiche déjà enregistrée ne peut être modifiée que par un rôle global.")


def assert_can_delete_equipment(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer un équipement.")


def assert_can_delete(profile: UserProfile) -> None:
    raise PermissionDeniedError("La suppression des fiches GMAO est interdite.")


def assert_can_delete_fuel_record(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer une ligne Fuel-GE.")


def assert_can_delete_ticket(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Seuls le Manager GMAO et le Chargé des opérations peuvent supprimer un ticket.")

def assert_global_page_access(profile: UserProfile) -> None:
    if profile.role not in GLOBAL_ROLES:
        raise PermissionDeniedError("Cette page est réservée au Manager GMAO et au Chargé des opérations.")