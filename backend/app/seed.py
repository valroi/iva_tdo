from sqlalchemy.orm import Session
from sqlalchemy.exc import DataError, ProgrammingError

from app.auth import get_password_hash
from app.config import get_settings
from app.deps import default_permissions_for_role
from app.models import CompanyType, Project, ProjectMember, ProjectMemberRole, ProjectReference, ReviewMatrixMember, User, UserRole, WorkflowStatus

DEFAULT_PROJECT_CODE = "IMP"
DEFAULT_PROJECT_NAME = "Ива Марис — корневой проект"
DEFAULT_PROJECT_CATEGORY = "PD"

DEFAULT_TITLE_OBJECTS: list[tuple[str, str]] = [
    ("0001", "Ограждение комплекса"),
    ("0002", "Вертикальная планировка"),
    ("1001", "Открытая насосная"),
    ("1002", "Наружная установка риформинга"),
    ("1501", "Открытая насосная"),
    ("2001", "Здание компрессорной"),
    ("2501", "Установка извлечения водорода (КЦА)"),
    ("3001", "Открытая насосная №1"),
    ("4001", "Промежуточный склад метанола"),
    ("4501", "Здание компрессорной ВРУ"),
    ("5001", "Установка очистки конденсата"),
    ("6501", "Вспомогательный котел (ABP)"),
    ("7001", "Открытая насосная с факельным сепаратором"),
    ("7510", "Водоснабжение"),
    ("7520", "Канализация"),
    ("7530", "Теплоснабжение"),
    ("7540", "Газоснабжение"),
    ("7560", "Электроснабжение"),
    ("7570", "Сети связи, автоматизация и охрана"),
    ("8001", "Паротурбинный генератор (STG)"),
    ("8601", "Водогрейная котельная"),
    ("8701", "Главная подстанция 110 кВ"),
    ("8801", "Здание управления"),
    ("8901", "Здание подстанции (SS-01)"),
    ("9001", "Эстакада №1"),
    ("9501", "Административный корпус"),
]

DEFAULT_PD_SECTIONS: list[tuple[str, str]] = [
    ("PZ", "Пояснительная записка"),
    ("PZU", "Схема планировочной организации земельного участка"),
    ("AR", "Архитектурные решения"),
    ("KR", "Конструктивные решения"),
    ("IOS", "Инженерное оборудование и сети"),
    ("IOS1", "Система электроснабжения"),
    ("IOS2", "Система водоснабжения"),
    ("IOS3", "Система водоотведения"),
    ("IOS4", "Отопление, вентиляция, кондиционирование"),
    ("IOS5", "Сети связи"),
    ("IOS6", "Система газоснабжения"),
    ("TR", "Технологические решения"),
    ("POS", "Проект организации строительства"),
    ("OOS", "Охрана окружающей среды"),
    ("PB", "Пожарная безопасность"),
    ("TBE", "Безопасная эксплуатация"),
    ("ODI", "Доступ инвалидов"),
    ("SM", "Смета"),
    ("IBTSO", "Информационная безопасность ТСО"),
    ("KITSO", "Комплекс инженерно-технических средств охраны"),
    ("GOCHS", "Мероприятия ГО и ЧС"),
    ("DPB", "Декларация промышленной безопасности"),
]

DEFAULT_MARKS: list[tuple[str, str, str]] = [
    ("THM", "Технология производства механическая", "ME"),
    ("TM", "Монтажно-технологические решения", "PI"),
    ("PT", "Пожаротушение", "WS"),
    ("NVK", "Наружные сети водопровода и канализации", "WS"),
    ("VK", "Внутренние системы водоснабжения и канализации", "WS"),
    ("KM", "Конструкции металлические", "SS"),
    ("KJ", "Конструкции железобетонные", "CI"),
    ("AS", "Архитектурно-строительные решения", "CI"),
    ("AR", "Архитектурные решения", "AR"),
    ("ER", "Электротехнические решения", "EL"),
    ("EG", "Молниезащита и заземление", "EL"),
    ("EM", "Электрооборудование силовое", "EL"),
    ("EO", "Электроосвещение", "EL"),
    ("AK", "Автоматизация комплексная", "IN"),
    ("AUP", "Автоматические установки пожаротушения", "IN"),
    ("APS", "Автоматизация пожарной сигнализации", "IN"),
    ("RT", "Радиосвязь, радиовещание, ТВ", "TE"),
    ("SS", "Связь и сигнализация", "TE"),
    ("OVK", "Отопление, вентиляция, кондиционирование", "HV"),
]

