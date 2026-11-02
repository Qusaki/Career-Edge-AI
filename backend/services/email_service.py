"""Backend-only, provider-neutral SMTP delivery for password recovery."""

import smtplib
import ssl
from email.message import EmailMessage

from core.config import settings


def smtp_configuration() -> tuple[str, int, str, str, str, str, str]:
    host = settings.SMTP_HOST
    username = settings.SMTP_USERNAME
    password = settings.SMTP_PASSWORD
    sender = settings.SMTP_FROM_EMAIL
    sender_name = settings.SMTP_FROM_NAME or "Career Edge AI"
    security = settings.SMTP_SECURITY
    if not all((host, username, password, sender)) or security not in {"starttls", "ssl"}:
        raise ValueError("Password recovery email is not configured.")
    try:
        port = int(settings.SMTP_PORT)
    except (TypeError, ValueError) as error:
        raise ValueError("Password recovery email is not configured.") from error
    if not 1 <= port <= 65535:
        raise ValueError("Password recovery email is not configured.")
    return host, port, username, password, sender, sender_name, security


def send_password_reset_email(recipient: str, reset_url: str) -> None:
    host, port, username, password, sender, sender_name, security = smtp_configuration()
    message = EmailMessage()
    message["Subject"] = "Reset your Career Edge AI password"
    message["From"] = f"{sender_name} <{sender}>"
    message["To"] = recipient
    message.set_content(
        "A password reset was requested for your Career Edge AI account.\n\n"
        f"Use this link to set a new password: {reset_url}\n\n"
        "This link expires in 20 minutes. If you did not request this, ignore this email."
    )
    context = ssl.create_default_context()
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=10, context=context) as client:
            client.login(username, password)
            client.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=10) as client:
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
            client.login(username, password)
            client.send_message(message)
