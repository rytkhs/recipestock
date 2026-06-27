from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY_BYTES = 16_384
MIN_TIMEOUT_MS = 1_000
MAX_TIMEOUT_MS = 30_000
MAX_IMAGES = 30
INSTAGRAM_GRAPHQL_DOC_ID = "8845758582119845"
INSTAGRAM_GRAPHQL_URL = "https://www.instagram.com/graphql/query/"
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
    started_at = time.monotonic()
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

    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    remaining_timeout_ms = timeout_ms - elapsed_ms
    sidecar_images = extract_instagram_sidecar_images(source, remaining_timeout_ms)

    return normalize_ytdlp_metadata(source, payload, sidecar_images=sidecar_images)


def normalize_ytdlp_metadata(
    source: dict[str, str],
    payload: dict[str, Any],
    *,
    sidecar_images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    thumbnails = normalize_thumbnails(payload.get("thumbnails"))
    images = normalize_images(payload, thumbnails, sidecar_images=sidecar_images)

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
    *,
    sidecar_images: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = []
    image_indexes_by_key: dict[str, int] = {}

    for sidecar_image in sidecar_images or []:
        append_image(
            images,
            image_indexes_by_key,
            url=optional_string(sidecar_image.get("url")),
            kind="thumbnail",
            source="sidecar",
            entry_index=optional_int(sidecar_image.get("entryIndex")),
            width=optional_int(sidecar_image.get("width")),
            height=optional_int(sidecar_image.get("height")),
        )

    append_image(
        images,
        image_indexes_by_key,
        url=optional_string(payload.get("thumbnail")),
        kind="thumbnail",
        source="top_level",
    )
    for thumbnail in thumbnails:
        append_image(
            images,
            image_indexes_by_key,
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
                image_indexes_by_key,
                url=optional_string(entry.get("thumbnail")),
                kind="thumbnail",
                source="entry",
                entry_index=entry_index,
            )
            for thumbnail in normalize_thumbnails(entry.get("thumbnails")):
                append_image(
                    images,
                    image_indexes_by_key,
                    url=optional_string(thumbnail.get("url")),
                    kind="thumbnail",
                    source="entry",
                    entry_index=entry_index,
                    width=optional_int(thumbnail.get("width")),
                    height=optional_int(thumbnail.get("height")),
                )

    return images


def extract_instagram_sidecar_images(source: dict[str, str], timeout_ms: int) -> list[dict[str, Any]]:
    if timeout_ms <= 0:
        return []

    variables = {
        "shortcode": source["shortcode"],
        "child_comment_count": 3,
        "fetch_comment_count": 40,
        "parent_comment_count": 24,
        "has_threaded_comments": True,
    }
    query = urlencode(
        {
            "doc_id": INSTAGRAM_GRAPHQL_DOC_ID,
            "variables": json.dumps(variables, separators=(",", ":")),
        }
    )
    request = Request(
        f"{INSTAGRAM_GRAPHQL_URL}?{query}",
        headers={
            "X-IG-App-ID": "936619743392459",
            "X-ASBD-ID": "198387",
            "X-IG-WWW-Claim": "0",
            "Origin": "https://www.instagram.com",
            "Accept": "*/*",
            "X-CSRFToken": "",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": source["canonicalUrl"],
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urlopen(request, timeout=timeout_ms / 1000) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return []

    return normalize_instagram_sidecar_images(payload)


def normalize_instagram_sidecar_images(payload: Any) -> list[dict[str, Any]]:
    media = as_dict(as_dict(payload).get("data")).get("xdt_shortcode_media")
    edges = as_dict(as_dict(media).get("edge_sidecar_to_children")).get("edges")
    if not isinstance(edges, list):
        return []

    images: list[dict[str, Any]] = []
    for entry_index, edge in enumerate(edges):
        node = as_dict(as_dict(edge).get("node"))
        image = select_best_sidecar_image(node)
        if image is None:
            continue

        images.append(
            build_image(
                url=image["url"],
                kind="thumbnail",
                source="sidecar",
                entry_index=entry_index,
                width=optional_int(image.get("width")),
                height=optional_int(image.get("height")),
            )
        )

    return images


def select_best_sidecar_image(node: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []

    display_resources = node.get("display_resources")
    if isinstance(display_resources, list):
        for resource in display_resources:
            resource_dict = as_dict(resource)
            append_sidecar_candidate(
                candidates,
                url=optional_string(resource_dict.get("src")) or optional_string(resource_dict.get("url")),
                width=optional_int(resource_dict.get("config_width"))
                or optional_int(resource_dict.get("width")),
                height=optional_int(resource_dict.get("config_height"))
                or optional_int(resource_dict.get("height")),
            )

    dimensions = as_dict(node.get("dimensions"))
    dimension_width = optional_int(dimensions.get("width"))
    dimension_height = optional_int(dimensions.get("height"))
    append_sidecar_candidate(
        candidates,
        url=optional_string(node.get("display_url")),
        width=dimension_width,
        height=dimension_height,
    )
    append_sidecar_candidate(
        candidates,
        url=optional_string(node.get("thumbnail_src")),
        width=dimension_width,
        height=dimension_height,
    )

    if not candidates:
        return None

    return max(
        candidates,
        key=lambda candidate: image_area(
            optional_int(candidate.get("width")),
            optional_int(candidate.get("height")),
        ),
    )


def append_sidecar_candidate(
    candidates: list[dict[str, Any]],
    *,
    url: str | None,
    width: int | None,
    height: int | None,
) -> None:
    if url is None or not is_http_url(url):
        return

    candidate: dict[str, Any] = {"url": url}
    if width is not None:
        candidate["width"] = width
    if height is not None:
        candidate["height"] = height
    candidates.append(candidate)


def append_image(
    images: list[dict[str, Any]],
    image_indexes_by_key: dict[str, int],
    *,
    url: str | None,
    kind: str,
    source: str,
    entry_index: int | None = None,
    width: int | None = None,
    height: int | None = None,
) -> None:
    if url is None or not is_http_url(url):
        return

    dedupe_key = image_dedupe_key(url)
    existing_index = image_indexes_by_key.get(dedupe_key)
    if existing_index is not None:
        if image_area(width, height) > image_area(
            optional_int(images[existing_index].get("width")),
            optional_int(images[existing_index].get("height")),
        ):
            images[existing_index] = build_image(
                url=url,
                kind=kind,
                source=source,
                entry_index=entry_index,
                width=width,
                height=height,
            )
        return

    if len(images) >= MAX_IMAGES:
        return

    images.append(
        build_image(
            url=url,
            kind=kind,
            source=source,
            entry_index=entry_index,
            width=width,
            height=height,
        )
    )
    image_indexes_by_key[dedupe_key] = len(images) - 1


def build_image(
    *,
    url: str,
    kind: str,
    source: str,
    entry_index: int | None = None,
    width: int | None = None,
    height: int | None = None,
) -> dict[str, Any]:
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

    return image


def image_dedupe_key(url: str) -> str:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    if hostname == "cdninstagram.com" or hostname.endswith(".cdninstagram.com"):
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    if hostname == "fbcdn.net" or hostname.endswith(".fbcdn.net"):
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return url


def image_area(width: int | None, height: int | None) -> int:
    if width is None or height is None:
        return 0
    return width * height


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


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
