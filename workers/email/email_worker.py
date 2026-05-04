#!/usr/bin/env python3
"""Email worker for EstaCoda. Handles IMAP polling and SMTP sending via JSON commands over stdin."""

import json
import sys
import imaplib
import smtplib
import ssl
from email import message_from_bytes
from email.header import decode_header
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.encoders import encode_base64
from email.utils import parseaddr, make_msgid
import base64
import os
import tempfile

def decode_header_value(value):
    """Decode an email header value, handling encoded words."""
    if value is None:
        return ""
    parts = decode_header(value)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(charset or "utf-8", errors="replace"))
            except:
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(part)
    return "".join(result)

def get_body_text(msg):
    """Extract plain text body from email message, stripping HTML if needed."""
    text_parts = []
    html_parts = []
    attachments = []

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            filename = part.get_filename()

            if filename:
                # Attachment
                payload = part.get_payload(decode=True)
                if payload:
                    attachments.append({
                        "filename": filename,
                        "mime_type": content_type,
                        "size": len(payload),
                        "data_b64": base64.b64encode(payload).decode("ascii")
                    })
                continue

            if "attachment" in content_disposition:
                payload = part.get_payload(decode=True)
                if payload:
                    attachments.append({
                        "filename": filename or "unnamed",
                        "mime_type": content_type,
                        "size": len(payload),
                        "data_b64": base64.b64encode(payload).decode("ascii")
                    })
                continue

            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    try:
                        charset = part.get_content_charset() or "utf-8"
                        text_parts.append(payload.decode(charset, errors="replace"))
                    except:
                        text_parts.append(payload.decode("utf-8", errors="replace"))
            elif content_type == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    try:
                        charset = part.get_content_charset() or "utf-8"
                        html_parts.append(payload.decode(charset, errors="replace"))
                    except:
                        html_parts.append(payload.decode("utf-8", errors="replace"))
    else:
        content_type = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            try:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except:
                decoded = payload.decode("utf-8", errors="replace")

            if content_type == "text/html":
                html_parts.append(decoded)
            else:
                text_parts.append(decoded)

    if text_parts:
        return "\n".join(text_parts), attachments
    elif html_parts:
        return strip_html(html_parts[0]), attachments
    else:
        return "", attachments

def strip_html(html):
    """Very basic HTML tag stripping."""
    import re
    # Remove script and style blocks
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # Replace <br>, <p> with newlines
    html = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'</p>', '\n', html, flags=re.IGNORECASE)
    # Remove remaining tags
    html = re.sub(r'<[^>]+>', '', html)
    # Unescape common entities
    html = html.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'")
    # Collapse whitespace
    lines = [line.strip() for line in html.split('\n')]
    result = []
    for line in lines:
        if line or (result and result[-1] != ''):
            result.append(line)
    return '\n'.join(result).strip()

def is_automated_sender(msg):
    """Check if email is from an automated sender (noreply, bulk, etc.)."""
    from_addr = parseaddr(msg.get("From", ""))[1].lower()
    if any(x in from_addr for x in ["noreply@", "no-reply@", "mailer-daemon@", "bounce@", "donotreply@"]):
        return True
    if msg.get("Auto-Submitted"):
        return True
    precedence = msg.get("Precedence", "").lower()
    if precedence in ["bulk", "list", "junk"]:
        return True
    if msg.get("List-Unsubscribe"):
        return True
    return False

def is_self_message(msg, own_address):
    """Check if email is from self to prevent loops."""
    from_addr = parseaddr(msg.get("From", ""))[1].lower()
    return from_addr == own_address.lower()

