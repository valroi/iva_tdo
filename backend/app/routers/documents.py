from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, users_by_company_roles
from app.models import (
    Comment,
    Document,
    MDRRecord,
    Notification,
    Revision,
    User,
    UserRole,
)
from app.schemas import (
    CommentCreate,
    CommentRead,
    CommentResponse,
    DocumentCreate,
    DocumentRead,
    RevisionCreate,
    RevisionRead,
)

router = APIRouter()


@router.get("/documents", response_model=list[DocumentRead])
def list_documents(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Document).order_by(Document.id.desc()).all()


@router.get("/documents/{document_id}", response_model=DocumentRead)
def get_document(document_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.post("/documents", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == payload.mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    doc = Document(
        **payload.model_dump(),
        created_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/documents/{document_id}/revisions", response_model=list[RevisionRead])
def list_revisions(
    document_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return (
        db.query(Revision)
        .filter(Revision.document_id == document_id)
        .order_by(Revision.id.desc())
        .all()
    )


@router.get("/revisions/{revision_id}", response_model=RevisionRead)
def get_revision(revision_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rev = db.query(Revision).filter(Revision.id == revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return rev


@router.post("/revisions", response_model=RevisionRead, status_code=status.HTTP_201_CREATED)
def create_revision(
    payload: RevisionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == payload.document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    rev = Revision(**payload.model_dump())
    db.add(rev)
    db.flush()

    owner_receivers = users_by_company_roles(
        db,
        company_roles=[UserRole.owner_manager, UserRole.owner_reviewer],
    )
    for receiver in owner_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="NEW_REVISION",
                message=f"New revision {rev.revision_code} for document {doc.document_num}",
            )
        )

    db.commit()
    db.refresh(rev)
    return rev


@router.get("/revisions/{revision_id}/comments", response_model=list[CommentRead])
def list_comments(
    revision_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rev = db.query(Revision).filter(Revision.id == revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    return (
        db.query(Comment)
        .filter(Comment.revision_id == revision_id)
        .order_by(Comment.id.asc())
        .all()
    )


@router.post("/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED)
def create_comment(
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rev = db.query(Revision).filter(Revision.id == payload.revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    comment = Comment(**payload.model_dump(), author_id=current_user.id)
    db.add(comment)
    db.flush()

    contractor_receivers = users_by_company_roles(
        db,
        company_roles=[UserRole.contractor_manager, UserRole.contractor_author],
    )
    for receiver in contractor_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="NEW_COMMENT",
                message=f"New comment on revision {rev.revision_code}",
            )
        )

    db.commit()
    db.refresh(comment)
    return comment


@router.post("/comments/{comment_id}/response", response_model=CommentRead)
def respond_comment(
    comment_id: int,
    payload: CommentResponse,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    parent = db.query(Comment).filter(Comment.id == comment_id).first()
    if not parent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    response = Comment(
        revision_id=parent.revision_id,
        parent_id=parent.id,
        author_id=current_user.id,
        text=payload.text,
        status=payload.status,
    )
    parent.status = payload.status

    db.add(response)
    db.add(parent)

    owner_receivers = users_by_company_roles(
        db,
        company_roles=[UserRole.owner_manager, UserRole.owner_reviewer],
    )
    for receiver in owner_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="COMMENT_RESPONSE",
                message=f"Response received for comment #{parent.id}",
            )
        )

    db.commit()
    db.refresh(response)
    return response
