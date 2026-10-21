// Листы для печати / PDF (A4 альбомный, 200 dpi):
//   эскиз детали — виды по ГОСТ 2.305 (у тел вращения с отверстием — половина вида /
//   половина разреза), размеры, технические требования, основная надпись;
//   профиль для токарной обработки — точки контура с X(Ø) и Z для каждого установа;
//   таблица отверстий (фрезерные детали, если не уместилась на эскизе);
//   маршрутная карта — операции, переходы, инструмент и режимы.
// Виды рендерятся отдельным WebGL-рендером в ортогональной проекции: белые грани,
// контур (обратная оболочка) и рёбра CAD — чёрным.
import * as THREE from 'three';
import { segText } from './techproc.js';

const DPI = 200;
const MM = DPI / 25.4;            // пикселей на мм листа
const W = 297, H = 210;           // A4 альбом, мм
const FRAME = { l: 20, t: 5, r: 5, b: 5 };
const TB = { w: 185, h: 55 };     // основная надпись
const SCALES = [5, 4, 2.5, 2, 1, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05, 0.04, 0.025, 0.02, 0.01];
const f2 = (v) => (Math.round(v * 100) / 100 + 0).toLocaleString('ru-RU').replace(/^-0$/, '0');
// погрешность подгонки ~0,01 мм: 87,99 -> 88, если рядом «круглое» значение
const snap = (v) => { const r = Math.round(v * 20) / 20; return Math.abs(v - r) < 0.015 ? r : v; };
const scaleLabel = (s) => (s >= 1 ? `${s}:1`.replace('.', ',') : `1:${(1 / s).toString().replace('.', ',')}`);

// ---------------------------------------------------------------------------
// Рендер вида
// ---------------------------------------------------------------------------
let glr = null;
function renderer() {
	if (!glr) {
		glr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
		glr.setPixelRatio(1);
		glr.setClearColor(0xffffff, 0);
		glr.localClippingEnabled = true;
	}
	return glr;
}

// Рёбра для чертежа: только границы граней CAD с изломом больше 20°. Складки
// триангуляции внутри одной грани (мелкие отверстия, цилиндры) не рисуются —
// иначе на виде появляется «штриховка» из лишних линий.
function cadEdges(g) {
	if (g.userData._cadEdges) return g.userData._cadEdges;
	const faceOf = g.userData.faceOf;
	if (!faceOf || !g.index) return (g.userData._cadEdges = new THREE.EdgesGeometry(g, 25));
	const P = g.attributes.position.array, I = g.index.array;
	const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
	const q = Math.max(box.getSize(new THREE.Vector3()).length() * 1e-6, 1e-6);
	const key = (vi) => `${Math.round(P[vi * 3] / q)},${Math.round(P[vi * 3 + 1] / q)},${Math.round(P[vi * 3 + 2] / q)}`;
	const vk = new Array(P.length / 3);
	const kOf = (vi) => vk[vi] || (vk[vi] = key(vi));
	const normals = new Float32Array(I.length);
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	for (let t = 0; t < I.length / 3; t++) {
		a.fromArray(P, I[t * 3] * 3); b.fromArray(P, I[t * 3 + 1] * 3); c.fromArray(P, I[t * 3 + 2] * 3);
		b.sub(a); c.sub(a); b.cross(c).normalize();
		normals[t * 3] = b.x; normals[t * 3 + 1] = b.y; normals[t * 3 + 2] = b.z;
	}
	const cos = Math.cos(THREE.MathUtils.degToRad(20));
	const map = new Map();
	const out = [];
	for (let t = 0; t < I.length / 3; t++) {
		for (let j = 0; j < 3; j++) {
			const v0 = I[t * 3 + j], v1 = I[t * 3 + (j + 1) % 3];
			const k0 = kOf(v0), k1 = kOf(v1);
			const k = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
			const prev = map.get(k);
			if (prev === undefined) { map.set(k, t); continue; }
			map.delete(k);
			if (faceOf[prev] === faceOf[t]) continue;
			const d = normals[prev * 3] * normals[t * 3] + normals[prev * 3 + 1] * normals[t * 3 + 1] + normals[prev * 3 + 2] * normals[t * 3 + 2];
			if (d > cos) continue;
			out.push(P[v0 * 3], P[v0 * 3 + 1], P[v0 * 3 + 2], P[v1 * 3], P[v1 * 3 + 1], P[v1 * 3 + 2]);
		}
	}
	// свободные края (незамкнутая оболочка) — тоже линии
	for (const [k] of map) {
		const [s0, s1] = k.split('|').map((x) => x.split(',').map((n) => Number(n) * q));
		out.push(...s0, ...s1);
	}
	const eg = new THREE.BufferGeometry();
	eg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
	return (g.userData._cadEdges = eg);
}

function buildScene(meshes, outlineMm, clip) {
	const scene = new THREE.Scene();
	const planes = clip ? [clip] : [];
	const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2, clippingPlanes: planes });
	const hull = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, clippingPlanes: planes });
	hull.onBeforeCompile = (sh) => {
		sh.uniforms.uT = { value: outlineMm };
		sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uT;');
	};
	const line = new THREE.LineBasicMaterial({ color: 0x000000, clippingPlanes: planes });
	for (const m of meshes) {
		const g = m.geometry;
		if (!g.attributes.normal) g.computeVertexNormals();
		for (const obj of [new THREE.Mesh(g, white), new THREE.Mesh(g, hull), new THREE.LineSegments(cadEdges(g), line)]) {
			obj.matrixAutoUpdate = false;
			obj.matrix.copy(m.matrixWorld);
			scene.add(obj);
		}
	}
	return { scene, dispose: () => { white.dispose(); hull.dispose(); line.dispose(); } };
}

// вид: right, up — оси вида; камера смотрит против n = right × up
function makeView(box, right, up) {
	const n = new THREE.Vector3().crossVectors(right, up).normalize();
	const c = box.getCenter(new THREE.Vector3());
	let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
	for (let i = 0; i < 8; i++) {
		const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
		const u = p.dot(right), v = p.dot(up);
		umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
	}
	return { right: right.clone(), up: up.clone(), n, c, umin, umax, vmin, vmax, w: umax - umin, h: vmax - vmin };
}

// рисует вид на лист: (x0, y0) — левый верхний угол вида на листе, мм; s — масштаб
function drawView(ctx, sceneObj, view, x0, y0, s, radius) {
	const k = s * MM;                 // px листа на мм модели
	const kr = k / 2;                 // рендерим вдвое мельче и растягиваем — линии толще
	const pad = 6;                    // px рендера вокруг вида
	const wpx = Math.max(8, Math.ceil(view.w * kr) + pad * 2), hpx = Math.max(8, Math.ceil(view.h * kr) + pad * 2);
	const left = view.umin - pad / kr, top = view.vmax + pad / kr;
	const r = renderer();
	r.setSize(wpx, hpx, false);
	// кадр точно по сетке пикселей: 1 px рендера = 1/kr мм модели
	const cam = new THREE.OrthographicCamera(left, left + wpx / kr, top, top - hpx / kr, -radius * 4, radius * 4);
	cam.up.copy(view.up);
	cam.position.copy(view.c).addScaledVector(view.n, radius * 2);
	cam.lookAt(view.c);
	cam.updateProjectionMatrix();
	r.render(sceneObj.scene, cam);
	ctx.drawImage(r.domElement, x0 * MM - pad * 2, y0 * MM - pad * 2, wpx * 2, hpx * 2);
	return projector(view, x0, y0, s);
}
// проекция точки модели в координаты листа (px)
function projector(view, x0, y0, s) {
	return (p) => {
		const d = p.clone().sub(view.c);
		return [(x0 + (d.dot(view.right) - view.umin) * s) * MM, (y0 + (view.vmax - d.dot(view.up)) * s) * MM];
	};
}

