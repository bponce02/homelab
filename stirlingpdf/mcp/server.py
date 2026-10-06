import hashlib
import hmac
import os
import re
import time
import uuid
from pathlib import Path
from typing import Literal

import httpx
from fastmcp import FastMCP
from fastmcp.server.auth import StaticTokenVerifier
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse

KEY = os.environ["STIRLING_MCP_API_KEY"]
if len(KEY) < 32:
    raise RuntimeError("STIRLING_MCP_API_KEY must contain at least 32 characters")
BASE_URL = os.environ.get("STIRLING_URL", "http://stirling-pdf:8080")
PUBLIC_URL = os.environ.get("STIRLING_FILES_URL", "https://pdf.develium.dev/agent-files")
WORKSPACE = Path(os.environ.get("PDF_WORKSPACE", "/home/user/pdfs")).resolve()
MAX_BYTES = 50 * 1024 * 1024
WORKSPACE.mkdir(parents=True, exist_ok=True)
OUTPUTS = WORKSPACE / "results"
OUTPUTS.mkdir(exist_ok=True)
if OUTPUTS.is_symlink():
    raise RuntimeError("Results directory must not be a symlink")

server = FastMCP(
    "Stirling PDF",
    instructions="Use Open Terminal to place input PDFs in /home/user/pdfs. These tools accept paths within that shared folder, not URLs or chat attachment IDs. Chat uploads are not automatically copied here. Results include terminal paths and 24-hour download links. This workspace is shared by all users of the terminal; do not use it as private per-user storage. Never overwrite originals.",
    auth=StaticTokenVerifier(tokens={KEY: {"client_id": "homelab", "scopes": []}}),
)


def input_path(name: str) -> Path:
    path = (WORKSPACE / name).resolve()
    if not path.is_relative_to(WORKSPACE) or not path.is_file():
        raise ValueError("Input must be an existing file inside /home/user/pdfs")
    if path.suffix.lower() != ".pdf" or path.stat().st_size > MAX_BYTES:
        raise ValueError("Input must be a PDF no larger than 50 MiB")
    with path.open("rb") as source:
        if not source.read(5) == b"%PDF-":
            raise ValueError("Input does not have a PDF header")
    return path


def signature(name: str, expires: int) -> str:
    return hmac.new(KEY.encode(), f"{name}:{expires}".encode(), hashlib.sha256).hexdigest()


def result_info(path: Path) -> dict:
    expires = int(time.time()) + 86400
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "download_url": f"{PUBLIC_URL}/{path.name}?expires={expires}&signature={signature(path.name, expires)}",
        "expires_at": expires,
    }


async def process(endpoint: str, names: list[str], fields: dict, suffix: str) -> dict:
    paths = [input_path(name) for name in names]
    if not 1 <= len(paths) <= 20 or sum(path.stat().st_size for path in paths) > MAX_BYTES:
        raise ValueError("Use 1–20 PDFs totaling at most 50 MiB")
    files = [("fileInput", (path.name, path.read_bytes(), "application/pdf")) for path in paths]
    headers = {}
    if os.environ.get("STIRLING_API_KEY"):
        headers["X-API-KEY"] = os.environ["STIRLING_API_KEY"]
    async with httpx.AsyncClient(base_url=BASE_URL, headers=headers, timeout=180) as client:
        async with client.stream("POST", endpoint, files=files, data=fields) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Stirling PDF returned HTTP {response.status_code}; check its logs")
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    raise ValueError("Result exceeds the 50 MiB limit")
            if not content:
                raise RuntimeError("Stirling PDF returned an empty result")
            if content.startswith(b"%PDF"):
                suffix = ".pdf"
            elif content.startswith(b"PK\x03\x04"):
                suffix = ".zip"
            elif suffix != ".txt" and not content.startswith(b"\x89PNG"):
                raise RuntimeError("Stirling PDF returned an unexpected file type")
    if OUTPUTS.is_symlink() or OUTPUTS.resolve() != WORKSPACE / "results":
        raise ValueError("Results directory must stay inside the PDF workspace")
    path = OUTPUTS / f"{uuid.uuid4().hex}{suffix}"
    with path.open("xb") as output:
        output.write(content)
    result = result_info(path)
    if suffix == ".txt":
        text = content.decode("utf-8", errors="replace")
        result["text"] = text[:20000]
        result["text_truncated"] = len(text) > 20000
    return result


