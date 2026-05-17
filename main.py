from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import docker
import subprocess
import json
import yaml
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

app = FastAPI(title="Docker Buddy", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def docker_client():
    return docker.from_env()


def get_stacks_list():
    proc = subprocess.run(
        ["docker", "compose", "ls", "--all", "--format", "json"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return []
    try:
        result = json.loads(proc.stdout)
        return result if isinstance(result, list) else []
    except Exception:
        return []


# ── Images ──────────────────────────────────────────────────────────────────

@app.get("/api/images")
def list_images():
    client = docker_client()
    images = []
    for img in client.images.list():
        size_mb = round(img.attrs.get("Size", 0) / (1024 * 1024), 1)
        created = img.attrs.get("Created", "")
        tags = img.tags if img.tags else ["<none>:<none>"]

        by_repo: dict[str, list[str]] = {}
        for tag in tags:
            if ":" in tag:
                repo, t = tag.rsplit(":", 1)
            else:
                repo, t = tag, "latest"
            by_repo.setdefault(repo, []).append(t)

        for repo, repo_tags in by_repo.items():
            images.append({
                "id": img.short_id.replace("sha256:", ""),
                "repository": repo,
                "tags": repo_tags,
                "size_mb": size_mb,
                "created": created,
            })

    return sorted(images, key=lambda x: x["repository"].lower())


# ── Stacks ───────────────────────────────────────────────────────────────────

@app.get("/api/stacks")
def list_stacks():
    return get_stacks_list()


@app.get("/api/stacks/{stack_name}")
def get_stack(stack_name: str):
    stacks = get_stacks_list()
    stack = next((s for s in stacks if s.get("Name") == stack_name), None)
    if not stack:
        raise HTTPException(status_code=404, detail="Stack not found")

    config_files = stack.get("ConfigFiles", "")
    compose_file = config_files.split(",")[0].strip() if config_files else ""

    services = []
    compose_data: dict = {}

    if compose_file and os.path.exists(compose_file):
        proc = subprocess.run(
            ["docker", "compose", "-f", compose_file, "ps", "--format", "json"],
            capture_output=True, text=True,
            cwd=os.path.dirname(compose_file),
        )
        if proc.returncode == 0:
            for line in proc.stdout.strip().splitlines():
                line = line.strip()
                if line:
                    try:
                        services.append(json.loads(line))
                    except Exception:
                        pass

        try:
            with open(compose_file) as f:
                compose_data = yaml.safe_load(f) or {}
        except Exception:
            pass

    service_images: dict[str, str] = {}
    for svc_name, svc_cfg in (compose_data.get("services") or {}).items():
        service_images[svc_name] = svc_cfg.get("image", "")

    return {
        "name": stack_name,
        "config_file": compose_file,
        "status": stack.get("Status", ""),
        "services": services,
        "service_images": service_images,
    }


@app.post("/api/stacks/{stack_name}/update-compose")
async def update_compose(stack_name: str, file: UploadFile = File(...)):
    stacks = get_stacks_list()
    stack = next((s for s in stacks if s.get("Name") == stack_name), None)
    if not stack:
        raise HTTPException(status_code=404, detail="Stack not found")

    config_files = stack.get("ConfigFiles", "")
    compose_file = config_files.split(",")[0].strip()

    content = await file.read()
    try:
        yaml.safe_load(content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    with open(compose_file, "wb") as f:
        f.write(content)

    proc = subprocess.run(
        ["docker", "compose", "-f", compose_file, "up", "-d"],
        capture_output=True, text=True,
        cwd=os.path.dirname(compose_file),
    )

    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr or "Deployment failed")

    return {"success": True, "output": proc.stdout}


@app.post("/api/stacks/{stack_name}/services/{service_name}/update-image")
def update_service_image(
    stack_name: str,
    service_name: str,
    image: str = Form(...),
):
    stacks = get_stacks_list()
    stack = next((s for s in stacks if s.get("Name") == stack_name), None)
    if not stack:
        raise HTTPException(status_code=404, detail="Stack not found")

    config_files = stack.get("ConfigFiles", "")
    compose_file = config_files.split(",")[0].strip()

    if not os.path.exists(compose_file):
        raise HTTPException(status_code=404, detail="Compose file not found")

    with open(compose_file) as f:
        compose_data = yaml.safe_load(f) or {}

    services = compose_data.get("services") or {}
    if service_name not in services:
        raise HTTPException(status_code=404, detail="Service not found in compose")

    compose_data["services"][service_name]["image"] = image

    with open(compose_file, "w") as f:
        yaml.dump(compose_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    pull = subprocess.run(
        ["docker", "compose", "-f", compose_file, "pull", service_name],
        capture_output=True, text=True,
        cwd=os.path.dirname(compose_file),
    )

    deploy = subprocess.run(
        ["docker", "compose", "-f", compose_file, "up", "-d", "--no-deps", service_name],
        capture_output=True, text=True,
        cwd=os.path.dirname(compose_file),
    )

    if deploy.returncode != 0:
        raise HTTPException(status_code=500, detail=deploy.stderr or "Deploy failed")

    return {
        "success": True,
        "pull_output": pull.stdout,
        "deploy_output": deploy.stdout,
    }


@app.get("/api/stacks/{stack_name}/compose/download")
def download_compose(stack_name: str):
    stacks = get_stacks_list()
    stack = next((s for s in stacks if s.get("Name") == stack_name), None)
    if not stack:
        raise HTTPException(status_code=404, detail="Stack not found")

    config_files = stack.get("ConfigFiles", "")
    compose_file = config_files.split(",")[0].strip()

    if not os.path.exists(compose_file):
        raise HTTPException(status_code=404, detail="Compose file not found on disk")

    return FileResponse(
        compose_file,
        media_type="application/x-yaml",
        filename=f"{stack_name}-compose.yml",
    )


# ── Image load / pull ────────────────────────────────────────────────────────

@app.post("/api/images/load")
async def load_image_tar(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix if file.filename else ".tar"
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(tmp_fd, "wb") as tmp:
            shutil.copyfileobj(file.file, tmp)
        proc = subprocess.run(
            ["docker", "load", "-i", tmp_path],
            capture_output=True, text=True, timeout=600,
        )
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=proc.stderr or "docker load failed")
        return {"success": True, "output": proc.stdout.strip()}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Load timed out (10 min)")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/images/pull")
def pull_image(name: str = Form(...)):
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Image name is required")
    proc = subprocess.run(
        ["docker", "pull", name],
        capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr or "docker pull failed")
    return {"success": True, "output": proc.stdout.strip()}


# ── Static SPA (must be last) ─────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="static", html=True), name="static")