// ---------------------------------------------------------------------------
// Примитивы чертежа
// ---------------------------------------------------------------------------
function pen(ctx, wMm = 0.25) { ctx.lineWidth = wMm * MM; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; }
function font(ctx, hMm, bold = false) { ctx.font = `${bold ? 'bold ' : ''}italic ${Math.round(hMm * MM)}px Arial, sans-serif`; }
function rect(ctx, x, y, w, h) { ctx.strokeRect(x * MM, y * MM, w * MM, h * MM); }
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1 * MM, y1 * MM); ctx.lineTo(x2 * MM, y2 * MM); ctx.stroke(); }
function text(ctx, s, x, y, hMm = 3.5, align = 'left', bold = false) {
	font(ctx, hMm, bold); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x * MM, y * MM);
}
function arrow(ctx, x, y, ang) {
	const L = 2.5 * MM, a = 0.32;
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x - L * Math.cos(ang - a), y - L * Math.sin(ang - a));
	ctx.lineTo(x - L * Math.cos(ang + a), y - L * Math.sin(ang + a));
	ctx.closePath(); ctx.fill();
}
function centerLine(ctx, a, b) {
	pen(ctx, 0.18); ctx.setLineDash([3 * MM, 1.2 * MM, 1 * MM, 1.2 * MM]);
	ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
}

// Занятые места на листе (px): подписи размеров не должны налезать друг на друга
class Layout {
	constructor() { this.rects = []; }
	free(r) { return !this.rects.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y); }
	take(r) { this.rects.push(r); }
}
// подпись на белой подложке, чтобы читалась поверх видов и штриховки
function label(ctx, s, cx, cy, hMm, ang = 0, align = 'center') {
	font(ctx, hMm);
	const w = ctx.measureText(s).width, h = hMm * MM;
	ctx.save();
	ctx.translate(cx, cy); ctx.rotate(ang);
	const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
	ctx.fillStyle = '#fff'; ctx.fillRect(x0 - 0.4 * MM, -h * 0.62, w + 0.8 * MM, h * 1.2);
	ctx.fillStyle = '#000'; ctx.textAlign = align; ctx.textBaseline = 'middle';
	ctx.fillText(s, 0, 0);
	ctx.restore();
}
// прямоугольник подписи (px) — для проверки наложений
function labelRect(ctx, s, cx, cy, hMm, vertical) {
	font(ctx, hMm);
	const w = ctx.measureText(s).width + 1.2 * MM, h = hMm * MM * 1.25;
	return vertical ? { x: cx - h / 2, y: cy - w / 2, w: h, h: w } : { x: cx - w / 2, y: cy - h / 2, w, h };
}
// размер между точками a, b (px) с выносом на offPx перпендикулярно; подпись — у середины
function dim(ctx, a, b, offPx, txt, lay, opts = {}) {
	const dx = b[0] - a[0], dy = b[1] - a[1];
	const len = Math.hypot(dx, dy);
	if (len < 1) return null;
	const nx = -dy / len, ny = dx / len;
	const A = [a[0] + nx * offPx, a[1] + ny * offPx], B = [b[0] + nx * offPx, b[1] + ny * offPx];
	pen(ctx, 0.18);
	const sg = Math.sign(offPx) || 1;
	ctx.beginPath();
	if (Math.abs(offPx) > 0.5 * MM) {
		const ext = sg * 2 * MM;
		ctx.moveTo(a[0] + nx * sg * 1 * MM, a[1] + ny * sg * 1 * MM); ctx.lineTo(A[0] + nx * ext, A[1] + ny * ext);
		ctx.moveTo(b[0] + nx * sg * 1 * MM, b[1] + ny * sg * 1 * MM); ctx.lineTo(B[0] + nx * ext, B[1] + ny * ext);
	}
	ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
	ctx.stroke();
	const ang = Math.atan2(dy, dx);
	arrow(ctx, B[0], B[1], ang); arrow(ctx, A[0], A[1], ang + Math.PI);
	let r = ang;
	if (r > Math.PI / 2 || r <= -Math.PI / 2) r += Math.PI;
	// подпись над размерной линией
	const hMm = opts.h || 3.2;
	const lift = (hMm * 0.55 + 0.5) * MM;
	const cx = (A[0] + B[0]) / 2 + Math.sin(r) * lift, cy = (A[1] + B[1]) / 2 - Math.cos(r) * lift;
	label(ctx, txt, cx, cy, hMm, r);
	const rr = labelRect(ctx, txt, cx, cy, hMm, Math.abs(Math.sin(r)) > 0.7);
	lay && lay.take(rr);
	return rr;
}
// выноска: стрелка в точку p, полка с текстом. Направление — заданное или ближайшее
// к нему свободное (подпись не должна лечь на другие подписи)
function leader(ctx, p, dirX, dirY, txt, lay, hMm = 3) {
	font(ctx, hMm);
	const w = ctx.measureText(txt).width + 1.5 * MM;
	const base = Math.atan2(dirY, dirX);
	const place = (ang, len) => {
		const x = p[0] + Math.cos(ang) * len * MM, y = p[1] + Math.sin(ang) * len * MM, rt = Math.cos(ang) >= -1e-6;
		return { ex: x, ey: y, right: rt, r: { x: rt ? x : x - w, y: y - hMm * MM * 1.3, w, h: hMm * MM * 1.4 } };
	};
	let pick = place(base, 8);
	search: for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
		for (const len of [8, 14]) {
			const c = place(base + k * Math.PI / 4, len);
			if (!lay || lay.free(c.r)) { pick = c; break search; }
		}
	}
	const { ex, ey, right } = pick;
	pen(ctx, 0.15);
	ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(ex, ey); ctx.lineTo(ex + (right ? w : -w), ey); ctx.stroke();
	arrow(ctx, p[0], p[1], Math.atan2(p[1] - ey, p[0] - ex));
	ctx.fillStyle = '#000'; ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'bottom';
	ctx.fillText(txt, ex + (right ? 0.6 : -0.6) * MM, ey - 0.4 * MM);
	lay && lay.take({ x: right ? ex : ex - w, y: ey - hMm * MM * 1.3, w, h: hMm * MM * 1.4 });
}
// штриховка многоугольника (px) под 45°, шаг stepMm
function hatch(ctx, poly, stepMm = 2) {
	ctx.save();
	ctx.beginPath();
	poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
	ctx.closePath();
	ctx.fillStyle = '#fff'; ctx.fill();
	ctx.clip();
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
	pen(ctx, 0.15);
	ctx.beginPath();
	const st = stepMm * MM;
	for (let c = x0 - (y1 - y0); c < x1; c += st) { ctx.moveTo(c, y1); ctx.lineTo(c + (y1 - y0), y0); }
	ctx.stroke();
	ctx.restore();
	pen(ctx, 0.4);
	ctx.beginPath();
	poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
	ctx.closePath(); ctx.stroke();
}

