"""HTTP boundary and same-origin frontend. Run with uvicorn server.app:app."""
import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .game import GameError, GameService
from .models import Command, Identity, PreviewInput

ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path=None):
    service = GameService(db_path or os.getenv('SALVAGE_DB', str(ROOT / 'data/rooms.sqlite3')))
    app = FastAPI(title='Salvage Exchange', docs_url=None, redoc_url=None, openapi_url=None)
    allowed = set(os.getenv('ALLOWED_ORIGINS', 'http://localhost:8000,http://127.0.0.1:8000,http://testserver').split(','))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(','))
    requests = defaultdict(deque)
    rate_lock = threading.Lock()

    @app.exception_handler(GameError)
    async def game_error(_request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        # Never echo submitted credentials or hidden plans in validation messages.
        return JSONResponse({'detail': 'Invalid request. Check values and permitted fields.'}, status_code=422)

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        response = None
        if request.method not in ['GET', 'HEAD']:
            origin = request.headers.get('origin')
            if origin and origin not in allowed:
                response = JSONResponse({'detail': 'Origin is not allowed'}, status_code=403)
            if response is None:
                data = bytearray()
                async for chunk in request.stream():
                    data.extend(chunk)
                    if len(data) > 16384:
                        response = JSONResponse({'detail': 'Request is too large'}, status_code=413)
                        break
                request._body = bytes(data)
        if response is None and request.url.path.startswith('/api/'):
            now = time.monotonic()
            ip = request.client.host if request.client else 'unknown'
            bucket = (ip, 'read' if request.method == 'GET' or request.url.path.endswith('/preview') else 'write')
            limit = 600 if bucket[1] == 'read' else 120
            with rate_lock:
                if len(requests) > 10000:
                    for k in list(requests):
                        if not requests[k] or requests[k][-1] < now - 60:
                            del requests[k]
                hits = requests[bucket]
                while hits and hits[0] < now - 60:
                    hits.popleft()
                if len(hits) >= limit:
                    response = JSONResponse({'detail': 'Too many requests. Wait a minute.'}, status_code=429)
                else:
                    hits.append(now)
        if response is None:
            response = await call_next(request)
        response.headers.update({
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
        })
        return response

    def token(authorization):
        if not authorization or not authorization.startswith('Bearer '):
            raise GameError('Rejoin key required', 401)
        return authorization[7:]

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'economy': '0.2'}

    @app.post('/api/rooms')
    def create(body: Identity):
        return service.create(body.name, body.rejoin_key)

    @app.post('/api/rooms/{code}/join')
    def join(code: str, body: Identity):
        return service.join(code.upper(), body.name, body.rejoin_key)

    @app.get('/api/rooms/{code}')
    def view(code: str, authorization: str | None = Header(default=None)):
        return service.view(code.upper(), token(authorization))

    @app.post('/api/rooms/{code}/commands')
    def command(code: str, body: Command, authorization: str | None = Header(default=None)):
        return service.command(code.upper(), token(authorization), body.model_dump())

    @app.post('/api/rooms/{code}/preview')
    def preview(code: str, body: PreviewInput, authorization: str | None = Header(default=None)):
        return service.preview(code.upper(), token(authorization), body.plan.model_dump(), body.rival_factor)

    frontend = ROOT / 'dist'
    if not frontend.exists():
        frontend = ROOT / 'web'
    if frontend.exists():
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
    return app


app = create_app()
