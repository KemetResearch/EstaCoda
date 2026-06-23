import asyncio
import json
import re
import sys
from pathlib import Path


DIAGNOSTIC_LIMIT_CHARS = 1000


def main() -> int:
    try:
        request = read_request()
    except Exception as exc:
        write_response({
            "ok": False,
            "content": "Edge TTS worker protocol failure.",
            "metadata": {
                "reason": "worker-protocol-error",
                "diagnostic": safe_diagnostic(exc),
            },
        })
        return 2

    try:
        asyncio.run(synthesize(request))
        write_response({
            "ok": True,
            "outputPath": request["outputPath"],
            "mimeType": "audio/mpeg",
        })
        return 0
    except Exception as exc:
        write_response({
            "ok": False,
            "content": "Edge TTS synthesis failed.",
            "metadata": {
                "reason": "synthesis-error",
                "diagnostic": safe_diagnostic(exc, request.get("text")),
            },
        })
        return 0


def read_request() -> dict:
    raw = sys.stdin.read()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("request must be a JSON object")
    for field in ("text", "voice", "rate", "outputPath"):
        value = parsed.get(field)
        if not isinstance(value, str) or len(value) == 0:
            raise ValueError(f"missing required field: {field}")
    return parsed


async def synthesize(request: dict) -> None:
    import edge_tts

    output_path = Path(request["outputPath"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(request["text"], request["voice"], rate=request["rate"])
    await communicate.save(str(output_path))
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise RuntimeError("edge-tts produced empty audio output")


def safe_diagnostic(exc: Exception, sensitive_text: str | None = None) -> str:
    message = str(exc) or exc.__class__.__name__
    if sensitive_text:
        message = message.replace(sensitive_text, "[redacted]")
    message = re.sub(r"(?i)bearer\s+[a-z0-9._~+/=-]+", "Bearer [redacted]", message)
    message = re.sub(r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*\S+", r"\1=[redacted]", message)
    message = " ".join(message.split())
    if len(message) > DIAGNOSTIC_LIMIT_CHARS:
        return f"{message[:DIAGNOSTIC_LIMIT_CHARS]}...[truncated]"
    return message


def write_response(response: dict) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
