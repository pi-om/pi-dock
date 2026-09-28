from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
import docker
import subprocess
import json
import re
import yaml
import os
import shutil
import tempfile
import socket
from datetime import datetime
from pathlib import Path
from typing import Optional

ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')

app = FastAPI(title="Docker Buddy", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def docker_client():
    return docker.from_env()


def run_json_lines(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return []
    rows = []
    for line in proc.stdout.strip().splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    return rows


def get_compose_stacks():
    proc = subprocess.run(
        ["docker", "compose", "ls", "--all", "--format", "json"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return []
    try:
        result = json.loads(proc.stdout)
    except Exception:
        return []
    if not isinstance(result, list):
        return []
    for stack in result:
        stack["Type"] = "compose"
    return result


def parse_replicas(replicas: str):
    # "1/1" or "1/1 (max 1 per node)"
    m = re.match(r"(\d+)/(\d+)", replicas or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def parse_swarm_ports(ports: str):
    # "*:5005->5005/tcp, *:9443->9443/tcp"
    publishers = []
    for part in (ports or "").split(","):
        m = re.search(r":(\d+)->(\d+)", part)
        if m:
            publishers.append({"PublishedPort": int(m.group(1)), "TargetPort": int(m.group(2))})
    return publishers


def swarm_service_state(running: int, desired: int) -> str:
    if desired == 0:
        return f"stopped ({running}/{desired})"
    if running >= desired:
        return f"running ({running}/{desired})"
    if running == 0:
        return f"exited ({running}/{desired})"
    return f"degraded ({running}/{desired})"


def get_swarm_services(stack_name: str):
    services = []
    for svc in run_json_lines(["docker", "stack", "services", stack_name, "--format", "json"]):
        running, desired = parse_replicas(svc.get("Replicas", ""))
        full_name = svc.get("Name", "")
        prefix = f"{stack_name}_"
        services.append({
            "Service": full_name[len(prefix):] if full_name.startswith(prefix) else full_name,
            "Name": full_name,
            "Image": (svc.get("Image") or "").split("@sha256:")[0],
            "Mode": svc.get("Mode", ""),
            "Replicas": svc.get("Replicas", ""),
            "Running": running,
            "Desired": desired,
            "State": swarm_service_state(running, desired),
            "Publishers": parse_swarm_ports(svc.get("Ports", "")),
        })
    return services


def get_swarm_stacks():
    stacks = []
    for row in run_json_lines(["docker", "stack", "ls", "--format", "json"]):
        name = row.get("Name")
        if not name:
            continue
        services = get_swarm_services(name)
        up = sum(1 for s in services if s["Desired"] > 0 and s["Running"] >= s["Desired"])
        down = sum(1 for s in services if s["Running"] < s["Desired"])
        any_running = any(s["Running"] > 0 for s in services)
        stacks.append({
            "Name": name,
            "Status": f"{'running' if any_running else 'exited'}({len(services)})",
            "ConfigFiles": "",
            "Type": "swarm",
            "ServicesUp": up,
            "ServicesDown": down,
        })
    return stacks


def get_stacks_list():
    return get_compose_stacks() + get_swarm_stacks()


def find_stack(stack_name: str) -> dict:
    stack = next((s for s in get_stacks_list() if s.get("Name") == stack_name), None)
    if not stack:
        raise HTTPException(status_code=404, detail="Stack not found")
    return stack


def require_compose(stack: dict):
    if stack.get("Type") == "swarm":
        raise HTTPException(
            status_code=400,
            detail="Swarm stacks don't keep a compose file on disk — use Update Image per service instead",
        )


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


# ── Containers ───────────────────────────────────────────────────────────────

@app.get("/api/containers")
def list_containers():
    client = docker_client()
    containers = []
    for c in client.containers.list(all=True):
        attrs = c.attrs
        state = attrs.get("State", {})
        ports = []
        for container_port, bindings in (attrs.get("NetworkSettings", {}).get("Ports") or {}).items():
            if not bindings:
                continue
            for b in bindings:
                host_port = b.get("HostPort", "")
                if host_port:
                    entry = f"{host_port}:{container_port}"
                    if entry not in ports:
                        ports.append(entry)

        containers.append({
            "id": c.short_id,
            "name": c.name,
            "image": c.image.tags[0] if c.image.tags else (attrs.get("Config", {}).get("Image", "")),
            "status": c.status,
            "state": state.get("Status", c.status),
            "started_at": state.get("StartedAt", ""),
            "ports": ports,
        })

    return sorted(containers, key=lambda x: x["name"].lower())


@app.get("/api/containers/{container_id}/logs")
def get_container_logs(container_id: str, tail: int = 300):
    client = docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")

    try:
        logs = container.logs(tail=tail, timestamps=False, stdout=True, stderr=True)
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))

    text = logs.decode("utf-8", errors="replace")
    return {"logs": ANSI_RE.sub("", text)}


@app.get("/api/containers/{container_id}/env")
def get_container_env(container_id: str):
    client = docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")

    env = []
    for entry in container.attrs.get("Config", {}).get("Env") or []:
        key, _, value = entry.partition("=")
        env.append({"key": key, "value": value})
    return {"name": container.name, "env": sorted(env, key=lambda e: e["key"])}


@app.post("/api/containers/{container_id}/stop")
def stop_container(container_id: str):
    client = docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")

    try:
        container.stop()
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True}


@app.post("/api/containers/{container_id}/start")
def start_container(container_id: str):
    client = docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")

    try:
        container.start()
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True}


# ── Stacks ───────────────────────────────────────────────────────────────────

@app.get("/api/stacks")
def list_stacks():
    return get_stacks_list()


@app.get("/api/stacks/{stack_name}")
def get_stack(stack_name: str):
    stack = find_stack(stack_name)

    if stack.get("Type") == "swarm":
        services = get_swarm_services(stack_name)
        return {
            "name": stack_name,
            "type": "swarm",
            "config_file": "",
            "status": stack.get("Status", ""),
            "services": services,
            "service_images": {s["Service"]: s["Image"] for s in services},
        }

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

    # Compose file unreadable from here (relative path, other user's home…):
    # fall back to the project's containers, found by their compose labels
    if not services:
        client = docker_client()
        for c in client.containers.list(all=True, filters={"label": f"com.docker.compose.project={stack_name}"}):
            svc_name = c.labels.get("com.docker.compose.service", c.name)
            ports = c.attrs.get("NetworkSettings", {}).get("Ports") or {}
            services.append({
                "Service": svc_name,
                "State": c.attrs.get("State", {}).get("Status", c.status),
                "Publishers": [
                    {"PublishedPort": int(host), "TargetPort": int(target)}
                    for host, target in sorted({
                        (b["HostPort"], cp.split("/")[0])
                        for cp, binds in ports.items() for b in (binds or []) if b.get("HostPort")
                    })
                ],
            })
            service_images.setdefault(svc_name, c.attrs.get("Config", {}).get("Image", ""))

    return {
        "name": stack_name,
        "type": "compose",
        "config_file": compose_file,
        "status": stack.get("Status", ""),
        "services": services,
        "service_images": service_images,
    }


@app.get("/api/stacks/{stack_name}/services/{service_name}")
def get_stack_service(stack_name: str, service_name: str):
    stack = find_stack(stack_name)
    if stack.get("Type") == "swarm":
        return get_swarm_service_detail(stack_name, service_name)
    return get_compose_service_detail(stack, service_name)


def strip_digest(image: str) -> str:
    return (image or "").split("@sha256:")[0]


def get_swarm_service_detail(stack_name: str, service_name: str):
    client = docker_client()
    full_name = f"{stack_name}_{service_name}"
    try:
        svc = client.api.inspect_service(full_name)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Service not found in stack")

    spec = svc.get("Spec", {})
    task_tpl = spec.get("TaskTemplate", {})
    container_spec = task_tpl.get("ContainerSpec", {})
    prev_image = (svc.get("PreviousSpec") or {}).get("TaskTemplate", {}).get("ContainerSpec", {}).get("Image", "")
    if strip_digest(prev_image) == strip_digest(container_spec.get("Image", "")):
        prev_image = ""
    mode = spec.get("Mode", {})
    replicas = next((s["Replicas"] for s in get_swarm_services(stack_name) if s["Name"] == full_name), "")

    # Swarm keeps a few past tasks per slot; their containers may already be pruned
    existing = {c.id for c in client.containers.list(all=True, filters={"label": f"com.docker.swarm.service.name={full_name}"})}
    tasks = sorted(client.api.tasks(filters={"service": full_name}), key=lambda t: t.get("CreatedAt", ""), reverse=True)

    containers = []
    for t in tasks:
        status = t.get("Status", {})
        cstatus = status.get("ContainerStatus", {})
        cid = cstatus.get("ContainerID", "")
        containers.append({
            "task_id": t.get("ID", "")[:12],
            "container_id": cid,
            "name": f"{full_name}.{t.get('Slot') or t.get('NodeID', '')[:6]}",
            "image": strip_digest(t.get("Spec", {}).get("ContainerSpec", {}).get("Image", "")),
            "state": status.get("State", ""),
            "desired_state": t.get("DesiredState", ""),
            "message": status.get("Err") or status.get("Message", ""),
            "exit_code": cstatus.get("ExitCode"),
            "created": t.get("CreatedAt", ""),
            "updated": status.get("Timestamp", ""),
            "exists": cid in existing,
        })

    return {
        "stack": stack_name,
        "service": service_name,
        "type": "swarm",
        "details": {
            "Full name": full_name,
            "Image": strip_digest(container_spec.get("Image", "")),
            "Previous image": strip_digest(prev_image),
            "Mode": "global" if "Global" in mode else "replicated",
            "Replicas": replicas,
            "Ports": ", ".join(
                f"{p.get('PublishedPort')}:{p.get('TargetPort')}/{p.get('Protocol', 'tcp')}"
                for p in (svc.get("Endpoint", {}).get("Ports") or [])
            ),
            "Command": " ".join((container_spec.get("Command") or []) + (container_spec.get("Args") or [])),
            "Mounts": ", ".join(f"{m.get('Source', '')}:{m.get('Target', '')}" for m in (container_spec.get("Mounts") or [])),
            "Restart policy": (task_tpl.get("RestartPolicy") or {}).get("Condition", ""),
            "Update status": (svc.get("UpdateStatus") or {}).get("State", ""),
            "Created": svc.get("CreatedAt", ""),
            "Updated": svc.get("UpdatedAt", ""),
        },
        "containers": containers,
    }


def get_compose_service_detail(stack: dict, service_name: str):
    client = docker_client()
    found = client.containers.list(all=True, filters={"label": [
        f"com.docker.compose.project={stack['Name']}",
        f"com.docker.compose.service={service_name}",
    ]})
    if not found:
        raise HTTPException(status_code=404, detail="No containers found for this service")
    found.sort(key=lambda c: c.attrs.get("Created", ""), reverse=True)

    containers = []
    for c in found:
        state = c.attrs.get("State", {})
        containers.append({
            "task_id": "",
            "container_id": c.id,
            "name": c.name,
            "image": c.image.tags[0] if c.image.tags else c.attrs.get("Config", {}).get("Image", ""),
            "state": state.get("Status", c.status),
            "desired_state": "",
            "message": state.get("Error", ""),
            "exit_code": state.get("ExitCode"),
            "created": c.attrs.get("Created", ""),
            "updated": state.get("FinishedAt") if state.get("Status") != "running" else state.get("StartedAt", ""),
            "exists": True,
        })
    latest = found[0].attrs
    config = latest.get("Config", {})
    return {
        "stack": stack["Name"],
        "service": service_name,
        "type": "compose",
        "details": {
            "Image": config.get("Image", ""),
            "Command": " ".join(config.get("Cmd") or []),
            "Restart policy": latest.get("HostConfig", {}).get("RestartPolicy", {}).get("Name", ""),
            "Compose file": stack.get("ConfigFiles", ""),
        },
        "containers": containers,
    }


# ── Stack redeploy from a new compose file ──────────────────────────────────

DEPLOY_DIR = Path.home() / ".docker-buddy" / "deployments"
COMPOSE_SUFFIXES = (".yml", ".yaml")


def resolve_compose_path(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if p.suffix.lower() not in COMPOSE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Pick a .yml or .yaml file")
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {p}")
    if not os.access(p, os.R_OK):
        raise HTTPException(status_code=403, detail=f"No permission to read {p}")
    return p


def compose_working_dir(stack_name: str) -> Optional[str]:
    client = docker_client()
    for c in client.containers.list(all=True, filters={"label": f"com.docker.compose.project={stack_name}"}):
        wd = c.labels.get("com.docker.compose.project.working_dir")
        if wd:
            return wd
    return None


def compose_cmd(stack: dict, compose_path: Path) -> list[str]:
    cmd = ["docker", "compose", "-p", stack["Name"], "-f", str(compose_path)]
    # Uploaded files live in DEPLOY_DIR; resolve their relative paths against the
    # stack's original directory rather than the upload folder
    if DEPLOY_DIR in compose_path.parents:
        wd = compose_working_dir(stack["Name"])
        if wd:
            cmd += ["--project-directory", wd]
    return cmd


def render_compose(stack: dict, compose_path: Path) -> tuple[dict, str]:
    """Return the file as docker will see it (merged + interpolated) and any warnings."""
    if stack.get("Type") == "swarm":
        cmd = ["docker", "stack", "config", "-c", str(compose_path)]
    else:
        cmd = compose_cmd(stack, compose_path) + ["config"]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=compose_path.parent, timeout=60)
    if proc.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Compose file is not valid:\n{proc.stderr.strip()}")
    try:
        return yaml.safe_load(proc.stdout) or {}, proc.stderr.strip()
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")


@app.get("/api/fs/browse")
def browse_fs(path: str = ""):
    p = Path(path).expanduser().resolve() if path else Path.home()
    if p.is_file():
        p = p.parent
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Folder not found: {p}")
    try:
        children = list(p.iterdir())
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"No permission to open {p}")

    entries = []
    for c in children:
        if c.name.startswith("."):
            continue
        try:
            is_dir = c.is_dir()
            if not is_dir and c.suffix.lower() not in COMPOSE_SUFFIXES:
                continue
            st = c.stat()
        except OSError:
            continue
        entries.append({
            "name": c.name,
            "path": str(c),
            "type": "dir" if is_dir else "file",
            "size": st.st_size,
            "modified": st.st_mtime,
        })
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return {
        "host": socket.gethostname(),
        "path": str(p),
        "parent": str(p.parent) if p.parent != p else None,
        "home": str(Path.home()),
        "entries": entries,
    }


