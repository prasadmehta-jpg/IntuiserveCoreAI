"""
SANGATI Vision Service — main.py
FastAPI entry point for both CCTV agents.

Endpoints (called by Node.js API or setup UI):
  POST /vision/discover           — trigger camera discovery
  GET  /vision/cameras            — list configured cameras
  POST /vision/cameras/{id}/start — start analytics agent for a camera
  POST /vision/cameras/{id}/stop  — stop analytics agent
  GET  /vision/status             — all agent statuses
"""

import asyncio
import logging
import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent_discovery  import run_discovery_and_post, DiscoveredCamera
from agent_analytics  import VisionAnalyticsAgent, ZoneConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("vision.main")

app = FastAPI(title="SANGATI Vision Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory camera registry ─────────────────────────────────
# In production, this would be persisted to the SQLite DB via the Node API.
CAMERAS: dict[str, dict] = {}
AGENTS:  dict[str, VisionAnalyticsAgent]  = {}
TASKS:   dict[str, asyncio.Task]          = {}

PORT = int(os.getenv("VISION_PORT", 3849))


# ── Pydantic models ───────────────────────────────────────────

class CameraConfig(BaseModel):
    id:         str
    stream_url: str
    label:      Optional[str]    = None
    zone_id:    Optional[str]    = None
    zones:      list[dict]       = []   # [{zone_id, table_id, bbox: [x1,y1,x2,y2]}]


class DiscoverRequest(BaseModel):
    zone_map: Optional[dict[str, str]] = None  # camera_id → zone_id


# ── Routes ────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "agents_running": len(TASKS)}


@app.post("/vision/discover")
async def discover(req: DiscoverRequest = DiscoverRequest()):
    """Trigger LAN camera discovery."""
    log.info("Discovery triggered")
    cameras = await run_discovery_and_post(zone_map=req.zone_map)
    # Register discovered cameras
    for cam in cameras:
        CAMERAS[cam["id"]] = cam
    return {"found": len(cameras), "cameras": cameras}


@app.get("/vision/cameras")
def list_cameras():
    return list(CAMERAS.values())


@app.post("/vision/cameras/register")
def register_camera(config: CameraConfig):
    """Manually register a camera (for cameras not auto-discovered)."""
    CAMERAS[config.id] = config.dict()
    log.info(f"Camera registered: {config.id} — {config.stream_url}")
    return {"ok": True, "camera": CAMERAS[config.id]}


@app.post("/vision/cameras/{camera_id}/start")
async def start_agent(camera_id: str):
    """Start the analytics agent for a camera."""
    if camera_id not in CAMERAS:
        raise HTTPException(404, detail=f"Camera {camera_id} not registered")

    if camera_id in TASKS and not TASKS[camera_id].done():
        return {"ok": True, "message": "Agent already running"}

    cam_config = CAMERAS[camera_id]
    zone_configs = [
        ZoneConfig(
            zone_id  = z["zone_id"],
            table_id = z["table_id"],
            bbox     = tuple(z["bbox"]),
        )
        for z in cam_config.get("zones", [])
    ]

    if not zone_configs:
        raise HTTPException(400, detail="No zones configured for this camera. Map zones first.")

    agent = VisionAnalyticsAgent(
        stream_url   = cam_config["stream_url"],
        zone_configs = zone_configs,
        camera_id    = camera_id,
    )
    AGENTS[camera_id] = agent
    TASKS[camera_id]  = asyncio.create_task(agent.run())

    log.info(f"Agent started for camera {camera_id}")
    return {"ok": True, "camera_id": camera_id, "zones": len(zone_configs)}


@app.post("/vision/cameras/{camera_id}/stop")
async def stop_agent(camera_id: str):
    """Stop the analytics agent for a camera."""
    if camera_id in AGENTS:
        AGENTS[camera_id].stop()
        if camera_id in TASKS:
            TASKS[camera_id].cancel()
        log.info(f"Agent stopped for camera {camera_id}")
    return {"ok": True}


@app.get("/vision/status")
def get_status():
    """Return current state of all agents."""
    return {
        "cameras": len(CAMERAS),
        "agents":  [
            {
                "camera_id": cid,
                "running":   not TASKS[cid].done() if cid in TASKS else False,
                "tables":    [
                    {"table_id": s.table_id, "occupied": s.occupied}
                    for s in AGENTS[cid].states.values()
                ] if cid in AGENTS else [],
            }
            for cid in CAMERAS
        ],
    }


# ── Run ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting SANGATI Vision Service on port {PORT}")
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
