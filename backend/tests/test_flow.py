import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_tdo.db"
os.environ["FIRST_ADMIN_EMAIL"] = "admin@example.com"
os.environ["FIRST_ADMIN_PASSWORD"] = "admin123"
os.environ["SECRET_KEY"] = "test-secret"

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_main_flow():
    db_file = Path("test_tdo.db")
    if db_file.exists():
        db_file.unlink()

    Base.metadata.create_all(bind=engine)

    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
        )
        assert login.status_code == 200, login.text
        admin_access = login.json()["access_token"]

        contractor = client.post(
            "/api/v1/users",
            json={
                "email": "contractor@example.com",
                "password": "password1",
                "full_name": "Contractor User",
                "company_type": "contractor",
                "role": "contractor_manager",
            },
            headers=_auth_header(admin_access),
        )
        assert contractor.status_code == 201, contractor.text
        contractor_id = contractor.json()["id"]

        owner = client.post(
            "/api/v1/users",
            json={
                "email": "owner@example.com",
                "password": "password1",
                "full_name": "Owner User",
                "company_type": "owner",
                "role": "owner_reviewer",
            },
            headers=_auth_header(admin_access),
        )
        assert owner.status_code == 201, owner.text
        owner_id = owner.json()["id"]

        contractor_login = client.post(
            "/api/v1/auth/login",
            json={"email": "contractor@example.com", "password": "password1"},
        )
        assert contractor_login.status_code == 200
        contractor_access = contractor_login.json()["access_token"]

        owner_login = client.post(
            "/api/v1/auth/login",
            json={"email": "owner@example.com", "password": "password1"},
        )
        assert owner_login.status_code == 200
        owner_access = owner_login.json()["access_token"]

        mdr = client.post(
            "/api/v1/mdr",
            json={
                "document_key": "DOC-001",
                "project_code": "IVA",
                "originator_code": "CTR",
                "category": "PIPING",
                "title_object": "Unit-1",
                "discipline_code": "PD",
                "doc_type": "DRAWING",
                "serial_number": "0001",
                "doc_number": "IVA-PD-0001",
                "doc_name": "Piping layout",
                "progress_percent": 10,
                "doc_weight": 1.2,
                "dates": {},
                "status": "DRAFT",
                "contractor_responsible_id": contractor_id,
                "owner_responsible_id": owner_id,
                "is_confidential": False,
            },
            headers=_auth_header(contractor_access),
        )
        assert mdr.status_code == 201, mdr.text
        mdr_id = mdr.json()["id"]

        document = client.post(
            "/api/v1/documents",
            json={
                "mdr_id": mdr_id,
                "document_num": "IVA-PD-0001",
                "title": "Piping layout",
                "discipline": "Piping",
                "weight": 1.2,
            },
            headers=_auth_header(contractor_access),
        )
        assert document.status_code == 201, document.text
        document_id = document.json()["id"]

        revision = client.post(
            "/api/v1/revisions",
            json={
                "document_id": document_id,
                "revision_code": "A",
                "issue_purpose": "IFR",
                "status": "SUBMITTED",
                "trm_number": "TRM-001",
                "file_path": "IVA/IVA-PD-0001/A/drawing.pdf",
            },
            headers=_auth_header(contractor_access),
        )
        assert revision.status_code == 201, revision.text
        revision_id = revision.json()["id"]

        comment = client.post(
            "/api/v1/comments",
            json={
                "revision_id": revision_id,
                "text": "Please check dimension at page 2",
                "status": "OPEN",
                "page": 2,
                "area_x": 10,
                "area_y": 15,
                "area_w": 120,
                "area_h": 40,
            },
            headers=_auth_header(owner_access),
        )
        assert comment.status_code == 201, comment.text
        comment_id = comment.json()["id"]

        response = client.post(
            f"/api/v1/comments/{comment_id}/response",
            json={"text": "Corrected in Rev.B", "status": "IN_PROGRESS"},
            headers=_auth_header(contractor_access),
        )
        assert response.status_code == 200, response.text

        notifications = client.get(
            "/api/v1/notifications",
            headers=_auth_header(owner_access),
        )
        assert notifications.status_code == 200
        assert len(notifications.json()) >= 1