DEMO_ROLE_PRESET_PERMISSIONS: dict[str, dict[str, bool]] = {
    "con_tdo@mail.ru": {
        "can_manage_users": False,
        "can_manage_projects": False,
        "can_edit_project_references": False,
        "can_manage_review_matrix": False,
        "can_view_reporting": False,
        "can_create_mdr": True,
        "can_upload_files": True,
        "can_comment": True,
        "can_raise_comments": False,
        "can_respond_comments": True,
        "can_publish_comments": False,
        "can_edit_workflow_statuses": False,
        "can_process_tdo_queue": True,
    },
    "dev@mail.ru": {
        "can_manage_users": False,
        "can_manage_projects": False,
        "can_edit_project_references": False,
        "can_manage_review_matrix": False,
        "can_view_reporting": False,
        "can_create_mdr": False,
        "can_upload_files": True,
        "can_comment": True,
        "can_raise_comments": False,
        "can_respond_comments": True,
        "can_publish_comments": False,
        "can_edit_workflow_statuses": False,
        "can_process_tdo_queue": False,
    },
    "lr@mail.ru": {
        "can_manage_users": False,
        "can_manage_projects": False,
        "can_edit_project_references": False,
        "can_manage_review_matrix": False,
        "can_view_reporting": True,
        "can_create_mdr": False,
        "can_upload_files": False,
        "can_comment": True,
        "can_raise_comments": True,
        "can_respond_comments": False,
        "can_publish_comments": True,
        "can_edit_workflow_statuses": False,
        "can_process_tdo_queue": False,
    },
    "r@mail.ru": {
        "can_manage_users": False,
        "can_manage_projects": False,
        "can_edit_project_references": False,
        "can_manage_review_matrix": False,
        "can_view_reporting": True,
        "can_create_mdr": False,
        "can_upload_files": False,
        "can_comment": True,
        "can_raise_comments": True,
        "can_respond_comments": False,
        "can_publish_comments": False,
        "can_edit_workflow_statuses": False,
        "can_process_tdo_queue": False,
    },
}


