import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from server.app import create_app


class HttpTests(unittest.TestCase):
    def setUp(self):
        Path('data/tests').mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir='data/tests')
        self.addCleanup(self.tmp.cleanup)
        self.client = TestClient(create_app(str(Path(self.tmp.name) / 'http.db')))
        self.addCleanup(self.client.close)
        self.key = '1' * 64

    def test_create_resume_auth_validation_and_security_headers(self):
        body = dict(name='HTTP crew', rejoin_key=self.key)
        response = self.client.post('/api/rooms', json=body)
        self.assertEqual(response.status_code, 200)
        code = response.json()['code']
        self.assertEqual(self.client.post('/api/rooms', json=body).json()['code'], code)
        self.assertEqual(self.client.get('/api/rooms/' + code).status_code, 401)
        auth = {'Authorization': 'Bearer ' + self.key}
        self.assertEqual(self.client.get('/api/rooms/' + code, headers=auth).json()['you']['name'], 'HTTP crew')
        self.assertEqual(self.client.post('/api/rooms', json={**body, 'credits': 9999}).status_code, 422)
        self.assertEqual(self.client.post('/api/rooms', json=body, headers={'Origin': 'https://foreign.example'}).status_code, 403)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertIn("default-src 'self'", response.headers['content-security-policy'])
        self.assertNotIn(self.key, response.text)

    def test_bounded_request_and_safe_errors(self):
        response = self.client.post('/api/rooms', content='x' * 40000, headers={'content-type': 'application/json'})
        self.assertEqual(response.status_code, 413)
        response = self.client.post('/api/rooms', json={'name': 'a', 'rejoin_key': 'secret'})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('secret', response.text)


if __name__ == '__main__':
    unittest.main()