def cmd_poll(args):
    """Poll IMAP inbox for UNSEEN messages."""
    imap_host = args["imap_host"]
    imap_port = args.get("imap_port", 993)
    username = args["username"]
    password = args["password"]
    allowed_senders = [s.lower() for s in args.get("allowed_senders", [])]
    own_address = args.get("own_address", "").lower()
    mark_seen = args.get("mark_seen", True)
    skip_attachments = args.get("skip_attachments", False)

    context = ssl.create_default_context()
    mail = imaplib.IMAP4_SSL(imap_host, imap_port, ssl_context=context)
    mail.login(username, password)
    mail.select("INBOX")

    _, data = mail.search(None, "UNSEEN")
    message_ids = data[0].split() if data and data[0] else []

    messages = []
    for msg_id in message_ids:
        msg_id_str = msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id)
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        if not msg_data or msg_data[0] is None:
            continue

        raw = msg_data[0][1] if isinstance(msg_data[0], tuple) else None
        if raw is None:
            continue

        msg = message_from_bytes(raw)

        if is_automated_sender(msg):
            if mark_seen:
                mail.store(msg_id, "+FLAGS", "\\Seen")
            continue

        from_addr = parseaddr(msg.get("From", ""))[1]
        if own_address and is_self_message(msg, own_address):
            if mark_seen:
                mail.store(msg_id, "+FLAGS", "\\Seen")
            continue

        if allowed_senders and from_addr.lower() not in allowed_senders:
            # Not allowed - still mark as seen so we don't reprocess
            if mark_seen:
                mail.store(msg_id, "+FLAGS", "\\Seen")
            continue

        body_text, attachments = get_body_text(msg)
        if skip_attachments:
            attachments = []

        subject = decode_header_value(msg.get("Subject", ""))
        to_addr = parseaddr(msg.get("To", ""))[1]
        cc_addrs = [parseaddr(a)[1] for a in msg.get("Cc", "").split(",") if a.strip()]
        msg_id_header = msg.get("Message-ID", "")
        in_reply_to = msg.get("In-Reply-To", "")
        references = msg.get("References", "").split()
        date = msg.get("Date", "")

        messages.append({
            "message_id": msg_id_str,
            "msg_id_header": msg_id_header,
            "from": from_addr,
            "to": to_addr,
            "cc": cc_addrs,
            "subject": subject,
            "body": body_text,
            "date": date,
            "in_reply_to": in_reply_to,
            "references": references,
            "attachments": attachments
        })

        if mark_seen:
            mail.store(msg_id, "+FLAGS", "\\Seen")

    mail.close()
    mail.logout()

    return {"ok": True, "messages": messages}

def cmd_send(args):
    """Send an email via SMTP."""
    smtp_host = args["smtp_host"]
    smtp_port = args.get("smtp_port", 587)
    username = args["username"]
    password = args["password"]
    from_addr = args["from"]
    to_addrs = args["to"]
    subject = args["subject"]
    body = args["body"]
    in_reply_to = args.get("in_reply_to")
    references = args.get("references", [])
    attachments = args.get("attachments", [])

    msg = MIMEMultipart("mixed") if attachments else MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@")[1] if "@" in from_addr else "estacoda.local")

    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = " ".join(references)

    # Plain text body
    text_part = MIMEText(body, "plain", "utf-8")
    msg.attach(text_part)

    for att in attachments:
        filename = att.get("filename", "attachment")
        mime_type = att.get("mime_type", "application/octet-stream")
        data_b64 = att.get("data_b64", "")

        main_type, sub_type = mime_type.split("/", 1) if "/" in mime_type else ("application", "octet-stream")
        part = MIMEBase(main_type, sub_type)
        part.set_payload(base64.b64decode(data_b64))
        encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

    context = ssl.create_default_context()

    if smtp_port == 465:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, context=context)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls(context=context)

    server.login(username, password)
    server.send_message(msg)
    server.quit()

    return {"ok": True, "message_id": msg["Message-ID"]}

def cmd_test(args):
    """Test IMAP and SMTP connectivity."""
    results = {"imap": False, "smtp": False, "error": None}

    try:
        context = ssl.create_default_context()
        imap_port = args.get("imap_port", 993)
        mail = imaplib.IMAP4_SSL(args["imap_host"], imap_port, ssl_context=context)
        mail.login(args["username"], args["password"])
        mail.select("INBOX")
        mail.close()
        mail.logout()
        results["imap"] = True
    except Exception as e:
        results["imap_error"] = str(e)

    try:
        context = ssl.create_default_context()
        smtp_port = args.get("smtp_port", 587)
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(args["smtp_host"], smtp_port, context=context)
        else:
            server = smtplib.SMTP(args["smtp_host"], smtp_port)
            server.starttls(context=context)
        server.login(args["username"], args["password"])
        server.quit()
        results["smtp"] = True
    except Exception as e:
        results["smtp_error"] = str(e)

    results["ok"] = results["imap"] and results["smtp"]
    return results

def main():
    line = sys.stdin.readline()
    if not line:
        print(json.dumps({"ok": False, "error": "No input"}))
        return

    try:
        request = json.loads(line)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        return

    command = request.get("command")
    args = request.get("args", {})

    try:
        if command == "poll":
            result = cmd_poll(args)
        elif command == "send":
            result = cmd_send(args)
        elif command == "test":
            result = cmd_test(args)
        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result))

if __name__ == "__main__":
    main()