@app.post("/api/stacks/{stack_name}/deploy/preview")
async def preview_stack_deploy(
    stack_name: str,
    path: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    stack = find_stack(stack_name)

    if file is not None and file.filename:
        if Path(file.filename).suffix.lower() not in COMPOSE_SUFFIXES:
            raise HTTPException(status_code=400, detail="Upload a .yml or .yaml file")
        content = await file.read()
        try:
            yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
        target_dir = DEPLOY_DIR / stack_name
        target_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        compose_path = target_dir / f"{stamp}-{Path(file.filename).name}"
        compose_path.write_bytes(content)
        source = "upload"
    elif path:
        compose_path = resolve_compose_path(path)
        source = "server"
    else:
        raise HTTPException(status_code=400, detail="Upload a file or pick one on the server")

    rendered, warnings = render_compose(stack, compose_path)
    new_services = rendered.get("services") or {}

    if stack.get("Type") == "swarm":
        current = {s["Service"]: s["Image"] for s in get_swarm_services(stack_name)}
    else:
        current = get_stack(stack_name).get("service_images") or {}

    services = []
    for name, cfg in new_services.items():
        image = strip_digest((cfg or {}).get("image", ""))
        if name not in current:
            change = "added"
        elif image and image != strip_digest(current[name]):
            change = "changed"
        else:
            change = "unchanged"
        services.append({"name": name, "image": image, "current_image": current.get(name, ""), "change": change})
    order = {"changed": 0, "added": 1, "unchanged": 2}
    services.sort(key=lambda s: (order[s["change"]], s["name"]))

    text = compose_path.read_text(errors="replace")
    return {
        "stack": stack_name,
        "type": stack.get("Type"),
        "path": str(compose_path),
        "source": source,
        "services": services,
        "not_in_file": sorted(set(current) - set(new_services)),
        "warnings": warnings,
        "content": text[:200_000],
        "truncated": len(text) > 200_000,
    }


@app.post("/api/stacks/{stack_name}/deploy")
def deploy_stack(stack_name: str, path: str = Form(...), prune: bool = Form(False)):
    stack = find_stack(stack_name)
    compose_path = resolve_compose_path(path)

    if stack.get("Type") == "swarm":
        cmd = ["docker", "stack", "deploy", "-c", str(compose_path), "--with-registry-auth"]
        if prune:
            cmd.append("--prune")
        cmd.append(stack_name)
    else:
        cmd = compose_cmd(stack, compose_path) + ["up", "-d"]
        if prune:
            cmd.append("--remove-orphans")

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=compose_path.parent, timeout=900)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Deploy still running after 15 min — check the stack page")

    output = ANSI_RE.sub("", (proc.stdout + "\n" + proc.stderr).strip())
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=output or "Deploy failed")
    return {"success": True, "command": " ".join(cmd), "output": output}


