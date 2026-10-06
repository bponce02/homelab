FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir fastmcp==2.14.5
COPY server.py /app/server.py
USER 1000:1000
CMD ["python", "/app/server.py"]
