FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget unzip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Download and install Rhubarb Lip Sync
RUN wget -q https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.13.0/Rhubarb-Lip-Sync-1.13.0-Linux.zip \
    && unzip -q Rhubarb-Lip-Sync-1.13.0-Linux.zip -d /opt/ \
    && rm Rhubarb-Lip-Sync-1.13.0-Linux.zip \
    && ln -s /opt/Rhubarb-Lip-Sync-1.13.0-Linux/rhubarb /usr/local/bin/rhubarb

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
