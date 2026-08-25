import json
import logging
import time
import urllib.error
import urllib.request
from functools import lru_cache

import jwt
import truststore
from django.conf import settings


# Sur Windows, utiliser le magasin de certificats du système pour Supabase.
truststore.inject_into_ssl()


logger = logging.getLogger(__name__)


class SupabaseAuthenticationError(Exception):
    pass


@lru_cache(maxsize=1)
def jwks_client():
    return jwt.PyJWKClient(settings.SUPABASE_JWKS_URL, cache_keys=True, lifespan=600)


def verify_supabase_token(token: str) -> dict:
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError as error:
        raise SupabaseAuthenticationError("Le jeton Supabase est mal formé.") from error

    if algorithm in {"ES256", "RS256"}:
        return _verify_asymmetric_token(token, algorithm)
    if algorithm == "HS256":
        return _verify_token_with_auth_server(token)
    raise SupabaseAuthenticationError("L’algorithme du jeton Supabase n’est pas accepté.")


def _verify_asymmetric_token(token: str, algorithm: str) -> dict:
    try:
        signing_key = jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            audience=settings.SUPABASE_AUTH_AUDIENCE,
            issuer=settings.SUPABASE_AUTH_ISSUER,
            options={"require": ["exp", "iss", "sub"]},
            leeway=30,
        )
    except jwt.PyJWTError as error:
        # Supabase reste l'autorite finale. Ce secours couvre notamment une
        # rotation de cle ou une variation de claims sans accepter un jeton
        # non valide : /auth/v1/user verifie lui-meme la session cote Supabase.
        logger.warning(
            "Validation JWT locale refusee (%s): %s. Verification distante Supabase.",
            type(error).__name__,
            error,
        )
        return _verify_token_with_auth_server(token)


def _verify_token_with_auth_server(token: str) -> dict:
    request = urllib.request.Request(
        f"{settings.SUPABASE_AUTH_URL}/auth/v1/user",
        headers={
            "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            user = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise SupabaseAuthenticationError("Supabase Auth a refusé ou n’a pas pu vérifier la session.") from error

    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as error:
        raise SupabaseAuthenticationError("Le jeton Supabase est mal formé.") from error
    _validate_remote_claims(claims, user)
    return claims


def _validate_remote_claims(claims: dict, user: dict) -> None:
    audience = claims.get("aud")
    accepted_audience = (
        settings.SUPABASE_AUTH_AUDIENCE in audience
        if isinstance(audience, list)
        else audience == settings.SUPABASE_AUTH_AUDIENCE
    )
    if claims.get("iss") != settings.SUPABASE_AUTH_ISSUER or not accepted_audience:
        raise SupabaseAuthenticationError("L’émetteur ou l’audience du jeton Supabase est invalide.")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] <= time.time():
        raise SupabaseAuthenticationError("La session Supabase a expiré.")
    if not claims.get("sub") or claims["sub"] != user.get("id"):
        raise SupabaseAuthenticationError("L’identité du jeton Supabase ne correspond pas à l’utilisateur.")