@server.custom_route("/agent-files/{name}", methods=["GET"])
async def download(request: Request):
    name = request.path_params["name"]
    try:
        expires = int(request.query_params.get("expires", "0"))
    except ValueError:
        return JSONResponse({"error": "Invalid link"}, status_code=403)
    supplied = request.query_params.get("signature", "")
    if (
        not re.fullmatch(r"[a-f0-9]{32}\.(pdf|zip|txt|png)", name)
        or expires < int(time.time())
        or not hmac.compare_digest(supplied, signature(name, expires))
    ):
        return JSONResponse({"error": "Invalid or expired link"}, status_code=403)
    path = OUTPUTS / name
    if OUTPUTS.is_symlink() or path.is_symlink() or not path.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)
    return FileResponse(path, filename=name, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@server.tool()
def list_pdf_files() -> list[dict]:
    """List up to 100 PDFs in the shared /home/user/pdfs workspace."""
    files = []
    for path in sorted(WORKSPACE.rglob("*.pdf")):
        if path.is_file() and path.resolve().is_relative_to(WORKSPACE):
            files.append({"path": str(path), "bytes": path.stat().st_size})
        if len(files) == 100:
            break
    return files


@server.tool()
async def merge_pdfs(paths: list[str]) -> dict:
    """Merge PDFs in the supplied order, preserving input files."""
    if len(paths) < 2:
        raise ValueError("Provide at least two PDFs")
    return await process("/api/v1/general/merge-pdfs", paths, {"sortType": "orderProvided", "removeCertSign": "true"}, ".pdf")


@server.tool()
async def split_pdf(path: str, split_after_pages: str = "all") -> dict:
    """Split after page numbers, e.g. '2,5', or split every page with 'all'."""
    return await process("/api/v1/general/split-pages", [path], {"pageNumbers": split_after_pages}, ".zip")


@server.tool()
async def rotate_pdf(path: str, angle: Literal[90, 180, 270] = 90) -> dict:
    """Rotate all pages clockwise."""
    return await process("/api/v1/general/rotate-pdf", [path], {"angle": str(angle)}, ".pdf")


@server.tool()
async def compress_pdf(path: str, level: Literal[1, 2, 3, 4, 5, 6, 7, 8, 9] = 2) -> dict:
    """Compress a PDF; higher optimization levels may reduce quality."""
    return await process("/api/v1/misc/compress-pdf", [path], {"optimizeLevel": str(level), "expectedOutputSize": "", "linearize": "false", "normalize": "false", "grayscale": "false"}, ".pdf")


@server.tool()
async def extract_pdf_text(path: str) -> dict:
    """Extract selectable text; scanned PDFs may need OCR first."""
    return await process("/api/v1/convert/pdf/text", [path], {"outputFormat": "txt"}, ".txt")


@server.tool()
async def pdf_to_images(path: str, pages: str = "all", dpi: Literal[72, 150, 300] = 150) -> dict:
    """Convert selected PDF pages to PNG images, usually returned as a ZIP."""
    return await process("/api/v1/convert/pdf/img", [path], {"imageFormat": "png", "singleOrMultiple": "multiple", "colorType": "color", "dpi": str(dpi), "pageNumbers": pages}, ".png")


@server.tool()
async def ocr_pdf(path: str, language: str = "eng") -> dict:
    """Make scanned pages searchable using an installed Tesseract language."""
    if not re.fullmatch(r"[a-zA-Z0-9_]+", language):
        raise ValueError("Use an installed language code such as eng")
    return await process("/api/v1/misc/ocr-pdf", [path], {"languages": language, "ocrType": "skip-text", "ocrRenderType": "sandwich"}, ".pdf")


if __name__ == "__main__":
    server.run(transport="streamable-http", host="0.0.0.0", port=8000)
