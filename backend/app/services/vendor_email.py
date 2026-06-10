"""Отправка email для модуля Vendors через корпоративный SMTP.

Если SMTP не сконфигурирован (smtp_host пуст) — сообщение пишется в
backend-лог (режим разработки). Это позволяет прогонять весь поток
подтверждения подрядчика локально без живого почтового сервера.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger("vendor_email")
settings = get_settings()


def _smtp_configured() -> bool:
    return bool(settings.smtp_host.strip())


def send_email(*, to: str, subject: str, body: str) -> None:
    """Отправляет письмо. В dev-режиме (без SMTP) — пишет в лог."""
    if not _smtp_configured():
        logger.warning(
            "[VENDOR EMAIL — DEV MODE, SMTP не настроен]\n  TO: %s\n  SUBJ: %s\n  BODY:\n%s",
            to,
            subject,
            body,
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if settings.smtp_use_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
                server.starttls()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
    except Exception as exc:  # noqa: BLE001 — письмо не должно ронять запрос
        logger.error("Не удалось отправить email подрядчику %s: %s", to, exc)
        raise


def send_invitation_code(*, to: str, company_name: str, mr_code: str, code: str) -> None:
    subject = f"Код доступа к заявке на поставку {mr_code}"
    body = (
        f"Здравствуйте, {company_name}!\n\n"
        f"Вы приглашены к участию в заявке на поставку {mr_code}.\n"
        f"Ваш код подтверждения для входа: {code}\n\n"
        f"Код действует ограниченное время. Если вы не запрашивали доступ, "
        f"проигнорируйте это письмо.\n"
    )
    send_email(to=to, subject=subject, body=body)


def send_invitation_link(*, to: str, company_name: str, mr_code: str, link: str) -> None:
    subject = f"Приглашение к заявке на поставку {mr_code}"
    body = (
        f"Здравствуйте, {company_name}!\n\n"
        f"Компания-заказчик приглашает вас подать предложение по заявке {mr_code}.\n"
        f"Перейдите по персональной ссылке для входа:\n{link}\n\n"
        f"При входе потребуется код подтверждения, который придёт на этот адрес.\n"
        f"Ссылка персональная — не передавайте её третьим лицам.\n"
    )
    send_email(to=to, subject=subject, body=body)
