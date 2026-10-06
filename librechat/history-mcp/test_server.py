import importlib.util
import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import mongomock
from fastmcp import Client


class HistoryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('history_tools', Path(__file__).with_name('server.py'))
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'HISTORY_MCP_API_KEY': 'test-key-' * 8}):
            spec.loader.exec_module(self.module)
        self.addCleanup(self.module.client.close)
        self.db = mongomock.MongoClient().LibreChat
        self.module.db = self.db
        self.user = 'a' * 24
        self.other = 'b' * 24
        self.id = str(UUID(int=1))
        self.other_id = str(UUID(int=2))
        self.now = datetime.now(timezone.utc)
        self.db.conversations.insert_many([
            {'conversationId': self.id, 'user': self.user, 'title': 'Homelab history', 'updatedAt': self.now},
            {'conversationId': self.other_id, 'user': self.other, 'title': 'Other owner private', 'updatedAt': self.now},
        ])
        self.db.messages.insert_many([
            {'conversationId': self.id, 'user': self.user, 'messageId': 'm1', 'text': 'We discussed networking and Tailscale.', 'isCreatedByUser': True, 'createdAt': self.now},
            {'conversationId': self.other_id, 'user': self.other, 'messageId': 'm2', 'text': 'private other owner networking', 'createdAt': self.now},
        ])
        self.headers = patch.object(self.module, 'get_http_headers', return_value={'x-librechat-user-id': self.user})
        self.headers.start()
        self.addCleanup(self.headers.stop)

    async def call(self, name, args=None):
        async with Client(self.module.server) as client:
            result = await client.call_tool(name, args or {})
            return result.data

    async def test_list_and_search_only_own_conversations(self):
        result = await self.call('list_chats')
        self.assertEqual([r['conversation_id'] for r in result['conversations']], [self.id])
        found = await self.call('search_chats', {'query': 'networking'})
        self.assertEqual([r['conversation_id'] for r in found['conversations']], [self.id])
        self.assertEqual(found['conversations'][0]['url'], 'https://librechat.develium.dev/c/' + self.id)
        with self.assertRaises(Exception):
            await self.call('read_chat', {'conversation_id': self.other_id})

    async def test_missing_or_untrusted_user_context_fails_closed(self):
        for value in ['', '{{LIBRECHAT_USER_ID}}', '../other', self.other + 'x']:
            with patch.object(self.module, 'get_http_headers', return_value={'x-librechat-user-id': value}):
                with self.assertRaises(Exception):
                    await self.call('list_chats')

    async def test_literal_search_does_not_execute_regex(self):
        self.assertEqual((await self.call('search_chats', {'query': '.*'}))['conversations'], [])
        self.assertEqual((await self.call('search_chats', {'query': 'HOMELAB'}))['conversations'][0]['match'], 'title')
        with self.assertRaises(Exception):
            await self.call('search_chats', {'query': '  '})

    async def test_private_reasoning_tools_and_context_are_not_returned(self):
        self.db.messages.insert_one({'conversationId': self.id, 'user': self.user, 'messageId': 'm3', 'text': 'fallback private', 'contextMeta': {'secret': 'private'}, 'content': [{'type': 'thinking', 'thinking': 'private reasoning'}, {'type': 'tool_call', 'tool_call': {'output': 'private tool'}}, {'type': 'text', 'text': {'value': 'Public answer'}}], 'createdAt': self.now})
        result = await self.call('read_chat', {'conversation_id': self.id})
        self.assertEqual(result['messages'][-1]['text'], 'Public answer')
        self.assertNotIn('private', str(result['messages']))
        self.assertEqual((await self.call('search_chats', {'query': 'Public answer'}))['conversations'][0]['conversation_id'], self.id)
        self.assertEqual((await self.call('search_chats', {'query': 'fallback private'}))['conversations'], [])

    async def test_subagents_tenants_temporary_and_orphaned_messages_are_hidden(self):
        for n, fields in enumerate([{'subagentThread': {'parent': self.id}}, {'tenantId': 'different'}, {'isTemporary': True}], 3):
            cid = str(UUID(int=n))
            self.db.conversations.insert_one({'user': self.user, 'conversationId': cid, 'title': 'Hidden data', **fields})
            self.db.messages.insert_one({'user': self.user, 'conversationId': cid, 'text': 'Hidden data'})
            with self.assertRaises(Exception):
                await self.call('read_chat', {'conversation_id': cid})
        self.db.messages.insert_one({'user': self.user, 'conversationId': str(UUID(int=99)), 'text': 'Hidden data'})
        self.assertEqual((await self.call('search_chats', {'query': 'Hidden data'}))['conversations'], [])

    async def test_archives_and_pagination(self):
        self.db.conversations.insert_one({'user': self.user, 'conversationId': str(UUID(int=3)), 'title': 'Archived', 'isArchived': True, 'updatedAt': self.now})
        self.assertEqual(len((await self.call('list_chats'))['conversations']), 1)
        self.assertEqual(len((await self.call('list_chats', {'include_archived': True}))['conversations']), 2)
        result = await self.call('list_chats', {'limit': 1, 'include_archived': True})
        self.assertEqual(result['next_offset'], 1)
        self.assertEqual(len((await self.call('list_chats', {'limit': 1, 'include_archived': True, 'offset': 1}))['conversations']), 1)

    async def test_output_and_argument_limits(self):
        self.db.messages.delete_many({'user': self.user})
        for n in range(10):
            self.db.messages.insert_one({'user': self.user, 'conversationId': self.id, 'messageId': str(n), 'text': 'x' * 12000, 'createdAt': self.now})
        result = await self.call('read_chat', {'conversation_id': self.id})
        self.assertEqual(sum(len(m['text']) for m in result['messages']), 32000)
        self.assertTrue(all(m['truncated'] for m in result['messages']))
        self.assertEqual(result['next_offset'], 4)
        for args in [{'limit': 1000}, {'offset': -1}]:
            with self.assertRaises(Exception):
                await self.call('list_chats', args)

    async def test_only_read_tools_and_no_changes_to_records(self):
        before = list(self.db.messages.find({}))
        async with Client(self.module.server) as client:
            tools = await client.list_tools()
            self.assertEqual({t.name for t in tools}, {'list_chats', 'search_chats', 'read_chat'})
            for tool in tools:
                self.assertTrue(tool.annotations.readOnlyHint)
                self.assertNotIn('user', tool.inputSchema['properties'])
        await self.call('list_chats')
        await self.call('search_chats', {'query': 'networking'})
        await self.call('read_chat', {'conversation_id': self.id})
        self.assertEqual(before, list(self.db.messages.find({})))


if __name__ == '__main__':
    unittest.main()
