from fastapi import APIRouter

from app.routers import auth, documents, mdr, notifications, projects, review_center, transmittals, users, workflow

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(mdr.router, prefix="/mdr", tags=["mdr"])
api_router.include_router(documents.router, tags=["documents"])
api_router.include_router(transmittals.router, tags=["transmittals"])
api_router.include_router(review_center.router, tags=["review-center"])
api_router.include_router(workflow.router, prefix="/workflow", tags=["workflow"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
