from django.urls import include, path

from profiles.views import database_health, health


urlpatterns = [
    path("health", health),
    path("health/database", database_health),
    path("api/", include("profiles.urls")),
]

