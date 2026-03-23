from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, is_main_admin
from app.models import (
    CompanyType,
    Project,
    ProjectMember,
    ProjectMemberRole,
    ProjectReference,
    User,
)
from app.schemas import (
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectRead,
    ProjectReferenceCreate,
    ProjectReferenceRead,
    ProjectReferenceUpdate,
    ProjectUpdate,
)

router = APIRouter()

DEFAULT_PROJECT_REFERENCES: list[tuple[str, str, str]] = [
    ("discipline", "PD", "Технология"),
    ("discipline", "AR", "Архитектура"),
    ("discipline", "KM", "Конструкции металлические"),
    ("document_type", "DRAWING", "Чертеж"),
    ("document_type", "SPEC", "Спецификация"),
    ("document_type", "REPORT", "Отчет"),
    ("document_class", "IFR", "Issue For Review"),
    ("document_class", "IFD", "Issue For Design"),
]


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _ensure_project_access(db: Session, project_id: int, user: User) -> None:
    if user.role.value == "admin":
        return

    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No project access")


def _is_contractor_tdo_lead(db: Session, project_id: int, user_id: int) -> bool:
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .first()
    )
    if member is None:
        return False
    return member.member_role == ProjectMemberRole.contractor_tdo_lead or member.can_manage_contractor_users


@router.get("", response_model=list[ProjectRead])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "admin":
        return db.query(Project).order_by(Project.created_at.desc()).all()

    return (
        db.query(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .filter(ProjectMember.user_id == current_user.id)
        .order_by(Project.created_at.desc())
        .all()
    )


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_main_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main admin required")

    existing = db.query(Project).filter(Project.code == payload.code).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project code already exists")

    project = Project(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        created_by_id=current_user.id,
    )
    db.add(project)
    db.flush()

    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=current_user.id,
            member_role=ProjectMemberRole.main_admin,
            can_manage_contractor_users=True,
        )
    )

    if payload.contractor_tdo_manager_user_id is not None:
        contractor_user = (
            db.query(User).filter(User.id == payload.contractor_tdo_manager_user_id).first()
        )
        if contractor_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contractor manager user not found")
        if contractor_user.company_type != CompanyType.contractor:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contractor manager must belong to contractor side",
            )

        db.add(
            ProjectMember(
                project_id=project.id,
                user_id=contractor_user.id,
                member_role=ProjectMemberRole.contractor_tdo_lead,
                can_manage_contractor_users=True,
            )
        )

    for ref_type, code, value in DEFAULT_PROJECT_REFERENCES:
        db.add(
            ProjectReference(
                project_id=project.id,
                ref_type=ref_type,
                code=code,
                value=value,
                is_active=True,
            )
        )

    db.commit()
    db.refresh(project)
    return project


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_main_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main admin required")

    project = _get_project_or_404(db, project_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)

    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}/members", response_model=list[ProjectMemberRead])
def list_project_members(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_project_access(db, project_id, current_user)
    _get_project_or_404(db, project_id)
    return (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.id.asc())
        .all()
    )


@router.post("/{project_id}/members", response_model=ProjectMemberRead, status_code=status.HTTP_201_CREATED)
def add_project_member(
    project_id: int,
    payload: ProjectMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(db, project_id)

    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == payload.user_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already in project")

    can_manage = False
    if is_main_admin(current_user):
        can_manage = payload.member_role == ProjectMemberRole.contractor_tdo_lead
    elif _is_contractor_tdo_lead(db, project_id, current_user.id):
        if target_user.company_type != CompanyType.contractor:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="TDO lead can add only contractor users",
            )
        if payload.member_role not in {
            ProjectMemberRole.contractor_member,
            ProjectMemberRole.contractor_tdo_lead,
        }:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="TDO lead can assign only contractor roles",
            )
        can_manage = payload.member_role == ProjectMemberRole.contractor_tdo_lead
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No rights to add project members")

    member = ProjectMember(
        project_id=project_id,
        user_id=payload.user_id,
        member_role=payload.member_role,
        can_manage_contractor_users=can_manage,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.get("/{project_id}/references", response_model=list[ProjectReferenceRead])
def list_project_references(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ref_type: str | None = Query(default=None),
):
    _ensure_project_access(db, project_id, current_user)
    _get_project_or_404(db, project_id)

    query = db.query(ProjectReference).filter(ProjectReference.project_id == project_id)
    if ref_type:
        query = query.filter(ProjectReference.ref_type == ref_type)

    return query.order_by(ProjectReference.ref_type.asc(), ProjectReference.code.asc()).all()


@router.post("/{project_id}/references", response_model=ProjectReferenceRead, status_code=status.HTTP_201_CREATED)
def create_project_reference(
    project_id: int,
    payload: ProjectReferenceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_main_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main admin required")

    _get_project_or_404(db, project_id)

    exists = (
        db.query(ProjectReference)
        .filter(
            ProjectReference.project_id == project_id,
            ProjectReference.ref_type == payload.ref_type,
            ProjectReference.code == payload.code,
        )
        .first()
    )
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Reference with this code already exists")

    item = ProjectReference(project_id=project_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/references/{reference_id}", response_model=ProjectReferenceRead)
def update_project_reference(
    reference_id: int,
    payload: ProjectReferenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_main_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main admin required")

    item = db.query(ProjectReference).filter(ProjectReference.id == reference_id).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    db.add(item)
    db.commit()
    db.refresh(item)
    return item