@app.post("/api/stacks/{stack_name}/services/{service_name}/update-image")
def update_service_image(
    stack_name: str,
    service_name: str,
    image: str = Form(...),
):
    stack = find_stack(stack_name)

    if stack.get("Type") == "swarm":
        return update_swarm_service_image(stack_name, service_name, image)

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
        "type": "compose",
        "pull_output": pull.stdout,
        "deploy_output": deploy.stdout,
    }


def update_swarm_service_image(stack_name: str, service_name: str, image: str):
    full_name = f"{stack_name}_{service_name}"
    if not any(s["Name"] == full_name for s in get_swarm_services(stack_name)):
        raise HTTPException(status_code=404, detail="Service not found in stack")

    # --detach=false waits for the rolling update so a failed rollout is reported
    try:
        deploy = subprocess.run(
            ["docker", "service", "update", "--image", image,
             "--with-registry-auth", "--detach=false", "--quiet", full_name],
            capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Service update still converging after 10 min — check the stack page")

    if deploy.returncode != 0:
        raise HTTPException(status_code=500, detail=deploy.stderr or deploy.stdout or "Service update failed")

    return {"success": True, "type": "swarm", "pull_output": "", "deploy_output": deploy.stdout}


@app.get("/api/stacks/{stack_name}/compose/download")
def download_compose(stack_name: str):
    stack = find_stack(stack_name)
    require_compose(stack)

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
def pull_image(name: str = Form(...), platform: str = Form("")):
    name = name.strip()
    platform = platform.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Image name is required")
    # Refuse anything docker would read as a flag rather than an image/platform
    if name.startswith("-") or not re.fullmatch(r"[A-Za-z0-9][\w.\-/:@]*", name):
        raise HTTPException(status_code=400, detail=f"Not a valid image reference: {name}")
    if platform and not re.fullmatch(r"[a-z0-9_]+/[a-z0-9_]+(/[a-z0-9_]+)?", platform):
        raise HTTPException(status_code=400, detail=f"Not a valid platform: {platform}")

    cmd = ["docker", "pull"] + (["--platform", platform] if platform else []) + [name]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr or "docker pull failed")
    return {"success": True, "output": proc.stdout.strip()}


# ── Static SPA (must be last) ─────────────────────────────────────────────────

STATIC_DIR = Path(__file__).parent / "static"
ASSET_REF_RE = re.compile(r'((?:src|href)="/((?:js|css)/[^"?]+))"')


def index_response() -> HTMLResponse:
    # Tag each /js and /css reference with its mtime so a changed file gets a new URL
    # and browsers can't keep running a stale cached copy after a deploy
    html = (STATIC_DIR / "index.html").read_text()

    def versioned(m: re.Match) -> str:
        asset = STATIC_DIR / m.group(2)
        version = int(asset.stat().st_mtime) if asset.exists() else 0
        return f'{m.group(1)}?v={version}"'

    return HTMLResponse(ASSET_REF_RE.sub(versioned, html), headers={"Cache-Control": "no-cache"})


class SPAStaticFiles(StaticFiles):
    """Serve index.html for unknown non-API paths so client-side routes survive a reload."""

    async def get_response(self, path, scope):
        if path in ("", ".", "index.html"):
            return index_response()
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code != 404 or path.startswith("api"):
                raise
            return index_response()
        # Revalidate with the ETag on every load so a deploy never leaves stale JS in the browser
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", SPAStaticFiles(directory="static", html=True), name="static")
