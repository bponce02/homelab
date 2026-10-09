FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir fastmcp==2.14.5
WORKDIR /app
COPY server.py .
USER 1000:1000
CMD ["python", "server.py"]
