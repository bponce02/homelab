FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir fastmcp==2.14.5 pymongo==4.15.3
COPY --chmod=0444 server.py /app/server.py
USER 1000:1000
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]