def seed_default_data(db: Session) -> None:
    settings = get_settings()

    admin = db.query(User).filter(User.email == settings.first_admin_email).first()
    if admin is None:
        admin = User(
            email=settings.first_admin_email,
            hashed_password=get_password_hash(settings.first_admin_password),
            full_name=settings.first_admin_full_name,
            company_type=CompanyType.admin,
            role=UserRole.admin,
            permissions=default_permissions_for_role(UserRole.admin),
            is_active=True,
        )
        db.add(admin)
    elif settings.force_admin_reset:
        # Аварийное восстановление доступа: FORCE_ADMIN_RESET=true в .env →
        # пароль/права админа сбрасываются к значениям из env. По умолчанию
        # ВЫКЛЮЧЕНО: раньше пароль затирался при КАЖДОМ рестарте backend,
        # и смена пароля через UI жила до первого обновления.
        admin.hashed_password = get_password_hash(settings.first_admin_password)
        admin.role = UserRole.admin
        admin.permissions = default_permissions_for_role(UserRole.admin)
        admin.company_type = CompanyType.admin
        admin.is_active = True
        db.add(admin)

    # NOTE:
    # On some legacy Postgres deployments enum type "userrole" may not yet include
    # value "user". In that case, hard migration on startup crashes the whole app.
    # Keep startup resilient: try migration, and if enum is not ready - skip for now.
    #
    # Раньше здесь вместе с ролью сбрасывались permissions у всех non-admin
    # пользователей до дефолтных — это убивало любые правки прав через
    # «Администрирование» при каждом рестарте. Теперь миграция трогает ТОЛЬКО
    # роль, права остаются как админ их настроил в UI.
    try:
        with db.begin_nested():
            db.query(User).filter(User.role != UserRole.admin).update(
                {User.role: UserRole.user}
            )
    except (DataError, ProgrammingError):
        # Keep startup resilient on legacy enum schemas without rolling back
        # already-prepared admin updates in the outer transaction.
        pass

    if settings.main_admin_email != settings.first_admin_email:
        main_admin = db.query(User).filter(User.email == settings.main_admin_email).first()
        if main_admin is None:
            db.add(
                User(
                    email=settings.main_admin_email,
                    hashed_password=get_password_hash(settings.first_admin_password),
                    full_name="Main Administrator",
                    company_type=CompanyType.admin,
                    role=UserRole.admin,
                    permissions=default_permissions_for_role(UserRole.admin),
                    is_active=True,
                )
            )
        elif settings.force_admin_reset:
            # См. комментарий выше — сброс только по явному флагу.
            main_admin.hashed_password = get_password_hash(settings.first_admin_password)
            main_admin.role = UserRole.admin
            main_admin.permissions = default_permissions_for_role(UserRole.admin)
            main_admin.company_type = CompanyType.admin
            main_admin.is_active = True
            db.add(main_admin)

    project = db.query(Project).filter(Project.code == DEFAULT_PROJECT_CODE).first()
    if project is None and admin is not None:
        project = Project(
            code=DEFAULT_PROJECT_CODE,
            name=DEFAULT_PROJECT_NAME,
            document_category=DEFAULT_PROJECT_CATEGORY,
            created_by_id=admin.id,
            description="Корневой проект для проектной документации",
        )
        db.add(project)
        db.flush()
    elif project is not None:
        project.document_category = DEFAULT_PROJECT_CATEGORY
        if not project.name:
            project.name = DEFAULT_PROJECT_NAME
        db.add(project)

    if project is not None:
        def upsert_ref(ref_type: str, code: str, value: str) -> None:
            item = (
                db.query(ProjectReference)
                .filter(
                    ProjectReference.project_id == project.id,
                    ProjectReference.ref_type == ref_type,
                    ProjectReference.code == code,
                )
                .first()
            )
            if item is None:
                db.add(
                    ProjectReference(
                        project_id=project.id,
                        ref_type=ref_type,
                        code=code,
                        value=value,
                        is_active=True,
                    )
                )
            else:
                item.value = value
                item.is_active = True
                db.add(item)

        upsert_ref("document_category", "PD", "Проектная документация")
        upsert_ref("document_category", "SE", "Инженерные изыскания")
        for code, value in DEFAULT_TITLE_OBJECTS:
            upsert_ref("title_object", code, value)
        for code, value in DEFAULT_PD_SECTIONS:
            upsert_ref("pd_section", code, value)
        # Справочник видов SE-отчётов: сеем ТОЛЬКО если пуст — на проде он
        # наполнен вручную, upsert перезаписал бы названия пользователя.
        has_se = (
            db.query(ProjectReference.id)
            .filter(ProjectReference.project_id == project.id, ProjectReference.ref_type == "se_reporting_type")
            .first()
        )
        if has_se is None:
            for code, value in [
                ("IGDI", "Инженерно-геодезические изыскания"),
                ("IGI", "Инженерно-геологические изыскания"),
                ("IGMI", "Инженерно-гидрометеорологические изыскания"),
                ("IEI", "Инженерно-экологические изыскания"),
            ]:
                upsert_ref("se_reporting_type", code, value)
        for mark_code, mark_name, discipline_code in DEFAULT_MARKS:
            upsert_ref("mark", mark_code, mark_name)
            upsert_ref("mark_discipline", mark_code, discipline_code)

    demo_user_by_email: dict[str, User] = {}

    if settings.seed_demo_users:
        demo_users = [
            ("con_tdo@mail.ru", "Рук тдо подрядчика", CompanyType.contractor),
            ("dev@mail.ru", "Разработчик чертежей подрядчика", CompanyType.contractor),
            ("lr@mail.ru", "Лидер Ревьювер Заказчика", CompanyType.owner),
            ("r@mail.ru", "Простой ревьювер заказчика", CompanyType.owner),
        ]
        for email, full_name, company_type in demo_users:
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                # Новый демо-пользователь: создаём с пресетом прав по роли.
                user = User(
                    email=email,
                    hashed_password=get_password_hash("Password_123!"),
                    full_name=full_name,
                    company_code=("CTR" if company_type == CompanyType.contractor else "OWN"),
                    company_type=company_type,
                    role=UserRole.user,
                    permissions=DEMO_ROLE_PRESET_PERMISSIONS.get(
                        email, default_permissions_for_role(UserRole.user)
                    ),
                    is_active=True,
                )
                db.add(user)
            else:
                # Демо-пользователь уже существует. Обновляем только базовые
                # поля (имя, тип компании, пароль, активность). НИКОГДА не
                # перезаписываем permissions — это уничтожало правки админа
                # через UI при каждом рестарте контейнера. Если в будущем
                # понадобится переразлить пресеты — это будет одноразовая
                # ручная команда, а не автоматический seed.
                user.hashed_password = get_password_hash("Password_123!")
                user.full_name = full_name
                user.company_type = company_type
                user.company_code = user.company_code or ("CTR" if company_type == CompanyType.contractor else "OWN")
                user.role = UserRole.user
                user.is_active = True
                db.add(user)
            demo_user_by_email[email] = user
        # Ensure newly created users have IDs before creating memberships.
        db.flush()

    if project is not None:
        def upsert_member(email: str, role: ProjectMemberRole, can_manage: bool = False) -> None:
            user = demo_user_by_email.get(email)
            if user is None or user.id is None:
                return
            item = (
                db.query(ProjectMember)
                .filter(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id)
                .first()
            )
            if item is None:
                item = ProjectMember(
                    project_id=project.id,
                    user_id=user.id,
                    member_role=role,
                    can_manage_contractor_users=can_manage,
                )
            else:
                item.member_role = role
                item.can_manage_contractor_users = can_manage
            db.add(item)

        upsert_member('tdolead_ctr@mail.ru', ProjectMemberRole.contractor_tdo_lead, True)
        upsert_member('dev_ctr@mail.ru', ProjectMemberRole.contractor_member, False)
        upsert_member('owner_lr@mail.ru', ProjectMemberRole.owner_member, False)
        upsert_member('owner_rev@mail.ru', ProjectMemberRole.owner_member, False)

        owner_lr = demo_user_by_email.get('owner_lr@mail.ru')
        owner_r = demo_user_by_email.get('owner_rev@mail.ru')
        if owner_lr is not None:
            for discipline, state in [('IOS', 'LR'), ('AR', 'LR')]:
                row = (
                    db.query(ReviewMatrixMember)
                    .filter(
                        ReviewMatrixMember.project_id == project.id,
                        ReviewMatrixMember.user_id == owner_lr.id,
                        ReviewMatrixMember.discipline_code == discipline,
                        ReviewMatrixMember.level == 1,
                        ReviewMatrixMember.state == state,
                    )
                    .first()
                )
                if row is None:
                    db.add(
                        ReviewMatrixMember(
                            project_id=project.id,
                            user_id=owner_lr.id,
                            discipline_code=discipline,
                            doc_type='DRAWING',
                            level=1,
                            state=state,
                        )
                    )
        if owner_r is not None:
            for discipline, state in [('IOS', 'R'), ('AR', 'R')]:
                row = (
                    db.query(ReviewMatrixMember)
                    .filter(
                        ReviewMatrixMember.project_id == project.id,
                        ReviewMatrixMember.user_id == owner_r.id,
                        ReviewMatrixMember.discipline_code == discipline,
                        ReviewMatrixMember.level == 1,
                        ReviewMatrixMember.state == state,
                    )
                    .first()
                )
                if row is None:
                    db.add(
                        ReviewMatrixMember(
                            project_id=project.id,
                            user_id=owner_r.id,
                            discipline_code=discipline,
                            doc_type='DRAWING',
                            level=1,
                            state=state,
                        )
                    )

    statuses = [
        ("AP", "Approved", "#52c41a", True),
        ("AN", "Approved as Note", "#13c2c2", True),
        ("CO", "Commented", "#faad14", False),
        ("RJ", "Rejected", "#ff4d4f", False),
    ]

    for code, name, color, is_final in statuses:
        exists = db.query(WorkflowStatus).filter(WorkflowStatus.code == code).first()
        if exists is None:
            db.add(
                WorkflowStatus(
                    code=code,
                    name=name,
                    color=color,
                    description=f"Default status {code}",
                    is_final=is_final,
                    editable=True,
                )
            )

    db.commit()
