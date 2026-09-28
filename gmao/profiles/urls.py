from django.urls import path

from .audit import audit_collection
from .backups import backup_export
from .notifications import mark_all_notifications_read, mark_notification_read, notification_collection
from .records import record_collection, record_detail
from .sites import site_collection, site_detail
from .users_admin import profile_collection, profile_delete, profile_detail, profile_password
from .views import current_user, local_change_password, local_login, local_logout


urlpatterns = [
    path('auth/local/login', local_login),
    path('auth/local/logout', local_logout),
    path('auth/local/change-password', local_change_password),
    path('me', current_user),
    path('backups/export', backup_export),
    path('notifications', notification_collection),
    path('notifications/read-all', mark_all_notifications_read),
    path('notifications/<uuid:notification_id>/read', mark_notification_read),
    path('sites', site_collection),
    path('sites/<path:site_name>', site_detail),
    path('profiles', profile_collection),
    path('profiles/<uuid:profile_id>', profile_detail),
    path('profiles/<uuid:profile_id>/delete', profile_delete),
    path('profiles/<uuid:profile_id>/password', profile_password),
    path('audit-logs', audit_collection),
    path("records/<slug:resource>", record_collection),
    path("records/<slug:resource>/<uuid:record_id>", record_detail),
]
