FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json ./
COPY web ./web
COPY scripts ./scripts
RUN node scripts/build.mjs

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY simulation/economy.py simulation/rules-v0.2.json ./simulation/
COPY --from=frontend /build/dist ./dist
RUN useradd --uid 10001 --create-home salvage && mkdir /data && chown salvage:salvage /data
USER salvage
ENV SALVAGE_DB=/data/rooms.sqlite3 PYTHONUNBUFFERED=1
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=2)"
CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