function newSheet() {
	const c = document.createElement('canvas');
	c.width = Math.round(W * MM); c.height = Math.round(H * MM);
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
	pen(ctx, 0.5);
	rect(ctx, FRAME.l, FRAME.t, W - FRAME.l - FRAME.r, H - FRAME.t - FRAME.b);
	return { c, ctx };
}

// основная надпись (упрощённая форма 1 по ГОСТ 2.104), 185×55 в правом нижнем углу
function titleBlock(ctx, m, sheetNo, sheets, kind) {
	const x = W - FRAME.r - TB.w, y = H - FRAME.b - TB.h;
	pen(ctx, 0.5);
	rect(ctx, x, y, 185, 55);
	// левая часть: 4 строки изменений, строка заголовков, 6 строк подписей (11 × 5 мм)
	pen(ctx, 0.25);
	for (let i = 1; i < 11; i++) line(ctx, x, y + i * 5, x + 65, y + i * 5);
	line(ctx, x + 7, y, x + 7, y + 25);                       // «Изм.» только в верхней части
	for (const cx of [17, 40, 55]) line(ctx, x + cx, y, x + cx, y + 55);
	line(ctx, x + 65, y, x + 65, y + 55);
	text(ctx, 'Изм.', x + 3.5, y + 22.5, 2.2, 'center'); text(ctx, 'Лист', x + 12, y + 22.5, 2.2, 'center');
	text(ctx, '№ докум.', x + 28.5, y + 22.5, 2.2, 'center'); text(ctx, 'Подп.', x + 47.5, y + 22.5, 2.2, 'center'); text(ctx, 'Дата', x + 60, y + 22.5, 2.2, 'center');
	const rows = [['Разраб.', m.author || ''], ['Пров.', ''], ['Т.контр.', ''], ['', ''], ['Н.контр.', ''], ['Утв.', '']];
	rows.forEach(([a, b], i) => {
		const yy = y + 27.5 + i * 5;
		text(ctx, a, x + 1, yy, 2.4);
		text(ctx, b, x + 18, yy, 2.6);
	});
	text(ctx, m.date || '', x + 60, y + 27.5, 2.2, 'center');
	// середина: обозначение / наименование / материал
	line(ctx, x + 65, y + 15, x + 185, y + 15);
	line(ctx, x + 135, y + 15, x + 135, y + 55);
	line(ctx, x + 65, y + 40, x + 135, y + 40);
	text(ctx, m.designation || '', x + 125, y + 7.5, 5, 'center', true);
	wrapText(ctx, m.name || '', x + 100, y + 27.5, 66, 4.2, true, 'center');
	text(ctx, kind, x + 100, y + 35.5, 2.6, 'center');
	wrapText(ctx, m.material || '', x + 100, y + 47.5, 66, 3.2, false, 'center');
	// справа: литера, масса, масштаб, лист
	for (const yy of [20, 35, 40]) line(ctx, x + 135, y + yy, x + 185, y + yy);
	line(ctx, x + 152, y + 15, x + 152, y + 35); line(ctx, x + 169, y + 15, x + 169, y + 35);
	line(ctx, x + 160, y + 35, x + 160, y + 40);
	text(ctx, 'Лит.', x + 143.5, y + 17.5, 2.2, 'center'); text(ctx, 'Масса', x + 160.5, y + 17.5, 2.2, 'center'); text(ctx, 'Масштаб', x + 177, y + 17.5, 2.2, 'center');
	text(ctx, m.mass || '', x + 160.5, y + 27.5, 3.2, 'center');
	text(ctx, m.scale || '', x + 177, y + 27.5, 3.2, 'center');
	text(ctx, `Лист ${sheetNo}`, x + 147.5, y + 37.5, 2.6, 'center');
	text(ctx, `Листов ${sheets}`, x + 172.5, y + 37.5, 2.6, 'center');
	text(ctx, m.org || 'RafCAD View', x + 160, y + 47.5, 3, 'center');
}

function wrapText(ctx, s, cx, cy, maxW, hMm, bold, align = 'left') {
	font(ctx, hMm, bold);
	const lines = wrapLines(ctx, s, maxW * MM);
	const lh = hMm * 1.25;
	const top = cy - (lines.length - 1) * lh / 2;
	lines.forEach((l, i) => text(ctx, l, cx, top + i * lh, hMm, align, bold));
}
function wrapLines(ctx, s, maxPx) {
	const words = String(s).split(/\s+/);
	const out = [];
	let cur = '';
	for (const w of words) {
		const t = cur ? cur + ' ' + w : w;
		if (ctx.measureText(t).width > maxPx && cur) { out.push(cur); cur = w; } else cur = t;
	}
	if (cur) out.push(cur);
	return out.length ? out : [''];
}

// технические требования: по умолчанию — над основной надписью; at = {x, y, w} — в своём месте.
// Возвращает высоту блока, мм.
function techNotes(ctx, notes, measureOnly = false, at = null) {
	const x = at ? at.x : W - FRAME.r - TB.w, wMm = at ? at.w : TB.w;
	font(ctx, 2.7);
	const lines = [];
	notes.forEach((n, i) => wrapLines(ctx, `${i + 1}. ${n}`, wMm * MM).forEach((l, j) => lines.push(j ? '    ' + l : l)));
	const hMm = lines.length * 3.7 + 2;
	if (measureOnly) return hMm;
	const y0 = at ? at.y : H - FRAME.b - TB.h - hMm;
	lines.forEach((l, i) => text(ctx, l, x, y0 + 1.5 + i * 3.7, 2.7));
	return hMm;
}
// где писать техтребования: в правой колонке, если виды оставили её свободной (≥ 72 мм),
// иначе над основной надписью — тогда виды должны уместиться по высоте ниже
const VIEW_TOP = FRAME.t + 12, VIEW_BOTTOM = H - FRAME.b - TB.h - 4;
function chooseLayout(ctx, notes, widthAt, heightAt) {
	const x0 = FRAME.l + 8, x1 = W - FRAME.r - 4;
	const full = VIEW_BOTTOM - VIEW_TOP;
	const sFull = SCALES.find((k) => heightAt(k) <= full && widthAt(k) <= x1 - x0) || 0.01;
	const colW = x1 - x0 - widthAt(sFull) - 6;
	if (colW >= 72) {
		const w = Math.min(colW, 110);
		const at = { x: x1 - w, y: VIEW_TOP, w };
		const h = techNotes(ctx, notes, true, at);
		if (VIEW_TOP + h <= VIEW_BOTTOM) return { s: sFull, notesAt: at, notesH: h, colX: x1 - w, colY: VIEW_TOP + h + 4 };
	}
	const nh = techNotes(ctx, notes, true);
	const s = SCALES.find((k) => heightAt(k) <= full - nh && widthAt(k) <= x1 - x0) || 0.01;
	return { s, notesAt: null, notesH: nh, colX: null, colY: null };
}

