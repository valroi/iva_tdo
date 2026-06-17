"""Отправка email для модуля Vendors через корпоративный SMTP.

Если SMTP не сконфигурирован (smtp_host пуст) — сообщение пишется в
backend-лог (режим разработки). Это позволяет прогонять весь поток
подтверждения подрядчика локально без живого почтового сервера.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger("vendor_email")
settings = get_settings()


def _smtp_configured() -> bool:
    return bool(settings.smtp_host.strip())


def _ssl_context() -> ssl.SSLContext:
    """SSL-контекст, принимающий слабые DH-ключи корпоративных почтовых
    серверов. Дефолтный контекст (SECLEVEL=2) падает с DH_KEY_TOO_SMALL —
    понижаем уровень до 1. При smtp_insecure отключаем и проверку сертификата
    (на случай self-signed корп. сертификата)."""
    context = ssl.create_default_context()
    try:
        context.set_ciphers("DEFAULT@SECLEVEL=1")
    except ssl.SSLError:
        pass
    if getattr(settings, "smtp_insecure", False):
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


def send_email(*, to: str, subject: str, body: str) -> bool:
    """Отправляет письмо. Возвращает True, если письмо реально ушло через SMTP.
    В dev-режиме (SMTP не настроен) — пишет в лог и возвращает False."""
    if not _smtp_configured():
        logger.warning(
            "[VENDOR EMAIL — DEV MODE, SMTP не настроен]\n  TO: %s\n  SUBJ: %s\n  BODY:\n%s",
            to,
            subject,
            body,
        )
        return False

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    context = _ssl_context()
    if settings.smtp_port == 465:
        # Implicit SSL (порт 465).
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20, context=context) as server:
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            if settings.smtp_use_tls:
                server.starttls(context=context)
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
    return True


def send_invitation_code(*, to: str, company_name: str, mr_code: str, code: str) -> bool:
    subject = f"Код доступа к заявке на поставку {mr_code}"
    body = (
        f"Здравствуйте, {company_name}!\n\n"
        f"Вы приглашены к участию в заявке на поставку {mr_code}.\n"
        f"Ваш код подтверждения для входа: {code}\n\n"
        f"Код действует ограниченное время. Если вы не запрашивали доступ, "
        f"проигнорируйте это письмо.\n"
    )
    return send_email(to=to, subject=subject, body=body)


def send_invitation_link(*, to: str, company_name: str, mr_code: str, link: str) -> bool:
    subject = f"Приглашение к заявке на поставку {mr_code}"
    body = (
        f"Здравствуйте, {company_name}!\n\n"
        f"Компания-заказчик приглашает вас подать предложение по заявке {mr_code}.\n"
        f"Перейдите по персональной ссылке для входа:\n{link}\n\n"
        f"При входе потребуется код подтверждения, который придёт на этот адрес.\n"
        f"Ссылка персональная — не передавайте её третьим лицам.\n"
    )
    return send_email(to=to, subject=subject, body=body)
