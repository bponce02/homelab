import importlib.util
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastmcp import Client


class PDFToolsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        spec = importlib.util.spec_from_file_location("pdf_tools", Path(__file__).with_name("server.py"))
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"PDF_WORKSPACE": str(self.root / "pdfs"), "STIRLING_MCP_API_KEY": "test-key-" * 8}):
            spec.loader.exec_module(self.module)
        self.workspace = self.module.WORKSPACE
        self.source = self.workspace / "input.pdf"
        self.source.write_bytes(b"%PDF-1.7\nlocal-test-document")
        self.real_client = httpx.AsyncClient

    def transport(self, content=b"%PDF-1.7\nresult", status=200):
        def handler(request):
            self.requests.append(request)
            return httpx.Response(status, content=content)

        self.requests = []
        transport = httpx.MockTransport(handler)
        return patch.object(self.module.httpx, "AsyncClient", side_effect=lambda **kwargs: self.real_client(transport=transport, **kwargs))

    def test_workspace_boundaries(self):
        outside = self.root / "outside.pdf"
        outside.write_bytes(b"%PDF-1.7\nsecret")
        (self.workspace / "escape.pdf").symlink_to(outside)
        for path in ("../outside.pdf", str(outside), "escape.pdf", "missing.pdf", "https://example.com/a.pdf"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.module.input_path(path)
        self.assertEqual(self.module.input_path("input.pdf"), self.source)
        self.assertEqual(self.module.input_path(str(self.source)), self.source)
        fake = self.workspace / "fake.pdf"
        fake.write_text("not a PDF")
        with self.assertRaises(ValueError):
            self.module.input_path("fake.pdf")
        with patch.object(self.module, "MAX_BYTES", 5), self.assertRaises(ValueError):
            self.module.input_path("input.pdf")

    async def test_merge_preserves_original_and_builds_multipart(self):
        original = self.source.read_bytes()
        async with Client(self.module.server) as client:
            with self.transport():
                result = await client.call_tool("merge_pdfs", {"paths": ["input.pdf", "input.pdf"]})
        self.assertFalse(result.is_error)
        self.assertEqual(len(self.requests), 1)
        request = self.requests[0]
        self.assertEqual(request.url.path, "/api/v1/general/merge-pdfs")
        self.assertEqual(request.content.count(b'name="fileInput"'), 2)
        self.assertIn(b"orderProvided", request.content)
        self.assertEqual(self.source.read_bytes(), original)
        outputs = list(self.module.OUTPUTS.glob("*.pdf"))
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].read_bytes(), b"%PDF-1.7\nresult")

    async def test_tools_and_parameter_validation(self):
        async with Client(self.module.server) as client:
            tools = await client.list_tools()
            self.assertEqual(len(tools), 8)
            with self.assertRaises(Exception):
                await client.call_tool("rotate_pdf", {"path": "input.pdf", "angle": 45})
            with self.assertRaises(Exception):
                await client.call_tool("merge_pdfs", {"paths": ["input.pdf"]})

    async def test_conversion_contracts(self):
        cases = [
            ("split_pdf", {"path": "input.pdf", "split_after_pages": "2"}, "/api/v1/general/split-pages", b"pageNumbers"),
            ("rotate_pdf", {"path": "input.pdf"}, "/api/v1/general/rotate-pdf", b"angle"),
            ("compress_pdf", {"path": "input.pdf"}, "/api/v1/misc/compress-pdf", b"expectedOutputSize"),
            ("ocr_pdf", {"path": "input.pdf"}, "/api/v1/misc/ocr-pdf", b"languages"),
            ("pdf_to_images", {"path": "input.pdf"}, "/api/v1/convert/pdf/img", b"singleOrMultiple"),
        ]
        async with Client(self.module.server) as client:
            for tool, arguments, endpoint, field in cases:
                with self.subTest(tool=tool), self.transport(content=b"PK\x03\x04test-zip"):
                    result = await client.call_tool(tool, arguments)
                    self.assertFalse(result.is_error)
                    self.assertEqual(self.requests[0].url.path, endpoint)
                    self.assertIn(field, self.requests[0].content)

    async def test_text_preview_and_output_limits(self):
        with self.transport(content=b"a" * 21000):
            result = await self.module.process("/api/v1/convert/pdf/text", ["input.pdf"], {"outputFormat": "txt"}, ".txt")
        self.assertEqual(len(result["text"]), 20000)
        self.assertTrue(result["text_truncated"])
        self.assertEqual(Path(result["path"]).stat().st_size, 21000)
        with self.transport(content=b"a" * 100), patch.object(self.module, "MAX_BYTES", 50):
            with self.assertRaises(ValueError):
                await self.module.process("/test", ["input.pdf"], {}, ".txt")

    async def test_upstream_errors_do_not_write_files(self):
        for status, content in [(500, b"secret upstream details"), (302, b"redirect"), (200, b"<html>login</html>"), (200, b"")]:
            with self.subTest(status=status), self.transport(content=content, status=status):
                with self.assertRaises(RuntimeError) as error:
                    await self.module.process("/test", ["input.pdf"], {}, ".pdf")
                self.assertNotIn("secret upstream details", str(error.exception))
        self.assertEqual(list(self.module.OUTPUTS.iterdir()), [])

    async def test_signed_downloads_and_mcp_auth(self):
        with self.transport():
            result = await self.module.process("/test", ["input.pdf"], {}, ".pdf")
        url = httpx.URL(result["download_url"])
        app = self.module.server.http_app()
        async with self.real_client(transport=httpx.ASGITransport(app), base_url="http://localhost") as client:
            response = await client.get(str(url))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b"%PDF-1.7\nresult")
            self.assertIn("attachment", response.headers["content-disposition"])
            response = await client.get(url.path)
            self.assertEqual(response.status_code, 403)
            response = await client.get(url.path, params={"expires": result["expires_at"], "signature": "forged"})
            self.assertEqual(response.status_code, 403)
            expired = int(time.time()) - 1
            name = Path(result["path"]).name
            response = await client.get(url.path, params={"expires": expired, "signature": self.module.signature(name, expired)})
            self.assertEqual(response.status_code, 403)
            response = await client.post("/mcp", json={})
            self.assertEqual(response.status_code, 401)
            response = await client.get("/agent-files/../input.pdf")
            self.assertNotEqual(response.status_code, 200)

    async def test_output_symlink_rejected(self):
        self.module.OUTPUTS.rmdir()
        self.module.OUTPUTS.symlink_to(self.root, target_is_directory=True)
        with self.transport(), self.assertRaises(ValueError):
            await self.module.process("/test", ["input.pdf"], {}, ".pdf")


if __name__ == "__main__":
    unittest.main()
