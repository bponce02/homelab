import base64
import unittest

import httpx
from fastmcp import Client
from fastmcp.exceptions import ToolError
from mcp.types import ImageContent, TextContent

from server import create_server, read_content


SCHEMA = {
    "openapi": "3.1.0", "info": {"title": "Terminal", "version": "1"},
    "paths": {"/files/read": {"get": {
        "operationId": "read_file", "description": "Read text and images.",
        "parameters": [{"name": "path", "in": "query", "required": True, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "Read", "content": {"application/json": {"schema": {}}}}},
    }}},
}


class ReaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_binary_images_are_mcp_image_blocks(self):
        for mime, payload in [("image/png", b"\x89PNG\r\n\x1a\n\xff"), ("image/jpeg", b"\xff\xd8\xff\xe0"), ("image/webp", b"RIFF\xffWEBP")]:
            with self.subTest(mime=mime):
                async with httpx.AsyncClient(base_url="http://terminal", transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, headers={"Content-Type": mime}, content=payload)
                )) as upstream:
                    server = create_server(SCHEMA, upstream, "test-key")
                    async with Client(server) as client:
                        result = await client.call_tool("read_file", {"path": "/tmp/image"})
                    self.assertIsNone(result.structured_content)
                    self.assertEqual(len(result.content), 1)
                    image = result.content[0]
                    self.assertIsInstance(image, ImageContent)
                    self.assertEqual(image.mimeType, mime)
                    self.assertEqual(base64.b64decode(image.data), payload)
                    wire = image.model_dump_json()
                    self.assertIn('"type":"image"', wire)

    async def test_text_structure_and_line_ranges_are_preserved(self):
        seen = []

        def respond(request):
            seen.append(dict(request.url.params))
            return httpx.Response(200, json={"content": "café\n", "start_line": 2, "end_line": 3})

        async with httpx.AsyncClient(base_url="http://terminal", transport=httpx.MockTransport(respond)) as upstream:
            async with Client(create_server(SCHEMA, upstream, "test-key")) as client:
                result = await client.call_tool("read_file", {"path": "/tmp/text", "start_line": 2, "end_line": 3})
                with self.assertRaises(ToolError):
                    await client.call_tool("read_file", {"path": "/tmp/text", "start_line": 0})
            self.assertEqual(result.structured_content["content"], "café\n")
            self.assertIsInstance(result.content[0], TextContent)
            self.assertEqual(seen, [{"path": "/tmp/text", "start_line": "2", "end_line": "3"}])

    async def test_plain_text_and_non_dictionary_json(self):
        for response in [httpx.Response(200, text="hello"), httpx.Response(200, json=["hello"])]:
            async with httpx.AsyncClient(base_url="http://terminal", transport=httpx.MockTransport(lambda request: response)) as upstream:
                result = await read_content(upstream, "/tmp/text")
                self.assertIsInstance(result.content[0], TextContent)
                if response.headers.get("content-type") == "application/json":
                    self.assertEqual(result.structured_content, {"result": ["hello"]})
                else:
                    self.assertEqual(result.content[0].text, "hello")

    async def test_failures_are_bounded_and_do_not_expose_upstream_details(self):
        for response, limit, expected in [
            (httpx.Response(200, headers={"content-type": "image/png"}, content=b"x" * 11), 10, "size limit"),
            (httpx.Response(404, text="PRIVATE_TOKEN"), 10, "HTTP 404"),
            (httpx.Response(200, headers={"content-type": "application/json"}, content=b"\xff"), 10, "unsupported response"),
        ]:
            async with httpx.AsyncClient(base_url="http://terminal", transport=httpx.MockTransport(lambda request: response)) as upstream:
                with self.assertRaises(ToolError) as raised:
                    await read_content(upstream, "/tmp/image", max_bytes=limit)
                self.assertIn(expected, str(raised.exception))
                self.assertNotIn("PRIVATE_TOKEN", str(raised.exception))

    async def test_network_error_is_sanitized(self):
        def respond(request):
            raise httpx.ConnectError("PRIVATE_TOKEN", request=request)

        async with httpx.AsyncClient(base_url="http://terminal", transport=httpx.MockTransport(respond)) as upstream:
            with self.assertRaises(ToolError) as raised:
                await read_content(upstream, "/tmp/image")
            self.assertEqual(str(raised.exception), "File service unavailable")


if __name__ == "__main__":
    unittest.main()
