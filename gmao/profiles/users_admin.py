import json

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from .models import Site, UserProfile
from .permissions import assert_global_page_access
from .views import require_supabase_user


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _serialize(profile):
    return {"id": str(profile.id), "email": profile.email, "fullName": profile.full_name, "role": profile.role, "site": profile.site, "active": profile.active}


def _deny_or_none(request):
    try:
        assert_global_page_access(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "profile_admin_denied", "detail": str(error)}, status=403)
    return None


@require_supabase_user
def profile_collection(request):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    return JsonResponse([_serialize(profile) for profile in UserProfile.objects.order_by("email")], safe=False)


@require_supabase_user
def profile_detail(request, profile_id):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method != "PATCH":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        profile = UserProfile.objects.get(id=profile_id)
        data = _payload(request)
        site_name = data.get("site")
        if site_name in (None, ""):
            profile.site = None
        else:
            site_name = str(site_name).strip()
            if not Site.objects.filter(name=site_name, active=True).exists():
                raise ValidationError("Le site sélectionné est introuvable ou désactivé.")
            profile.site = site_name
        if profile.role == "chef_site" and not profile.site:
            raise ValidationError("Un chef de site doit être associé à un site actif.")
        profile.save(update_fields=["site"])
        return JsonResponse(_serialize(profile))
    except UserProfile.DoesNotExist:
        return JsonResponse({"detail": "Utilisateur introuvable."}, status=404)
    except ValidationError as error:
        return JsonResponse({"status": 400, "code": "profile_rejected", "detail": error.messages[0]}, status=400)