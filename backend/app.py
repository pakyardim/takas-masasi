"""Local sync receiver.

The browser extension posts what it reads from Yahoo to this app, which merges it into
data/league.json (and downloads team pictures into data/logos). The web UI is a static
site that loads that file and calculates everything in the browser; this app also serves
it locally so you can look at fresh data before publishing.

Run:  uvicorn backend.app:app --reload
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import imported

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Takas Masası senkron")


# ---------------------------------------------------------------- browser extension import
# The extension posts from a chrome-extension:// page that has host permission for
# 127.0.0.1, so no CORS headers are needed.

@app.get("/api/import/status")
def import_status(league_id: str | None = None):
    return imported.status(league_id)


class ImportReq(BaseModel):
    kind: str
    data: dict


@app.post("/api/import")
def do_import(req: ImportReq):
    try:
        imported.merge_import(req.kind, req.data)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"Geçersiz veri: {e}")
    return {"ok": True}


# ---------------------------------------------------------------- league data, as the static site reads it

@app.get("/data/league.json")
def league_file():
    if not imported.DATA_FILE.exists():
        raise HTTPException(404, "Henüz veri yok.")
    return FileResponse(imported.DATA_FILE, media_type="application/json", headers={"Cache-Control": "no-cache"})


@app.get("/data/logos/{name}")
def logo_file(name: str):
    path = imported.LOGO_DIR / name
    # only plain file names of downloaded pictures (no path tricks)
    if Path(name).name != name or not path.is_file():
        raise HTTPException(404, "Logo yok.")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=604800"})


# ---------------------------------------------------------------- web UI (Vite build in web/dist)
DIST = ROOT / "web" / "dist"
NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>Takas Masası</title>
<body style="font:16px/1.5 system-ui;max-width:560px;margin:60px auto;padding:0 20px">
<h2>Arayüz henüz derlenmemiş</h2>
<p>Bir kez şu komutları çalıştır, sonra bu sayfayı yenile:</p>
<pre style="background:#f5f8fa;padding:12px;border-radius:8px">cd web
npm install
npm run build</pre></body>"""

if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/favicon.svg", include_in_schema=False)
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(ROOT / "web" / "public" / "favicon.svg", media_type="image/svg+xml")


@app.get("/")
def index():
    if not (DIST / "index.html").exists():
        return HTMLResponse(NOT_BUILT, status_code=503)
    # never cache the entry page: it points at the current hashed asset files
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
