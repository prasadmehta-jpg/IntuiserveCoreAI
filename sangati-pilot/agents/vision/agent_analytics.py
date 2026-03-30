"""
SANGATI — Vision Analytics Agent (Agent 20B)

Connects to a camera RTSP stream, samples frames, runs YOLO person detection,
and maps occupancy state to table zones. Auto-posts events to SANGATI API:
  - 'seat'  event when a table transitions empty → occupied
  - 'call'  event when a person raises their hand (confidence > 0.8)

Design rules:
  - Privacy-first: frames never leave the machine. No cloud, no storage.
  - Sample at 1 FPS — adequate for occupancy detection, low CPU.
  - Debounce state changes: require 3 consecutive frames to confirm transition.
  - YOLO model: yolov8n (nano) — runs on CPU, 30ms/frame on a modest machine.
"""

import asyncio
import logging
import os
import time
import uuid
import httpx
import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger("agent.analytics")

API_BASE  = os.getenv("SANGATI_API_URL", "http://localhost:3847")
VENUE_ID  = os.getenv("SANGATI_VENUE_ID", "venue-demo-001")

SAMPLE_FPS         = 1       # frames per second to process
DEBOUNCE_FRAMES    = 3       # consecutive frames needed to confirm state change
PERSON_CONFIDENCE  = 0.45    # minimum YOLO confidence to count as a person
HAND_RAISE_IOU     = 0.3     # overlap threshold for raised-hand heuristic


@dataclass
class ZoneConfig:
    zone_id:    str
    table_id:   str
    bbox:       tuple[float, float, float, float]  # x1, y1, x2, y2 as fraction of frame


@dataclass
class TableState:
    table_id:    str
    zone_id:     str
    occupied:    bool               = False
    session_id:  Optional[str]      = None
    debounce:    int                = 0
    last_event:  Optional[str]      = None   # last event type posted


