# Docker Buddy

A local web UI for managing Docker images and Compose stacks.

## Quick Start (recommended)

```bash
./run.sh
```

Opens at **http://localhost:7070**

## Or with Docker

```bash
docker compose up -d
```

## Features

- **Images** — browse all local images, see every tag, size, creation date
- **Stacks** — list all Docker Compose stacks with running/stopped status
- **Stack detail** — inspect each service, its current image, port bindings, and health
- **Update a service** — pick a new image from your local library (or type one manually), deploy in one click
- **Upload new compose** — drag-and-drop a compose file to replace and redeploy
- **Download compose** — always download the current (possibly modified) compose file after any update

## Requirements

- Python 3.10+
- Docker daemon running
- `docker compose` v2 CLI available

## Structure

```
docker_buddy/
├── main.py              # FastAPI backend
├── requirements.txt
├── Dockerfile
├── docker-compose.yml   # Run docker-buddy itself
├── run.sh               # Dev/local quickstart
└── static/
    ├── index.html
    ├── css/styles.css
    └── js/
        ├── api.js       # API wrapper
        └── app.js       # SPA router + all pages
```
