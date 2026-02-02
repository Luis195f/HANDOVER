# backend/api/tests/utils.py
from backend.security.auth import Auth0User

def make_user_with_perms(perms):
    return Auth0User(
        sub="test|user",
        claims={
            "permissions": perms,
            # Si tu NurseOrAdminPermission exige algo más, agrégalo aquí:
            # "roles": ["nurse"], etc.
        },
    )