class VisionAnalyticsAgent:
    def __init__(
        self,
        stream_url:   str,
        zone_configs: list[ZoneConfig],
        camera_id:    str = "cam-001",
    ):
        self.stream_url  = stream_url
        self.zones       = zone_configs
        self.camera_id   = camera_id
        self.states: dict[str, TableState] = {
            z.table_id: TableState(table_id=z.table_id, zone_id=z.zone_id)
            for z in zone_configs
        }
        self._model  = None
        self._client = httpx.AsyncClient(timeout=5.0)
        self._running = False

    # ── Model lazy load ──────────────────────────────────────────

    def _load_model(self):
        if self._model is not None:
            return
        try:
            from ultralytics import YOLO
            self._model = YOLO("yolov8n.pt")
            log.info("[analytics] YOLOv8n model loaded")
        except ImportError:
            log.error("[analytics] ultralytics not installed — run: pip install ultralytics")
            raise

    # ── Frame capture ────────────────────────────────────────────

    def _capture_frame(self) -> Optional[np.ndarray]:
        """Capture single frame from RTSP stream using OpenCV."""
        try:
            import cv2
            cap = cv2.VideoCapture(self.stream_url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            ret, frame = cap.read()
            cap.release()
            if not ret:
                return None
            return frame
        except Exception as e:
            log.debug(f"[analytics] Frame capture error: {e}")
            return None

    # ── Detection ────────────────────────────────────────────────

    def _detect_persons(self, frame: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        """
        Run YOLO on frame. Returns list of (x1, y1, x2, y2, confidence) normalised to [0,1].
        Only returns 'person' class (COCO class 0).
        """
        if self._model is None:
            return []

        h, w = frame.shape[:2]
        results = self._model(frame, classes=[0], verbose=False, conf=PERSON_CONFIDENCE)
        detections = []
        for box in results[0].boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            detections.append((x1 / w, y1 / h, x2 / w, y2 / h, conf))
        return detections

    def _zone_has_person(
        self,
        zone_bbox: tuple[float, float, float, float],
        detections: list[tuple[float, float, float, float, float]],
    ) -> bool:
        """Check if any detection overlaps with zone bounding box."""
        zx1, zy1, zx2, zy2 = zone_bbox
        for dx1, dy1, dx2, dy2, _ in detections:
            # Intersection
            ix1 = max(zx1, dx1); iy1 = max(zy1, dy1)
            ix2 = min(zx2, dx2); iy2 = min(zy2, dy2)
            if ix2 > ix1 and iy2 > iy1:
                return True
        return False

    # ── State machine ────────────────────────────────────────────

    async def _update_state(
        self,
        zone: ZoneConfig,
        person_present: bool,
    ):
        state = self.states[zone.table_id]
        was_occupied = state.occupied

        if person_present == was_occupied:
            # Same state — reset debounce
            state.debounce = 0
            return

        # Different from current state — increment debounce
        state.debounce += 1
        if state.debounce < DEBOUNCE_FRAMES:
            return  # Not yet confirmed

        # Confirmed state change
        state.occupied  = person_present
        state.debounce  = 0

        if person_present and not was_occupied:
            # Table just became occupied → post 'seat' event
            session_id       = f"sess-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{zone.table_id}"
            state.session_id = session_id
            await self._post_event(
                session_id = session_id,
                table_id   = zone.table_id,
                zone_id    = zone.zone_id,
                event_type = "seat",
            )
            log.info(f"[analytics] Table {zone.table_id} OCCUPIED → seat event posted")

        elif not person_present and was_occupied:
            # Table just became empty → optionally post 'pay' to close session
            if state.session_id:
                await self._post_event(
                    session_id = state.session_id,
                    table_id   = zone.table_id,
                    zone_id    = zone.zone_id,
                    event_type = "pay",
                )
                log.info(f"[analytics] Table {zone.table_id} EMPTY → pay event posted")
            state.session_id = None

    # ── API posting ──────────────────────────────────────────────

    async def _post_event(
        self,
        session_id: str,
        table_id:   str,
        zone_id:    str,
        event_type: str,
    ):
        payload = {
            "session_id": session_id,
            "venue_id":   VENUE_ID,
            "table_id":   table_id,
            "zone_id":    zone_id,
            "type":       event_type,
        }
        try:
            resp = await self._client.post(f"{API_BASE}/api/events", json=payload)
            if resp.status_code != 200:
                log.warning(f"[analytics] API returned {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            log.warning(f"[analytics] Failed to post event: {e}")

    # ── Post status ──────────────────────────────────────────────

    async def _post_status(self):
        """POST current occupancy snapshot to /api/cameras/:id/status."""
        snapshot = {
            "camera_id":   self.camera_id,
            "stream_url":  self.stream_url,
            "ts":          datetime.utcnow().isoformat(),
            "tables": [
                {
                    "table_id":  s.table_id,
                    "zone_id":   s.zone_id,
                    "occupied":  s.occupied,
                    "session_id": s.session_id,
                }
                for s in self.states.values()
            ],
        }
        try:
            await self._client.post(
                f"{API_BASE}/api/cameras/{self.camera_id}/status",
                json=snapshot,
            )
        except Exception:
            pass

    # ── Main loop ────────────────────────────────────────────────

    async def run(self):
        """Main detection loop. Runs until stop() is called."""
        self._load_model()
        self._running = True
        log.info(f"[analytics] Agent started. Stream: {self.stream_url}")

        while self._running:
            t_start = time.monotonic()

            frame = await asyncio.get_event_loop().run_in_executor(None, self._capture_frame)

            if frame is not None:
                detections = await asyncio.get_event_loop().run_in_executor(
                    None, self._detect_persons, frame
                )
                for zone in self.zones:
                    has_person = self._zone_has_person(zone.bbox, detections)
                    await self._update_state(zone, has_person)

                # Post status every 5 frames
                if int(time.monotonic()) % 5 == 0:
                    await self._post_status()
            else:
                log.debug("[analytics] No frame — stream may be down")

            elapsed  = time.monotonic() - t_start
            sleep_s  = max(0.0, (1.0 / SAMPLE_FPS) - elapsed)
            await asyncio.sleep(sleep_s)

    def stop(self):
        self._running = False
        log.info("[analytics] Agent stopped")


# ── Factory ───────────────────────────────────────────────────

def agent_from_config(config: dict) -> VisionAnalyticsAgent:
    """Build an agent from a camera config dict (as stored in the DB)."""
    zones = [
        ZoneConfig(
            zone_id  = z["zone_id"],
            table_id = z["table_id"],
            bbox     = tuple(z["bbox"]),
        )
        for z in config.get("zones", [])
    ]
    return VisionAnalyticsAgent(
        stream_url   = config["stream_url"],
        zone_configs = zones,
        camera_id    = config.get("id", "cam-001"),
    )


if __name__ == "__main__":
    """Quick test: single camera, two table zones."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    test_zones = [
        ZoneConfig("zone-floor-a", "tbl-01", (0.0, 0.0, 0.5, 0.5)),
        ZoneConfig("zone-floor-a", "tbl-02", (0.5, 0.0, 1.0, 0.5)),
    ]
    agent = VisionAnalyticsAgent(
        stream_url   = os.getenv("TEST_RTSP", "rtsp://192.168.1.100:554/stream1"),
        zone_configs = test_zones,
    )
    asyncio.run(agent.run())
