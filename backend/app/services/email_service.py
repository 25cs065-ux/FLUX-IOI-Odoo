"""Sends email via SMTP if configured, otherwise prints to the terminal (demo-safe)."""
import os
import smtplib
from email.message import EmailMessage


def send_email(to: str, subject: str, body: str) -> bool:
    host = os.getenv("SMTP_HOST")
    if host:
        try:
            msg = EmailMessage()
            msg["From"] = os.getenv("EMAIL_FROM", "noreply@brightloop.test")
            msg["To"] = to
            msg["Subject"] = subject
            msg.set_content(body)
            with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587"))) as s:
                s.starttls()
                s.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", ""))
                s.send_message(msg)
            return True
        except Exception as exc:
            print(f"[EMAIL] SMTP failed ({exc}); falling back to console")
    print(f"\n===== EMAIL (console mode) =====\nTo: {to}\nSubject: {subject}\n\n{body}\n================================\n")
    return True


def send_verification_email(to: str, token: str) -> bool:
    link = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/verify-email?token={token}"
    return send_email(to, "Verify your Brightloop account", f"Click to verify your email:\n{link}")


def send_reset_email(to: str, token: str) -> bool:
    link = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/reset-password?token={token}"
    return send_email(to, "Reset your Brightloop password", f"Click to reset your password (valid 30 minutes):\n{link}")
