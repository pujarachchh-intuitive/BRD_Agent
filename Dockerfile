# FastAPI backend (webapp/server.py). Build from the project root:
#   az acr build --registry <acr-name> --image brd-backend:v1 .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production

# pandoc powers the .docx export (webapp/service.py export_docx).
RUN apt-get update \
    && apt-get install -y --no-install-recommends pandoc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY brd_agent_suite ./brd_agent_suite
COPY webapp ./webapp

# brd_agent_suite/output and brd_agent_suite/logs are mounted from Azure Files in production so
# run history survives restarts; created here so the app also works without the mounts.
RUN mkdir -p brd_agent_suite/output brd_agent_suite/logs

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "webapp.server:app", "--host", "0.0.0.0", "--port", "8000"]
