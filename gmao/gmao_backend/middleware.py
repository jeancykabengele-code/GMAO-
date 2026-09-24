import re

from django.conf import settings
from django.http import HttpResponse


def is_allowed_frontend_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in settings.FRONTEND_ORIGINS:
        return True
    # Autorise uniquement les alias de déploiement du projet Vercel GMAO.
    return bool(re.fullmatch(r'https://gmao-ordc(?:-[a-z0-9-]+)?\.vercel\.app', origin))


class ApiCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        if request.method == "OPTIONS" and request.path.startswith("/api/"):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        if is_allowed_frontend_origin(origin) and request.path.startswith("/api/"):
            response["Access-Control-Allow-Origin"] = origin
            response["Vary"] = "Origin"
            response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"
            response["Access-Control-Max-Age"] = "3600"
        return response

