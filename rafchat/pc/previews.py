"""Миниатюры чертежей и моделей прямо в переписке: PDF (первая страница), DXF (контуры),
STL (модель в изометрии); у STEP — сведения из заголовка (деталь, программа)."""
from __future__ import annotations

import math
import re
import struct
from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QImage, QPainter, QPainterPath, QPen, QPolygonF

PREVIEW_EXT = {".pdf", ".dxf", ".stl"}
STEP_EXT = {".step", ".stp"}


def make_preview(path: Path, side: int = 260) -> QImage | None:
    ext = path.suffix.lower()
    try:
        if ext == ".pdf":
            return _pdf(path, side)
        if ext == ".dxf":
            return _dxf(path, side)
        if ext == ".stl" and path.stat().st_size <= 60 * 1024 * 1024:
            return _stl(path, side)
    except Exception:
        return None
    return None


# ---------------------------------------------------------------- PDF
def _pdf(path, side):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(path))
    try:
        page = doc[0]
        w, h = page.get_size()
        scale = side * 2 / max(w, h)
        pil = page.render(scale=scale).to_pil().convert("RGB")
        data = pil.tobytes("raw", "RGB")
        img = QImage(data, pil.width, pil.height, pil.width * 3, QImage.Format_RGB888).copy()
        return _framed(img, side)
    finally:
        doc.close()


def _framed(img: QImage, side: int) -> QImage:
    out = QImage(img.width() + 4, img.height() + 4, QImage.Format_RGB32)
    out.fill(QColor("#D0D0D5"))
    p = QPainter(out)
    p.drawImage(2, 2, img)
    p.end()
    return out


