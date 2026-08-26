from django.urls import path

from .notifications import mark_all_notifications_read, mark_notification_read, notification_collection
from .records import record_collection, record_detail
from .views import current_user


urlpatterns = [
    path('me', current_user),
    path('notifications', notification_collection),
    path('notifications/read-all', mark_all_notifications_read),
    path('notifications/<uuid:notification_id>/read', mark_notification_read),
    path("records/<slug:resource>", record_collection),
    path("records/<slug:resource>/<uuid:record_id>", record_detail),
]