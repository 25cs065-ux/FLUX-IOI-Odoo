from fastapi import Header, HTTPException, status
from typing import Optional

def require_admin(x_user_role: Optional[str] = Header(None, alias="X-User-Role")):
    """
    Validates that the incoming request has admin privileges.
    Checks X-User-Role header or parsed JWT payload role.
    """
    if not x_user_role or x_user_role.lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation requires admin privileges"
        )
    return x_user_role
