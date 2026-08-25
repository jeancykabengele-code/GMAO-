from django.urls import path

from .records import record_collection, record_detail
from .views import current_user


urlpatterns = [
    path("me", current_user),
    path("records/<slug:resource>", record_collection),
    path("records/<slug:resource>/<uuid:record_id>", record_detail),
]