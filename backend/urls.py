from django.contrib import admin
from django.http import JsonResponse
from django.urls import path
from django.http import JsonResponse
from rest_framework.decorators import api_view


def health(_req):
    return JsonResponse({"status": "ok"})


@api_view(["GET"])
def ping(_req):
    return JsonResponse({"pong": True})



def health(_req):
    return JsonResponse({"status": "ok"})


def ping(_req):
    return JsonResponse({"pong": True})



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
