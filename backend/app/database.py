import logging
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models lazily here so SQLAlchemy metadata is fully populated
    # before create_all, without creating circular imports at module load time.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_projects_document_category_column()
    _ensure_users_permissions_column()
    _ensure_users_company_code_column()
    _ensure_notifications_context_columns()
    _ensure_revisions_author_column()
    _ensure_comments_workflow_columns()
    _ensure_mdr_planned_start_column()
    _ensure_document_attachments_revision_column()
    _ensure_postgres_role_enum_values()


def _ensure_projects_document_category_column() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "projects" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "document_category" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE projects ADD COLUMN document_category VARCHAR(20)"))


def _ensure_postgres_role_enum_values() -> None:
    # Legacy Postgres deployments may have an old userrole enum without "user".
    if not engine.dialect.name.startswith("postgresql"):
        return
    with engine.begin() as connection:
        try:
            connection.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'user'"))
        except Exception as exc:
            logger.warning("Failed to ensure postgres enum userrole has 'user': %s", exc)


def _ensure_users_permissions_column() -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "permissions" in columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN permissions JSON DEFAULT '{}'"))


def _ensure_users_company_code_column() -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "company_code" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN company_code VARCHAR(10)"))


def _ensure_notifications_context_columns() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "notifications" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("notifications")}
    statements: list[str] = []
    if "project_code" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN project_code VARCHAR(50)")
    if "document_num" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN document_num VARCHAR(120)")
    if "revision_id" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN revision_id INTEGER")
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_revisions_author_column() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "revisions" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("revisions")}
    if "author_id" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE revisions ADD COLUMN author_id INTEGER"))


def _ensure_comments_workflow_columns() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "comments" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("comments")}
    statements: list[str] = []
    if "is_published_to_contractor" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN is_published_to_contractor BOOLEAN DEFAULT FALSE")
    if "backlog_status" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN backlog_status VARCHAR(30)")
    if "review_code" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN review_code VARCHAR(2)")
    if "contractor_status" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN contractor_status VARCHAR(1)")
    if "in_crs" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN in_crs BOOLEAN DEFAULT FALSE")
    if "crs_sent_at" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN crs_sent_at DATETIME")
    if "crs_number" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN crs_number VARCHAR(60)")
    if "carry_finalized" not in columns:
        statements.append("ALTER TABLE comments ADD COLUMN carry_finalized BOOLEAN DEFAULT FALSE")
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_mdr_planned_start_column() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "mdr_records" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("mdr_records")}
    if "planned_dev_start" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE mdr_records ADD COLUMN planned_dev_start DATE"))


def _ensure_document_attachments_revision_column() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "document_attachments" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("document_attachments")}
    if "revision_id" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE document_attachments ADD COLUMN revision_id INTEGER"))
