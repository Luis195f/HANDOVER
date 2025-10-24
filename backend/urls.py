from django.contrib import admin
from django.http import JsonResponse
from django.urls import path


def health(_req):
    return JsonResponse({"status": "ok"})


def ping(_req):
    return JsonResponse({"pong": True})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("", health),
    path("api/ping", ping),
    path("api/ping/", ping),
]