// изометрия в прямоугольнике (мм)
function isoView(ctx, meshes, box, r) {
	const radius = box.getSize(new THREE.Vector3()).length();
	const isoN = new THREE.Vector3(1, -1.15, 0.75).normalize();
	const isoUp = new THREE.Vector3(0, 0, 1).addScaledVector(isoN, -isoN.z).normalize();
	const iso = makeView(box, new THREE.Vector3().crossVectors(isoUp, isoN), isoUp);
	const s = Math.min(r.w / iso.w, r.h / iso.h) * 0.9;
	const sc = buildScene(meshes, 0.3 / s);
	drawView(ctx, sc, iso, r.x + (r.w - iso.w * s) / 2, r.y + (r.h - iso.h * s) / 2, s, radius);
	sc.dispose();
}

// ---------------------------------------------------------------------------
// Эскиз детали
// ---------------------------------------------------------------------------
function baseNotes(part, meta) {
	return [
		'Эскиз построен по 3D-модели. Размеры для справок.',
		'Резьбы, допуски, шероховатость и неуказанные фаски — по чертежу заказчика; неуказанные предельные отклонения — по ГОСТ 30893.1-m.',
		'Острые кромки притупить 0,3…0,5 мм.',
		`Заготовка: ${meta.blank || '—'}. Масса детали ${meta.mass || '—'}.`,
	];
}

function sketchSheet(meshes, part, meta) {
	const { c, ctx } = newSheet();
	const r = part.type === 'rotational' ? turnedSketch(ctx, meshes, part, meta) : millSketch(ctx, meshes, part, meta);
	return { c, scale: r.scale, extra: r.extra || [] };
}

