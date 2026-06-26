from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY_BYTES = 16_384
MIN_TIMEOUT_MS = 1_000
MAX_TIMEOUT_MS = 30_000
MAX_IMAGES = 30
INSTAGRAM_SHORTCODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PRIVATE_OR_LOGIN_PATTERNS = re.compile(
    r"(login|log in|private|not available|require|requires|sign in|signin|checkpoint)",
    re.IGNORECASE,
)


class MetadataHandler(BaseHTTPRequestHandler):
    server_version = "recipestock-ytdlp-metadata/1.0"

    def do_GET(self) -> None:
        if self.path != "/health":
            self.write_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "errorCode": "invalid_request", "message": "Route not found."},
            )
            return

        self.write_json(HTTPStatus.OK, {"ok": True})

    def do_POST(self) -> None:
        if self.path != "/extract":
            self.write_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "errorCode": "invalid_request", "message": "Route not found."},
            )
            return

        body = self.read_json_body()
        if body is None:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "errorCode": "invalid_request", "message": "Request body must be JSON."},
            )
            return

        platform = body.get("platform")
        if platform != "instagram":
            self.write_json(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                {
                    "ok": False,
                    "errorCode": "unsupported_platform",
                    "message": "Platform is not supported.",
                },
            )
            return

        url = body.get("url")
        source = parse_instagram_url(url) if isinstance(url, str) else None
        if source is None:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "errorCode": "invalid_request",
                    "message": "Instagram URL is invalid.",
                },
            )
            return

        timeout_ms = clamp_timeout_ms(body.get("timeoutMs"))
        result = extract_metadata(source, timeout_ms)
        status = HTTPStatus.OK if result["ok"] else status_for_error_code(result["errorCode"])
        self.write_json(status, result)

    def read_json_body(self) -> dict[str, Any] | None:
        content_type = self.headers.get("content-type", "")
        if "application/json" not in content_type.lower():
            return None

        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            return None

        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            return None

        try:
            raw_body = self.rfile.read(content_length)
            parsed = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

        return parsed if isinstance(parsed, dict) else None

    def write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        print(
            json.dumps(
                {
                    "level": "info",
                    "client": self.address_string(),
                    "message": format % args,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )


def parse_instagram_url(raw_url: str) -> dict[str, str] | None:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return None

    if parsed.scheme != "https":
        return None
    if parsed.netloc != "www.instagram.com":
        return None
    if parsed.params or parsed.query or parsed.fragment:
        return None

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 2:
        return None
    if parts[0] not in {"p", "reel"}:
        return None
    if not INSTAGRAM_SHORTCODE_RE.fullmatch(parts[1]):
        return None

    return {
        "platform": "instagram",
        "canonicalUrl": f"https://www.instagram.com/{parts[0]}/{parts[1]}/",
        "shortcode": parts[1],
        "mediaKind": "reel" if parts[0] == "reel" else "post",
    }


def clamp_timeout_ms(value: Any) -> int:
    if isinstance(value, bool):
        return MIN_TIMEOUT_MS
    if isinstance(value, (int, float)):
        return max(MIN_TIMEOUT_MS, min(MAX_TIMEOUT_MS, int(value)))
    return MIN_TIMEOUT_MS


def extract_metadata(source: dict[str, str], timeout_ms: int) -> dict[str, Any]:
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--dump-single-json",
        "--skip-download",
        "--ignore-config",
        "--no-warnings",
        source["canonicalUrl"],
    ]

    env = {
        **os.environ,
        "HOME": "/tmp",
        "XDG_CACHE_HOME": "/tmp/yt-dlp-cache",
    }

    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            env=env,
            text=True,
            timeout=timeout_ms / 1000,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "errorCode": "timeout", "message": "yt-dlp extraction timed out."}
    except OSError as error:
        return {
            "ok": False,
            "errorCode": "extraction_failed",
            "message": f"yt-dlp could not be started: {error}",
        }

    if completed.returncode != 0:
        return classify_extraction_failure(completed.stderr or completed.stdout)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "errorCode": "extraction_failed",
            "message": "yt-dlp returned invalid JSON.",
        }

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "errorCode": "extraction_failed",
            "message": "yt-dlp returned an unexpected payload.",
        }

    return normalize_ytdlp_metadata(source, payload)