# ---------------------------------------------------------------- DXF
def _dxf_pairs(path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1251", errors="replace")
    lines = text.splitlines()
    for i in range(0, len(lines) - 1, 2):
        yield lines[i].strip(), lines[i + 1].strip()


def _dxf(path, side):
    segs, circles, arcs = [], [], []
    in_ent = False
    ent, data = None, []

    def flush():
        if ent is None:
            return
        g = {}
        pts = []
        for c, v in data:
            if c == "10":
                pts.append([float(v), None])
            elif c == "20" and pts and pts[-1][1] is None:
                pts[-1][1] = float(v)
            else:
                g.setdefault(c, v)
        pts = [(x, y) for x, y in pts if y is not None]
        try:
            if ent == "LINE":
                segs.append(((float(g["10"]) if "10" in g else pts[0][0], pts[0][1]), (float(g["11"]), float(g["21"]))))
            elif ent == "CIRCLE" and pts:
                circles.append((pts[0], float(g["40"])))
            elif ent == "ARC" and pts:
                arcs.append((pts[0], float(g["40"]), float(g["50"]), float(g["51"])))
            elif ent in ("LWPOLYLINE", "SPLINE") and len(pts) > 1:
                for a, b in zip(pts, pts[1:]):
                    segs.append((a, b))
                if ent == "LWPOLYLINE" and int(g.get("70", "0")) & 1:
                    segs.append((pts[-1], pts[0]))
        except (KeyError, ValueError, IndexError):
            pass

    poly = []
    for c, v in _dxf_pairs(path):
        if c == "2" and v == "ENTITIES":
            in_ent = True
            continue
        if not in_ent:
            continue
        if c == "0":
            flush()
            if ent == "VERTEX" and data:
                d = dict(data)
                try:
                    poly.append((float(d["10"]), float(d["20"])))
                except (KeyError, ValueError):
                    pass
            if v == "SEQEND" and len(poly) > 1:
                segs.extend(zip(poly, poly[1:]))
                poly = []
            if v == "ENDSEC":
                break
            ent, data = v, []
        else:
            data.append((c, v))
    flush()
    xs, ys = [], []
    for a, b in segs:
        xs += [a[0], b[0]]
        ys += [a[1], b[1]]
    for (cx, cy), r in circles:
        xs += [cx - r, cx + r]
        ys += [cy - r, cy + r]
    for (cx, cy), r, _a0, _a1 in arcs:
        xs += [cx - r, cx + r]
        ys += [cy - r, cy + r]
    if not xs:
        return None
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = max(x1 - x0, 1e-6), max(y1 - y0, 1e-6)
    S = side * 2
    k = (S - 24) / max(w, h)
    W, H = int(w * k + 24), int(h * k + 24)
    img = QImage(W, H, QImage.Format_RGB32)
    img.fill(QColor("#FFFFFF"))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setPen(QPen(QColor("#1C3D6E"), 1.6))

    def T(x, y):
        return QPointF(12 + (x - x0) * k, H - 12 - (y - y0) * k)
    for a, b in segs[:200000]:
        p.drawLine(T(*a), T(*b))
    for (cx, cy), r in circles:
        c = T(cx, cy)
        p.drawEllipse(c, r * k, r * k)
    for (cx, cy), r, a0, a1 in arcs:
        sweep = (a1 - a0) % 360 or 360
        path_ = QPainterPath()
        rect = QRectF(T(cx - r, cy + r), T(cx + r, cy - r))
        path_.arcMoveTo(rect, a0)
        path_.arcTo(rect, a0, sweep)
        p.drawPath(path_)
    p.end()
    return _framed(img, side)


# ---------------------------------------------------------------- STL
def _stl_tris(path):
    raw = path.read_bytes()
    if len(raw) >= 84:
        n = struct.unpack_from("<I", raw, 80)[0]
        if 84 + n * 50 == len(raw):
            tris = []
            step = max(1, n // 200000)
            for i in range(0, n, step):
                o = 84 + i * 50 + 12
                v = struct.unpack_from("<9f", raw, o)
                tris.append((v[0:3], v[3:6], v[6:9]))
            return tris
    txt = raw.decode("ascii", errors="ignore")
    vs = [tuple(map(float, m.groups())) for m in re.finditer(
        r"vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)", txt)]
    return [tuple(vs[i:i + 3]) for i in range(0, len(vs) - 2, 3)]


def _stl(path, side):
    tris = _stl_tris(path)
    if not tris:
        return None
    # изометрия: поворот 45° вокруг Z и ~35° вокруг X
    cz, sz = math.cos(math.radians(45)), math.sin(math.radians(45))
    cx, sx = math.cos(math.radians(-55)), math.sin(math.radians(-55))

    def rot(v):
        x, y, z = v
        x, y = x * cz - y * sz, x * sz + y * cz
        y, z = y * cx - z * sx, y * sx + z * cx
        return x, y, z
    rt = [tuple(rot(v) for v in t) for t in tris]
    xs = [v[0] for t in rt for v in t]
    ys = [v[1] for t in rt for v in t]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    S = side * 2
    k = (S - 30) / max(x1 - x0, y1 - y0, 1e-6)
    W, H = int((x1 - x0) * k + 30), int((y1 - y0) * k + 30)
    img = QImage(W, H, QImage.Format_RGB32)
    img.fill(QColor("#F4F6FA"))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    L = (0.35, -0.45, 0.82)
    ln = math.sqrt(sum(c * c for c in L))
    L = tuple(c / ln for c in L)
    faces = []
    for a, b, c in rt:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
        nx, ny, nz = nx / nl, ny / nl, nz / nl
        if nz < 0:                                  # обратная сторона
            nx, ny, nz = -nx, -ny, -nz
        shade = max(0.0, nx * L[0] + ny * L[1] + nz * L[2])
        faces.append(((a[2] + b[2] + c[2]) / 3, shade, a, b, c))
    faces.sort(key=lambda f: f[0])
    p.setPen(Qt.NoPen)
    for _z, sh, a, b, c in faces:
        v = int(70 + 160 * sh)
        p.setBrush(QColor(int(v * 0.72), int(v * 0.82), min(255, v + 10)))
        p.drawPolygon(QPolygonF([QPointF(15 + (q[0] - x0) * k, H - 15 - (q[1] - y0) * k) for q in (a, b, c)]))
    p.end()
    return _framed(img, side)


# ---------------------------------------------------------------- STEP
def step_info(path: Path) -> str:
    """«STEP · деталь Вал · Autodesk Fusion 360» — из заголовка файла."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(200_000).decode("latin-1", errors="ignore")
    except OSError:
        return ""

    def dec(s):
        # \\X2\\0412\\X0\\ — юникод в STEP
        def x2(m):
            h = m.group(1)
            return "".join(chr(int(h[i:i + 4], 16)) for i in range(0, len(h), 4))
        return re.sub(r"\\X2\\([0-9A-Fa-f]+)\\X0\\", x2, s)
    parts = []
    m = re.search(r"PRODUCT\s*\(\s*'([^']*)'", head)
    if m and m.group(1).strip():
        parts.append("деталь «" + dec(m.group(1).strip()) + "»")
    m = re.search(r"FILE_NAME\s*\((.*?)\);", head, re.S)
    if m:
        fields = re.findall(r"'([^']*)'", m.group(1))
        sysname = next((f for f in fields[::-1] if re.search(r"Fusion|SolidWorks|Inventor|KOMPAS|КОМПАС|NX|CATIA|Creo|FreeCAD",
                                                               f, re.I)), "")
        if sysname:
            parts.append(dec(sysname)[:40])
    return "STEP" + (" · " + " · ".join(parts) if parts else "")
