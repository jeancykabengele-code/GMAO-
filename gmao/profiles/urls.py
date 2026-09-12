from django.urls import path

from .notifications import mark_all_notifications_read, mark_notification_read, notification_collection
from .records import record_collection, record_detail
from .sites import site_collection, site_detail
from .users_admin import profile_collection, profile_delete, profile_detail
from .views import current_user


urlpatterns = [
    path('me', current_user),
    path('notifications', notification_collection),
    path('notifications/read-all', mark_all_notifications_read),
    path('notifications/<uuid:notification_id>/read', mark_notification_read),
    path('sites', site_collection),
    path('sites/<path:site_name>', site_detail),
    path('profiles', profile_collection),
    path('profiles/<uuid:profile_id>', profile_detail),
    path('profiles/<uuid:profile_id>/delete', profile_delete),
    path("records/<slug:resource>", record_collection),
    path("records/<slug:resource>/<uuid:record_id>", record_detail),
]