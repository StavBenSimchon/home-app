FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

COPY agent/ agent/
COPY config/ config/

RUN pip install --no-cache-dir -e .

CMD ["python", "-m", "agent.main"]
