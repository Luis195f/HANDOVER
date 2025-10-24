from django.contrib import admin
from django.http import JsonResponse
from django.urls import path


def health(_):
    return JsonResponse({"status": "ok"})


def ping(_):
    return JsonResponse({"pong": True})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("", health),
    path("api/ping", ping),
    path("api/ping/", ping),
]
