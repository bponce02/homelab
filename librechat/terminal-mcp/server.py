import base64
import os
from typing import Annotated

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import StaticTokenVerifier
from fastmcp.tools.tool import ToolResult
from mcp.types import ImageContent
from pydantic import Field


async def read_content(client, path, start_line=None, end_line=None, max_bytes=10 * 1024 * 1024):
    params = {"path": path}
    if start_line is not None:
        params["start_line"] = start_line
    if end_line is not None:
        params["end_line"] = end_line
    try:
        async with client.stream("GET", "/files/read", params=params) as response:
            if not response.is_success:
                raise ToolError(f"File read failed (HTTP {response.status_code})")
            mime_type = response.headers.get("content-type", "").split(";", 1)[0].lower().strip()
            chunks = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ToolError("File exceeds the reader size limit")
                chunks.append(chunk)
            payload = b"".join(chunks)
            if mime_type.startswith("image/"):
                return ToolResult(content=[ImageContent(
                    type="image", mimeType=mime_type,
                    data=base64.b64encode(payload).decode("ascii"),
                )])
            if mime_type == "application/json":
                response = httpx.Response(200, content=payload)
                result = response.json()
                structured = result if isinstance(result, dict) else {"result": result}
                return ToolResult(structured_content=structured)
            return ToolResult(content=payload.decode("utf-8"))
    except httpx.RequestError:
        raise ToolError("File service unavailable") from None
    except (UnicodeDecodeError, ValueError):
        raise ToolError("File service returned an unsupported response") from None


def create_server(schema, client, key, max_bytes=10 * 1024 * 1024):
    server = FastMCP.from_openapi(
        openapi_spec=schema,
        client=client,
        name="Shared Open Terminal",
        auth=StaticTokenVerifier(tokens={key: {"client_id": "librechat", "scopes": []}}),
    )
    server.remove_tool("read_file")

    @server.tool(name="read_file", description=schema["paths"]["/files/read"]["get"]["description"], output_schema=None)
    async def read_file(
        path: str,
        start_line: Annotated[int, Field(ge=1)] | None = None,
        end_line: Annotated[int, Field(ge=1)] | None = None,
    ) -> ToolResult:
        return await read_content(client, path, start_line, end_line, max_bytes)

    return server


def main():
    key = os.environ["OPEN_TERMINAL_API_KEY"]
    base_url = os.environ.get("OPEN_TERMINAL_URL", "http://open-terminal:8000")
    headers = {"Authorization": f"Bearer {key}", "X-User-Id": "librechat"}
    with httpx.Client(base_url=base_url, headers=headers, timeout=30) as client:
        response = client.get("/openapi.json")
        response.raise_for_status()
        schema = response.json()
    server = create_server(
        schema,
        httpx.AsyncClient(base_url=base_url, headers=headers, timeout=120),
        key,
        int(os.environ.get("READ_FILE_MAX_BYTES", str(10 * 1024 * 1024))),
    )
    server.run(transport="streamable-http", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
