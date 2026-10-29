"""Backend error classification, connection cleanup and proxy recovery (#84)."""
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiohttp
from fastapi import FastAPI, HTTPException

import auth
import proxy
import streamrip.client.qobuz as qobuz
from server import health, request_failed


fixture_app = FastAPI()
fixture_app.add_exception_handler(Exception, request_failed)
fixture_app.get('/health')(health)


@fixture_app.get('/upstream-error')
async def upstream_error():
    raise aiohttp.ClientConnectionError('connection reset')


@fixture_app.get('/internal-error')
async def internal_error():
    raise ValueError('unexpected response')


class ConnectionLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_context_closes_session_even_when_login_fails(self):
        session = SimpleNamespace(closed=False, close=AsyncMock())
        client = SimpleNamespace(session=session, login=AsyncMock(side_effect=RuntimeError('failed login')))
        with patch.object(qobuz, 'QobuzClient', return_value=client), patch.object(auth, 'get_config'):
            with self.assertRaisesRegex(RuntimeError, 'failed login'):
                async with auth.qobuz_client():
                    self.fail('failed login must not yield')
        session.close.assert_awaited_once()

    async def test_login_endpoints_close_sessions_on_failure(self):
        for request, handler in (
            (auth.TokenLoginRequest(token='dummy'), auth.login_token),
            (auth.GoogleLoginRequest(user_id='dummy', token='dummy'), auth.login_google),
        ):
            with self.subTest(handler=handler.__name__):
                session = SimpleNamespace(closed=False, close=AsyncMock())
                client = SimpleNamespace(session=session, login=AsyncMock(side_effect=RuntimeError('rejected')))
                cfg = SimpleNamespace(session=SimpleNamespace(qobuz=SimpleNamespace()))
                with patch.object(qobuz, 'QobuzClient', return_value=client), patch.object(auth, 'get_config', return_value=cfg):
                    with self.assertRaises(HTTPException):
                        await handler(request)
                session.close.assert_awaited_once()

    async def test_actual_login_failure_can_fall_back_after_a_successful_probe(self):
        session = SimpleNamespace(closed=False, close=AsyncMock())
        client = SimpleNamespace(session=session)
        login = AsyncMock(side_effect=[aiohttp.ClientConnectionError('reset'), 'logged in'])
        with patch.multiple(proxy, _proxy=None, _detected=True), \
             patch.object(proxy._sr_client, 'PROXY_URL', None), patch.object(qobuz, 'PROXY_URL', None), \
             patch.object(proxy, 'ensure_proxy_detected', new=AsyncMock()), \
             patch.object(proxy, '_orig_login', login), \
             patch.object(proxy, '_system_proxies', return_value=['http://127.0.0.1:7890']), \
             patch.object(proxy, '_can_reach', new=AsyncMock(return_value=True)):
            self.assertEqual(await proxy._patched_login(client), 'logged in')
            self.assertEqual(login.await_count, 2)
            self.assertEqual(proxy._proxy, 'http://127.0.0.1:7890')
            self.assertEqual(qobuz.PROXY_URL, proxy._sr_client.PROXY_URL)
        session.close.assert_awaited_once()

    async def test_rejected_credentials_are_not_retried_as_network_errors(self):
        login = AsyncMock(side_effect=ValueError('invalid credentials'))
        with patch.object(proxy, 'ensure_proxy_detected', new=AsyncMock()), patch.object(proxy, '_orig_login', login):
            with self.assertRaisesRegex(ValueError, 'invalid credentials'):
                await proxy._patched_login(SimpleNamespace())
        self.assertEqual(login.await_count, 1)

    async def test_failed_cached_proxy_is_cleared_for_the_next_request(self):
        session = SimpleNamespace(closed=False, close=AsyncMock())
        with patch.multiple(proxy, _proxy='http://127.0.0.1:7890', _detected=True), \
             patch.object(proxy._sr_client, 'PROXY_URL', 'old'), patch.object(qobuz, 'PROXY_URL', 'old'), \
             patch.object(proxy, 'ensure_proxy_detected', new=AsyncMock()), \
             patch.object(proxy, '_orig_login', new=AsyncMock(side_effect=aiohttp.ClientConnectionError('reset'))):
            with self.assertRaises(aiohttp.ClientConnectionError):
                await proxy._patched_login(SimpleNamespace(session=session))
            self.assertFalse(proxy._detected)
            self.assertIsNone(proxy._proxy)
            self.assertIsNone(qobuz.PROXY_URL)


class BackendHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        cls.log = tempfile.TemporaryFile()
        cls.process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'test_backend:fixture_app', '--host', '127.0.0.1', '--port', str(port)],
            cwd=Path(__file__).parent, stdout=cls.log, stderr=cls.log,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
        )
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.base + '/health', timeout=0.2) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        cls.tearDownClass()
        raise RuntimeError('test backend failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()
        cls.log.close()

    def test_errors_are_json_and_backend_stays_alive(self):
        for endpoint, expected in (('/upstream-error', 502), ('/internal-error', 500)):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(self.base + endpoint, timeout=3)
                response = caught.exception
                self.assertEqual(response.code, expected)
                self.assertIn('application/json', response.headers['Content-Type'])
                self.assertTrue(json.load(response)['detail'])
                response.close()
                with urllib.request.urlopen(self.base + '/health', timeout=3) as health_response:
                    self.assertEqual(json.load(health_response), {'status': 'ok', 'service': 'qrip'})


if __name__ == '__main__':
    unittest.main()
