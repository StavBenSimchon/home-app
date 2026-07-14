FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY agent/ agent/
COPY config/ config/

RUN pip install --no-cache-dir -e .

CMD ["python", "-m", "agent.main"]
