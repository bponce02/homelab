import asyncio
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import httpx
from fastmcp import Client


class NativeMCPTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.key = secrets.token_hex(32)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}/mcp"
        env = {key: value for key, value in os.environ.items() if not key.startswith("OPEN_TERMINAL_")}
        env.update({
            "HOME": str(self.root),
            "OPEN_TERMINAL_API_KEY": self.key,
            "OPEN_TERMINAL_LOG_DIR": str(self.root / "logs"),
        })
        self.log = (self.root / "server.log").open("w+")
        self.addCleanup(self.log.close)
        self.process = subprocess.Popen(
            [sys.executable, "-m", "open_terminal", "mcp", "--transport", "streamable-http", "--host", "127.0.0.1", "--port", str(port)],
            cwd=self.root,
            env=env,
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )
        self.addCleanup(self.stop_server)
        async with httpx.AsyncClient(timeout=1) as client:
            for _ in range(100):
                if self.process.poll() is not None:
                    break
                try:
                    response = await client.get(self.url)
                    if response.status_code == 401:
                        return
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.1)
        self.log.seek(0)
        self.fail("Native MCP did not start:\n" + self.log.read())

    def stop_server(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    async def test_authenticated_discovery_and_execution(self):
        async with httpx.AsyncClient() as http:
            for headers in ({}, {"Authorization": "Bearer invalid"}):
                response = await http.get(self.url, headers=headers)
                self.assertEqual(response.status_code, 401)
        async with Client(self.url, auth=self.key) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}
            self.assertTrue({"run_command", "list_files", "read_file", "write_file"}.issubset(tools))
            properties = tools["run_command"].input_schema["properties"]
            command = {"command": "printf native-mcp-ok > native-mcp-test.txt; cat native-mcp-test.txt", "cwd": str(self.root)}
            if "body" in properties:
                arguments = {"body": command, "wait": 10}
            else:
                self.assertIn("command", properties, properties)
                arguments = {**command, "wait": 10}
            result = await client.call_tool("run_command", arguments)
            self.assertFalse(result.is_error)
            self.assertIn("native-mcp-ok", str(result))
            self.assertEqual((self.root / "native-mcp-test.txt").read_text(), "native-mcp-ok")


if __name__ == "__main__":
    unittest.main()