def normalize_ytdlp_metadata(source: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    thumbnails = normalize_thumbnails(payload.get("thumbnails"))
    images = normalize_images(payload, thumbnails)

    return {
        "ok": True,
        "source": source,
        "metadata": {
            "provider": "yt-dlp",
            "extractor": optional_string(payload.get("extractor")),
            "webpageUrl": optional_string(payload.get("webpage_url")),
            "title": optional_string(payload.get("title")),
            "description": optional_string(payload.get("description")),
            "uploader": optional_string(payload.get("uploader")),
            "thumbnail": optional_string(payload.get("thumbnail")),
            "thumbnails": thumbnails,
            "duration": optional_number(payload.get("duration")),
            "availability": optional_string(payload.get("availability")),
        },
        "images": images,
    }


def normalize_images(
    payload: dict[str, Any],
    thumbnails: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    append_image(
        images,
        seen_urls,
        url=optional_string(payload.get("thumbnail")),
        kind="thumbnail",
        source="top_level",
    )
    for thumbnail in thumbnails:
        append_image(
            images,
            seen_urls,
            url=optional_string(thumbnail.get("url")),
            kind="thumbnail",
            source="top_level",
            width=optional_int(thumbnail.get("width")),
            height=optional_int(thumbnail.get("height")),
        )

    entries = payload.get("entries")
    if isinstance(entries, list):
        for entry_index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue

            append_image(
                images,
                seen_urls,
                url=optional_string(entry.get("thumbnail")),
                kind="thumbnail",
                source="entry",
                entry_index=entry_index,
            )
            for thumbnail in normalize_thumbnails(entry.get("thumbnails")):
                append_image(
                    images,
                    seen_urls,
                    url=optional_string(thumbnail.get("url")),
                    kind="thumbnail",
                    source="entry",
                    entry_index=entry_index,
                    width=optional_int(thumbnail.get("width")),
                    height=optional_int(thumbnail.get("height")),
                )

    return images


def append_image(
    images: list[dict[str, Any]],
    seen_urls: set[str],
    *,
    url: str | None,
    kind: str,
    source: str,
    entry_index: int | None = None,
    width: int | None = None,
    height: int | None = None,
) -> None:
    if len(images) >= MAX_IMAGES or url is None or not is_http_url(url) or url in seen_urls:
        return

    image: dict[str, Any] = {
        "url": url,
        "kind": kind,
        "source": source,
    }
    if entry_index is not None:
        image["entryIndex"] = entry_index
    if width is not None:
        image["width"] = width
    if height is not None:
        image["height"] = height

    images.append(image)
    seen_urls.add(url)


def normalize_thumbnails(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    thumbnails: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue

        url = optional_string(item.get("url"))
        if url is None or url in seen_urls:
            continue

        thumbnail: dict[str, Any] = {"url": url}
        width = optional_int(item.get("width"))
        height = optional_int(item.get("height"))
        if width is not None:
            thumbnail["width"] = width
        if height is not None:
            thumbnail["height"] = height

        thumbnails.append(thumbnail)
        seen_urls.add(url)

    return thumbnails


def optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def optional_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    return value if isinstance(value, (int, float)) else None


def optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    return value if isinstance(value, int) else None


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def classify_extraction_failure(message: str) -> dict[str, str | bool]:
    sanitized = message.strip()[:1_000] or "yt-dlp extraction failed."
    if PRIVATE_OR_LOGIN_PATTERNS.search(sanitized):
        return {
            "ok": False,
            "errorCode": "private_or_login_required",
            "message": "Instagram post is private, unavailable, or requires login.",
        }

    return {"ok": False, "errorCode": "extraction_failed", "message": sanitized}


def status_for_error_code(error_code: str) -> HTTPStatus:
    if error_code == "timeout":
        return HTTPStatus.GATEWAY_TIMEOUT
    if error_code == "unsupported_platform":
        return HTTPStatus.UNPROCESSABLE_ENTITY
    if error_code == "invalid_request":
        return HTTPStatus.BAD_REQUEST
    if error_code == "private_or_login_required":
        return HTTPStatus.UNPROCESSABLE_ENTITY
    return HTTPStatus.BAD_GATEWAY


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MetadataHandler)
    print(json.dumps({"level": "info", "message": "yt-dlp metadata server started", "port": PORT}))
    server.serve_forever()


if __name__ == "__main__":
    main()