// ---- тело вращения ----
function turnedSketch(ctx, meshes, part, meta) {
	const lay = new Layout();
	const box = part.box;
	const radius = box.getSize(new THREE.Vector3()).length();
	const ax = part.axis, a = ax.axis, u = ax.u, w = ax.w;
	const pr = part.profile;
	const hasPr = pr && pr.outer.points.length >= 2;
	const section = hasPr && pr.inner.points.length >= 2;
	const axial = part.holes.filter((h) => h.kind === 'axial');
	const pairs = part.flats.filter((f) => f.kind === 'pair' || f.kind === 'polygon');
	const notes = baseNotes(part, meta);
	if (hasPr) notes.splice(1, 0, 'Полный профиль с координатами точек для токарной обработки — лист 2.');
	const main = makeView(box, a, u);
	const left = makeView(box, w, u);
	const needLeft = axial.length > 0 || pairs.length > 0 || part.flats.length > 0;
	const nDiaOut = Math.min(4, part.outer.length);
	// поля под размеры: сверху общая длина, снизу цепочка в 2–3 ряда, справа — вынесенные Ø
	// выноска отверстий на виде слева уходит вправо — под неё ещё ~35 мм
	const widthAt = (wl) => (k) => (main.w + (wl ? left.w : 0)) * k + 10 + nDiaOut * 7 + (wl ? 26 + (axial.length ? 35 : 0) : 0);
	const heightAt = (k) => main.h * k + 40;
	const L1 = chooseLayout(ctx, notes, widthAt(true), heightAt);
	const L0 = chooseLayout(ctx, notes, widthAt(false), heightAt);
	const withLeft = needLeft || L1.s >= L0.s;
	const LY = withLeft ? L1 : L0;
	const s = LY.s;
	const mx = FRAME.l + 12, my = VIEW_TOP + 12;
	// главный вид: при отверстии по оси — сверху разрез, снизу вид
	const clip = section ? new THREE.Plane(u.clone().negate(), u.dot(ax.center)) : null;
	const sc = buildScene(meshes, 0.3 / s, clip);
	const P = drawView(ctx, sc, main, mx, my, s, radius);
	sc.dispose();
	const at = (t, rr, dir = u) => ax.center.clone().addScaledVector(a, ax.tmin + t).addScaledVector(dir, rr);
	if (section) {
		// разрез строим по профилю: между наружным и внутренним контуром
		const op = pr.outer.points, ip = pr.inner.points;
		const poly = [
			...op.map((q) => P(at(q.t, q.r))),
			P(at(op[op.length - 1].t, ip[ip.length - 1].r)),
			...[...ip].reverse().map((q) => P(at(q.t, q.r))),
			P(at(op[0].t, ip[0].r)),
		];
		hatch(ctx, poly, 2.2);
		// видимые за плоскостью разреза кромки уступов отверстия
		pen(ctx, 0.35);
		for (let i = 1; i < ip.length; i++) {
			if (Math.abs(ip[i].t - ip[i - 1].t) < 0.02 && Math.abs(ip[i].r - ip[i - 1].r) > 0.05) {
				const lo = Math.min(ip[i].r, ip[i - 1].r);
				const p0 = P(at(ip[i].t, 0)), p1 = P(at(ip[i].t, lo));
				ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
			}
		}
	}
	const R = part.D / 2;
	const yTop = P(at(0, R))[1];
	// общая длина — над видом
	dim(ctx, P(at(0, R)), P(at(part.length, R)), -(8 * MM), f2(part.length), lay);
	// цепочка длин — под видом, только по ступеням-цилиндрам (мелочь — на листе профиля)
	let cuts = [0, part.length, ...part.outer.flatMap((sg) => [sg.t0, sg.t1])];
	cuts = [...new Set(cuts.map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q);
	const minMm = 1.2 / s;
	const keep = [cuts[0]];
	for (const v of cuts.slice(1)) if (v - keep[keep.length - 1] >= minMm) keep.push(v); else if (v === cuts[cuts.length - 1]) keep[keep.length - 1] = v;
	if (keep.length > 2 && keep.length < 30) {
		const levels = [[], [], []];
		for (let i = 0; i < keep.length - 1; i++) {
			const pa = P(at(keep[i], -R)), pb = P(at(keep[i + 1], -R));
			const txt = f2(keep[i + 1] - keep[i]);
			font(ctx, 3.2);
			const need = ctx.measureText(txt).width + 1.5 * MM;
			const span = [Math.min(pa[0], pb[0]) + (pb[0] - pa[0]) / 2 - need / 2, 0];
			span[1] = span[0] + need;
			const lv = levels.findIndex((lst) => !lst.some(([x0, x1]) => span[0] < x1 && span[1] > x0));
			if (lv < 0) continue;
			levels[lv].push(span);
			dim(ctx, pa, pb, (7 + lv * 6) * MM, txt, lay);
		}
	}
	// диаметры ступеней: широкая ступень — прямо на виде, узкая — выносом вправо за вид
	const seen = new Set();
	const segs = [...part.outer].sort((p, q) => q.len - p.len).filter((sg) => { const k = f2(sg.d); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
	const viewRight = P(at(part.length, 0))[0];
	let outside = 0;
	for (const sg of segs.sort((p, q) => q.d - p.d)) {
		const txt = 'Ø' + f2(sg.d);
		const tm = (sg.t0 + sg.t1) / 2;
		const pa = P(at(tm, -sg.d / 2)), pb = P(at(tm, sg.d / 2));
		const rr = labelRect(ctx, txt, pa[0] - 2.4 * MM, (pa[1] + pb[1]) / 2, 3.2, true);
		if (sg.len * s >= 7 && lay.free(rr)) { dim(ctx, pa, pb, 0, txt, lay); continue; }
		const off = viewRight - P(at(sg.t1, 0))[0] + (8 + outside * 7) * MM;
		dim(ctx, P(at(sg.t1, -sg.d / 2)), P(at(sg.t1, sg.d / 2)), off, txt, lay);
		outside++;
	}
	// расточки — на половине разреза
	if (section) {
		const done = new Set();
		for (const b of [...part.bores].sort((p, q) => q.len - p.len)) {
			const k = f2(b.d); if (done.has(k) || done.size >= 4) continue;
			const tm = (b.t0 + b.t1) / 2;
			const pa = P(at(tm, 0)), pb = P(at(tm, b.d / 2));
			const txt = 'Ø' + f2(b.d);
			const rr = labelRect(ctx, txt, pa[0] - 2.4 * MM, (pa[1] + pb[1]) / 2, 3.2, true);
			if (b.len * s < 6 || !lay.free(rr)) continue;
			done.add(k);
			// размер Ø внутреннего — от оси вверх с одной стрелкой (половина изображения)
			pen(ctx, 0.18);
			ctx.beginPath(); ctx.moveTo(pa[0], pa[1] + 3 * MM); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
			arrow(ctx, pb[0], pb[1], -Math.PI / 2);
			label(ctx, txt, pa[0] - 2.2 * MM, (pa[1] + pb[1]) / 2, 3.2, -Math.PI / 2);
			lay.take(rr);
		}
	}
	// радиусы дуг профиля — выноской
	if (hasPr) {
		const rDone = new Set();
		for (const sg of pr.outer.segs) {
			if (sg.el.kind !== 'arc' || rDone.has(f2(sg.el.R))) continue;
			rDone.add(f2(sg.el.R));
			const e = sg.el;
			const a0 = pr.outer.points[sg.from], a1 = pr.outer.points[sg.to];
			const ang0 = Math.atan2(a0.r - e.rc, a0.t - e.tc), ang1 = Math.atan2(a1.r - e.rc, a1.t - e.tc);
			let sweep = ang1 - ang0;               // дуги профиля меньше 180°: берём короткую сторону
			while (sweep > Math.PI) sweep -= Math.PI * 2;
			while (sweep <= -Math.PI) sweep += Math.PI * 2;
			const am = ang0 + sweep / 2;
			const mt = e.tc + e.R * Math.cos(am), mr = e.rc + e.R * Math.sin(am);
			// у разреза верх занят штриховкой — выноски радиусов на нижней половине
			const sgn = section ? -1 : 1;
			const p = P(at(mt, sgn * mr)), cc = P(at(e.tc, sgn * e.rc));
			let dx = p[0] - cc[0], dy = p[1] - cc[1];
			if (!e.convex) { dx = -dx; dy = -dy; }
			leader(ctx, p, dx, dy, 'R' + f2(e.R), lay);
		}
	}
	// радиальные отверстия — выноской на главном виде
	for (const h of part.holes.filter((x) => x.kind === 'radial' || x.kind === 'other')) {
		const it = h.items[0];
		const p = P(at(it.t, -R * 0.6));
		leader(ctx, p, 1, 1, `${h.count > 1 ? h.count + ' отв. ' : ''}Ø${f2(h.d)}${h.through ? ' скв.' : ' гл. ' + f2(h.len)}`, lay);
	}
	// осевая линия
	centerLine(ctx, P(at(-3 / s, 0)), P(at(part.length + 3 / s, 0)));

	// вид слева: Ø, окружность центров отверстий, размер под ключ
	if (withLeft) {
		const lx = mx + main.w * s + 18 + nDiaOut * 7, ly = my + (main.h - left.h) * s / 2;
		const scL = buildScene(meshes, 0.3 / s);
		const P2 = drawView(ctx, scL, left, lx, ly, s, radius);
		scL.dispose();
		const c0 = ax.center.clone().addScaledVector(a, ax.tmin);
		const pc = P2(c0);
		centerLine(ctx, [pc[0] - (R * s + 3) * MM, pc[1]], [pc[0] + (R * s + 3) * MM, pc[1]]);
		centerLine(ctx, [pc[0], pc[1] - (R * s + 3) * MM], [pc[0], pc[1] + (R * s + 3) * MM]);
		dim(ctx, P2(c0.clone().addScaledVector(w, -R)), P2(c0.clone().addScaledVector(w, R)), -(R * s * MM + 7 * MM), 'Ø' + f2(part.D), lay);
		axial.forEach((h, i) => {
			const rr = h.pcd / 2;
			// окружность центров — штрихпунктиром
			pen(ctx, 0.18); ctx.setLineDash([3 * MM, 1.2 * MM, 1 * MM, 1.2 * MM]);
			ctx.beginPath(); ctx.arc(pc[0], pc[1], rr * s * MM, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
			// Ø окружности центров — по диагонали, чтобы не совпасть с Ø детали
			const ang = Math.PI / 4 + i * 0.35;
			const d = new THREE.Vector3().addScaledVector(w, Math.cos(ang)).addScaledVector(u, Math.sin(ang));
			dim(ctx, P2(c0.clone().addScaledVector(d, -rr)), P2(c0.clone().addScaledVector(d, rr)), 0, 'Ø' + f2(h.pcd), lay);
			// выноска на отверстие, ближайшее к правому верхнему углу вида — текст уходит наружу
			const hps = h.items.map((it) => P2(c0.clone().addScaledVector(u, Math.cos(it.angle * Math.PI / 180) * rr).addScaledVector(w, Math.sin(it.angle * Math.PI / 180) * rr)));
			const hp = hps.sort((p, q) => (q[0] - q[1]) - (p[0] - p[1]))[0];
			leader(ctx, [hp[0] + h.d / 2 * s * MM * 0.7, hp[1] - h.d / 2 * s * MM * 0.7], 1, -1, `${h.count} отв. Ø${f2(h.d)}${h.through ? '' : ' гл. ' + f2(h.len)}${h.even ? ' равном.' : ''}`, lay);
		});
		// под ключ: размер между лысками
		pairs.slice(0, 1).forEach((p) => {
			const n = p.normal.clone();
			const side = new THREE.Vector3().crossVectors(a, n).normalize();
			const off = R * 0.55;
			dim(ctx, P2(c0.clone().addScaledVector(n, -p.dist).addScaledVector(side, off)), P2(c0.clone().addScaledVector(n, p.dist).addScaledVector(side, off)), 0, 'S' + f2(p.S), lay);
		});
	}

	// изометрия — в правой колонке под техтребованиями, если там просторно, иначе слева внизу
	const isoCol = LY.colX != null ? { x: LY.colX, y: LY.colY, w: W - FRAME.r - 4 - LY.colX, h: VIEW_BOTTOM - LY.colY } : null;
	if (isoCol && isoCol.h >= 40) isoView(ctx, meshes, box, isoCol);
	else isoView(ctx, meshes, box, { x: FRAME.l + 3, y: H - FRAME.b - TB.h + 2, w: W - FRAME.r - TB.w - FRAME.l - 6, h: TB.h - 4 });
	techNotes(ctx, notes, false, LY.notesAt);
	text(ctx, `Масштаб ${scaleLabel(s)}`, FRAME.l + 4, FRAME.t + 5, 3, 'left');
	if (section) text(ctx, 'Половина вида, половина разреза', FRAME.l + 40, FRAME.t + 5, 3, 'left');
	return { scale: scaleLabel(s) };
}

// ---- корпусная деталь ----
function millSketch(ctx, meshes, part, meta) {
	const lay = new Layout();
	const box = part.box;
	const radius = box.getSize(new THREE.Vector3()).length();
	const SA = part.setups[0];
	const X = SA.right, Z = SA.normal;
	// виды по установу А: главный (спереди), сверху (со стороны установа А), слева
	const main = makeView(box, X, Z);
	const top = makeView(box, X, SA.up);
	const left = makeView(box, new THREE.Vector3().crossVectors(X, Z).negate(), Z);
	const holeRows = holeTableRows(part);
	const notes = baseNotes(part, meta);
	notes.splice(1, 0, `Координаты отверстий — от точки «0» установа (левый нижний угол вида со стороны установа), Z0 — верх установа.`);
	const nf = Math.min(6, SA.floors.length);
	const LY = chooseLayout(ctx, notes, (k) => (main.w + left.w) * k + 46 + nf * 6, (k) => (main.h + top.h) * k + 36);
	const s = LY.s;
	const area = { x: FRAME.l + 6, y: VIEW_TOP - 2 };
	const V = [
		{ v: main, x: area.x + 14, y: area.y + 10 },
		{ v: top, x: area.x + 14, y: area.y + 10 + main.h * s + 22 },
		{ v: left, x: area.x + 14 + main.w * s + 26 + nf * 6, y: area.y + 10 },
	];
	const sc = buildScene(meshes, 0.3 / s);
	const P = V.map((x) => drawView(ctx, sc, x.v, x.x, x.y, s, radius));
	sc.dispose();
	const corner = (vi, uu, vv) => [(V[vi].x + (uu - V[vi].v.umin) * s) * MM, (V[vi].y + (V[vi].v.vmax - vv) * s) * MM];
	const v0 = main, v1 = top, v2 = left;
	dim(ctx, corner(0, v0.umin, v0.vmax), corner(0, v0.umax, v0.vmax), -7 * MM, f2(v0.w), lay);
	dim(ctx, corner(0, v0.umin, v0.vmin), corner(0, v0.umin, v0.vmax), 7 * MM, f2(v0.h), lay);
	dim(ctx, corner(1, v1.umin, v1.vmin), corner(1, v1.umin, v1.vmax), 7 * MM, f2(v1.h), lay);
	dim(ctx, corner(2, v2.umin, v2.vmax), corner(2, v2.umax, v2.vmax), -7 * MM, f2(v2.w), lay);
	// глубины уровней установа А — на главном виде справа
	SA.floors.slice(0, 6).forEach((f, i) => {
		const y0 = corner(0, v0.umax, v0.vmax), y1 = corner(0, v0.umax, v0.vmax - f.depth);
		dim(ctx, y0, y1, -(7 + i * 6) * MM, f2(f.depth), lay);
	});
	// отверстия установа А — номера групп на виде сверху (как в таблице: А1, А2…)
	const p0 = corner(1, v1.umin, v1.vmin);
	SA.holes.forEach((g, gi) => {
		const L = String(gi + 1);
		for (const [x, y] of g.pts) {
			const px = p0[0] + x * s * MM, py = p0[1] - y * s * MM;
			pen(ctx, 0.15);
			ctx.beginPath(); ctx.moveTo(px - 1.5 * MM, py); ctx.lineTo(px + 1.5 * MM, py); ctx.moveTo(px, py - 1.5 * MM); ctx.lineTo(px, py + 1.5 * MM); ctx.stroke();
			label(ctx, L, px + 2 * MM, py - 2 * MM, 2.6);
		}
	});
	pen(ctx, 0.25);
	ctx.beginPath(); ctx.arc(p0[0], p0[1], 1.2 * MM, 0, Math.PI * 2); ctx.stroke();
	text(ctx, '0', p0[0] / MM - 3, p0[1] / MM + 3, 2.6, 'center');
	text(ctx, `Вид со стороны уст. А (${SA.dir})`, V[1].x, V[1].y - 5, 2.8);
	// изометрия — справа от вида сверху, под видом слева
	const ix = V[2].x - 4, iy = V[1].y - 2;
	const iw = (LY.colX != null ? LY.colX - 4 : W - FRAME.r - 4) - ix, ih = (LY.notesAt ? VIEW_BOTTOM : VIEW_BOTTOM - LY.notesH) - iy;
	if (iw > 30 && ih > 25) isoView(ctx, meshes, box, { x: ix, y: iy, w: iw, h: ih });
	else if (LY.colX != null && VIEW_BOTTOM - LY.colY > 35) isoView(ctx, meshes, box, { x: LY.colX, y: LY.colY, w: W - FRAME.r - 4 - LY.colX, h: VIEW_BOTTOM - LY.colY });
	// таблица отверстий — слева внизу (остальное — отдельным листом)
	const tb = { x: FRAME.l + 2, y: H - FRAME.b - TB.h + 1, w: W - FRAME.r - TB.w - FRAME.l - 4, h: TB.h - 2 };
	const rest = drawHoleTable(ctx, holeRows, tb, 'Отверстия');
	techNotes(ctx, notes, false, LY.notesAt);
	text(ctx, `Масштаб ${scaleLabel(s)}`, FRAME.l + 4, FRAME.t + 5, 3, 'left');
	return { scale: scaleLabel(s), extra: rest.length ? holeSheets(rest) : [] };
}

// строки таблицы отверстий: установ, буква, Ø, глубина, координаты
function holeTableRows(part) {
	const rows = [];
	part.setups.forEach((st) => st.holes.forEach((g, gi) => {
		rows.push({ head: `${st.letter}${gi + 1}`, txt: `${g.pts.length}×Ø${f2(g.d)} ${g.blind ? 'гл. ' + f2(g.len) : 'скв.'}`, coords: g.pts.map(([x, y]) => `${f2(snap(x))}; ${f2(snap(y))}`) });
	}));
	return rows;
}
// таблица отверстий в прямоугольнике; возвращает строки, которые не уместились
function drawHoleTable(ctx, rows, r, title) {
	text(ctx, title, r.x + 1, r.y + 2.5, 3, 'left', true);
	let y = r.y + 7;
	const lh = 3.4;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		font(ctx, 2.5);
		const ls = wrapLines(ctx, row.coords.map((c) => `(${c})`).join(' '), (r.w - 34) * MM);
		if (y + Math.max(1, ls.length) * lh > r.y + r.h) return rows.slice(i);
		text(ctx, row.head, r.x + 1, y, 2.6, 'left', true);
		text(ctx, row.txt, r.x + 9, y, 2.5);
		ls.forEach((l, j) => text(ctx, l, r.x + 34, y + j * lh, 2.5));
		y += Math.max(1, ls.length) * lh + 0.8;
	}
	return [];
}
function holeSheets(rows) {
	const pages = [];
	let rest = rows;
	while (rest.length) {
		const pg = newSheet();
		text(pg.ctx, 'ТАБЛИЦА ОТВЕРСТИЙ', (FRAME.l + W - FRAME.r) / 2, FRAME.t + 6, 4.5, 'center', true);
		text(pg.ctx, 'Установ и номер группы (на виде — номер); X; Y — от точки «0» установа, мм', (FRAME.l + W - FRAME.r) / 2, FRAME.t + 12, 2.8, 'center');
		const before = rest.length;
		rest = drawHoleTable(pg.ctx, rest, { x: FRAME.l + 4, y: FRAME.t + 16, w: W - FRAME.r - FRAME.l - 8, h: H - FRAME.b - 16 - FRAME.t - 16 }, '');
		pages.push(pg);
		if (rest.length === before) break;
	}
	return pages;
}

// ---------------------------------------------------------------------------
// Лист «Профиль для токарной обработки»: главный вид с номерами точек + таблица
// X — диаметр, Z — от свободного торца установа (Z0), в минус к патрону.
// ---------------------------------------------------------------------------
function profileSheets(meshes, part, meta) {
	const pr = part.profile, pl = part.plan;
	const ax = part.axis;
	const box = part.box;
	const radius = box.getSize(new THREE.Vector3()).length();
	const main = makeView(box, ax.axis, ax.u);
	// высота под вид — всё, что не нужно таблице точек (две колонки)
	const nRows = pr.outer.points.length + (pr.inner.points.length ? pr.inner.points.length + 1 : 0);
	const tableH = Math.ceil(nRows / 2) * 4.3 + 5.5 + 18;
	const area = { x: FRAME.l + 14, y: FRAME.t + 30, w: 248, h: Math.max(60, Math.min(105, H - FRAME.b - 15 - (FRAME.t + 30) - tableH)) };
	const s = SCALES.find((k) => main.w * k <= area.w && main.h * k <= area.h) || 0.01;
	const { c, ctx } = newSheet();
	text(ctx, 'ПРОФИЛЬ ДЛЯ ТОКАРНОЙ ОБРАБОТКИ', (FRAME.l + W - FRAME.r) / 2, FRAME.t + 6, 4.5, 'center', true);
	text(ctx, `${meta.name}   ·   Масштаб ${scaleLabel(s)}   ·   X — диаметр;  Z — от свободного торца установа (Z0), в минус к патрону`, (FRAME.l + W - FRAME.r) / 2, FRAME.t + 12, 2.8, 'center');
	const x0 = area.x + (area.w - main.w * s) / 2, y0 = area.y + (area.h - main.h * s) / 2;
	const sc = buildScene(meshes, 0.3 / s);
	const P = drawView(ctx, sc, main, x0, y0, s, radius);
	sc.dispose();
	const at = (t, r) => ax.center.clone().addScaledVector(ax.axis, ax.tmin + t).addScaledVector(ax.u, r);
	centerLine(ctx, P(at(-4 / s, 0)), P(at(part.length + 4 / s, 0)));
	// общая длина — выше номеров точек (они в 3 ряда над контуром)
	dim(ctx, P(at(0, part.D / 2)), P(at(part.length, part.D / 2)), -(19 * MM), f2(part.length));
	// граница установов и сторона зажима
	{
		const top = P(at(pl.split, part.D / 2 + 6 / s)), bot = P(at(pl.split, -part.D / 2 - 3 / s));
		pen(ctx, 0.25); ctx.setLineDash([2 * MM, 1 * MM]);
		ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1]); ctx.stroke(); ctx.setLineDash([]);
		const aRight = pl.aEnd === 'right';
		font(ctx, 2.8, true); ctx.textBaseline = 'top';
		ctx.textAlign = aRight ? 'left' : 'right';
		ctx.fillText(`Уст. А ${aRight ? '→' : '←'}`, bot[0] + (aRight ? 1.5 : -1.5) * MM, bot[1] + 0.5 * MM);
		ctx.textAlign = aRight ? 'right' : 'left';
		ctx.fillText(`${aRight ? '←' : '→'} Уст. Б`, bot[0] + (aRight ? -1.5 : 1.5) * MM, bot[1] + 0.5 * MM);
		if (pl.clamp) {
			font(ctx, 2.4); ctx.textAlign = 'center';
			const cm = P(at((pl.clamp.t0 + pl.clamp.t1) / 2, -part.D / 2 - 3 / s));
			ctx.fillText(`зажим в уст. Б: Ø${f2(pl.clamp.d)}`, cm[0], cm[1] + 4.5 * MM);
		}
	}

	// номера точек: наружный контур — сверху, расточка — снизу
	const mark = (pts, sign, prefix) => {
		let lastX = -1e9, level = 0;
		pts.forEach((q, i) => {
			const [px, py] = P(at(q.t, sign * q.r));
			level = px - lastX < 6.5 * MM ? (level + 1) % 3 : 0;
			lastX = px;
			const ly = py - sign * (5 + level * 4.2) * MM;
			pen(ctx, 0.15);
			ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, ly + sign * 1.8 * MM); ctx.stroke();
			ctx.beginPath(); ctx.arc(px, py, 0.6 * MM, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.beginPath(); ctx.arc(px, ly, 1.9 * MM, 0, Math.PI * 2); ctx.fill();
			pen(ctx, 0.18);
			ctx.beginPath(); ctx.arc(px, ly, 1.9 * MM, 0, Math.PI * 2); ctx.stroke();
			font(ctx, 2.2, true); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText(prefix + (i + 1), px, ly + 0.1 * MM);
		});
	};
	mark(pr.outer.points, 1, '');
	if (pr.inner.points.length) mark(pr.inner.points, -1, 'В');

	// таблица точек: две колонки под видом
	const rows = [];
	const inSet = (list, i) => list.some((q) => q.i === i);
	const z = (q, i, A, B) => [inSet(A, i) ? f2(pl.zA(q.t)) : '', inSet(B, i) ? f2(pl.zB(q.t)) : ''];
	const addRows = (prof, prefix, A, B) => prof.points.forEach((q, i) => {
		const sg = prof.segs.find((x) => x.from === i);
		const nx = prof.points[i + 1];
		const txt = sg ? segText(sg, prof.points)
			: !nx ? 'конец контура'
			: Math.abs(nx.t - q.t) < 0.02 ? `торец (уступ) до Ø${f2(nx.r * 2)}`
			: 'переход — по модели';
		rows.push([prefix + (i + 1), f2(q.r * 2), ...z(q, i, A, B), txt]);
	});
	addRows(pr.outer, '', pl.outerA, pl.outerB);
	if (pr.inner.points.length) { rows.push(['', '', '', '', 'Расточка (внутренний контур):']); addRows(pr.inner, 'В', pl.innerA, pl.innerB); }

	const pages = [{ c, ctx }];
	const colW = [9, 16, 17, 17, 72];
	const tableTop = area.y + area.h + 12;
	const rowH = 4.3;
	const bottom = H - FRAME.b - 15;
	const perCol = Math.floor((bottom - tableTop - 6) / rowH);
	let pageIdx = 0, col = 0, row = 0;
	const header = (cx, ty, cctx) => {
		const heads = ['№', 'X (Ø)', 'Z уст. А', 'Z уст. Б', 'Участок до следующей точки'];
		pen(cctx, 0.3);
		let x = cx;
		cctx.fillStyle = '#eef1f5'; cctx.fillRect(cx * MM, ty * MM, colW.reduce((p, q) => p + q, 0) * MM, 5.5 * MM); cctx.fillStyle = '#000';
		heads.forEach((h, i) => { text(cctx, h, x + (i < 4 ? colW[i] / 2 : 1.5), ty + 2.8, 2.5, i < 4 ? 'center' : 'left', true); x += colW[i]; });
		pen(cctx, 0.25); rect(cctx, cx, ty, colW.reduce((p, q) => p + q, 0), 5.5);
	};
	const colX = (k) => FRAME.l + 3 + k * 133;
	header(colX(0), tableTop, ctx);
	for (const r of rows) {
		if (row >= perCol) {
			row = 0; col++;
			if (col > 1) {
				col = 0; pageIdx++;
				const np = newSheet();
				text(np.ctx, 'ПРОФИЛЬ ДЛЯ ТОКАРНОЙ ОБРАБОТКИ (продолжение)', (FRAME.l + W - FRAME.r) / 2, FRAME.t + 6, 4.5, 'center', true);
				pages.push(np);
			}
			const top = pageIdx ? FRAME.t + 14 : tableTop;
			header(colX(col), top, pages[pageIdx].ctx);
		}
		const cctx = pages[pageIdx].ctx;
		const top = (pageIdx ? FRAME.t + 14 : tableTop) + 5.5 + row * rowH;
		let x = colX(col);
		r.forEach((v, i) => {
			if (i < 4) text(cctx, v, x + colW[i] / 2, top + rowH / 2, 2.6, 'center', i === 0);
			else { font(cctx, 2.4); const l = wrapLines(cctx, v, (colW[i] - 2) * MM)[0]; text(cctx, l, x + 1.2, top + rowH / 2, 2.4); }
			x += colW[i];
		});
		pen(cctx, 0.12); line(cctx, colX(col), top + rowH, colX(col) + colW.reduce((p, q) => p + q, 0), top + rowH);
		row++;
	}
	const note = 'Точки — по 3D-модели (вершины сетки лежат на поверхности). Z пусто — точка обрабатывается в другом установе. Допуски и шероховатость — по чертежу заказчика.';
	pages.forEach((pg) => text(pg.ctx, note, FRAME.l + 4, H - FRAME.b - 9, 2.3));
	return pages;
}

// ---------------------------------------------------------------------------
// Маршрутная карта: операция | переходы | инструмент и режимы
// ---------------------------------------------------------------------------
function routeSheets(route, meta) {
	const pages = [];
	const top = FRAME.t + 4;
	const x0 = FRAME.l + 2, x1 = W - FRAME.r - 2;
	const colNo = 12, colOp = 50, colTools = 78;
	const colSteps = x1 - x0 - colNo - colOp - colTools;
	const bodyBottom = H - FRAME.b - 16;
	let page = null, y = 0;
	const lh = 3.9;
	const start = () => {
		page = newSheet();
		pages.push(page);
		const { ctx } = page;
		text(ctx, 'МАРШРУТНАЯ КАРТА', (x0 + x1) / 2, top + 4, 5, 'center', true);
		text(ctx, `Деталь: ${meta.name}`, x0, top + 12, 3.2);
		text(ctx, `Материал: ${meta.material}`, x0 + 120, top + 12, 3.2);
		text(ctx, `Заготовка: ${meta.blank}`, x0, top + 18, 3.2);
		text(ctx, `Масса детали: ${meta.mass}   Масса заготовки: ${meta.blankMass}`, x0 + 120, top + 18, 3.2);
		y = top + 24;
		pen(ctx, 0.35);
		line(ctx, x0, y, x1, y);
		text(ctx, 'Опер.', x0 + colNo / 2, y + 3.5, 2.8, 'center', true);
		text(ctx, 'Операция, оборудование', x0 + colNo + 2, y + 3.5, 2.8, 'left', true);
		text(ctx, 'Содержание операции (переходы)', x0 + colNo + colOp + 2, y + 3.5, 2.8, 'left', true);
		text(ctx, 'Инструмент, режимы', x0 + colNo + colOp + colSteps + 2, y + 3.5, 2.8, 'left', true);
		y += 7;
		line(ctx, x0, y, x1, y);
	};
	start();
	const wrapList = (ctx, list, wMm, numbered) => {
		const out = [];
		list.forEach((s, i) => {
			const ls = wrapLines(ctx, numbered ? `${i + 1}. ${s}` : s, wMm * MM);
			ls.forEach((l, j) => out.push(j ? '   ' + l : l));
		});
		return out;
	};
	for (const op of route) {
		const { ctx } = page;
		font(ctx, 2.7);
		const stepLines = wrapList(ctx, op.steps, colSteps - 4, true);
		font(ctx, 2.4);
		const toolLines = wrapList(ctx, op.tools || [], colTools - 3, false);
		font(ctx, 3);
		const leftLines = wrapLines(ctx, op.name, (colOp - 4) * MM);
		font(ctx, 2.5);
		const eqLines = op.equip ? wrapLines(ctx, op.equip, (colOp - 4) * MM) : [];
		const need = Math.max(stepLines.length * lh, toolLines.length * 3.4, (leftLines.length + eqLines.length) * lh) + 3;
		if (y + need > bodyBottom) start();
		const c2 = page.ctx;
		const y0 = y;
		text(c2, op.no, x0 + colNo / 2, y + 3, 3.2, 'center', true);
		leftLines.forEach((l, i) => text(c2, l, x0 + colNo + 2, y + 3 + i * lh, 3, 'left', true));
		eqLines.forEach((l, i) => text(c2, l, x0 + colNo + 2, y + 3 + (leftLines.length + i) * lh, 2.5));
		stepLines.forEach((l, i) => text(c2, l, x0 + colNo + colOp + 2, y + 3 + i * lh, 2.7));
		toolLines.forEach((l, i) => text(c2, l, x0 + colNo + colOp + colSteps + 1.5, y + 3 + i * 3.4, 2.4));
		y += need;
		pen(c2, 0.18);
		line(c2, x0, y, x1, y);
		for (const cx of [colNo, colNo + colOp, colNo + colOp + colSteps]) line(c2, x0 + cx, y0, x0 + cx, y);
	}
	return pages;
}

// ---------------------------------------------------------------------------
export function renderSheets({ meshes, part, route, meta }) {
	const sketch = sketchSheet(meshes, part, meta);
	const prof = part.type === 'rotational' && part.profile && part.profile.outer.points.length >= 2 ? profileSheets(meshes, part, meta) : [];
	const holes = sketch.extra;
	const routes = routeSheets(route, meta);
	const total = 1 + prof.length + holes.length + routes.length;
	const m = { ...meta, scale: sketch.scale };
	titleBlock(sketch.c.getContext('2d'), m, 1, total, 'Эскиз детали');
	const small = (ctx, label, no) => {
		const x = W - FRAME.r - 110, y = H - FRAME.b - 12;
		pen(ctx, 0.35); rect(ctx, x, y, 110, 12);
		text(ctx, `${meta.designation} — ${label}`, x + 3, y + 6, 3, 'left', true);
		text(ctx, `Лист ${no} / ${total}`, x + 107, y + 6, 3, 'right');
	};
	let no = 2;
	prof.forEach((p) => small(p.ctx, 'профиль', no++));
	holes.forEach((p) => small(p.ctx, 'таблица отверстий', no++));
	routes.forEach((p) => {
		small(p.ctx, 'маршрутная карта', no++);
		text(p.ctx, `${meta.author ? 'Разраб. ' + meta.author + '   ' : ''}${meta.date}`, FRAME.l + 2, H - FRAME.b - 6, 2.8);
	});
	return [sketch.c, ...prof.map((p) => p.c), ...holes.map((p) => p.c), ...routes.map((p) => p.c)];
}
