from fastapi import APIRouter, Depends

from app.deps import require_permissions

from app.routers import (
    auth,
    documents,
    mdr,
    notifications,
    projects,
    smart_upload,
    users,
    vendor_public,
    vendors,
    workflow,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(mdr.router, prefix="/mdr", tags=["mdr"])
api_router.include_router(documents.router, tags=["documents"])
api_router.include_router(smart_upload.router, tags=["smart-upload"])
api_router.include_router(workflow.router, prefix="/workflow", tags=["workflow"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(
    vendors.router,
    tags=["vendors"],
    dependencies=[Depends(require_permissions("can_access_vendors"))],
)
# Гостевой роутер подрядчиков — отдельная изолированная авторизация
# (свой vendor-токен, БЕЗ требования can_access_vendors).
api_router.include_router(vendor_public.router, tags=["vendor-public"])
