// Листы для печати / PDF (A4 альбомный, 200 dpi):
//   лист 1 — эскиз детали: виды по ГОСТ 2.305, размеры, таблица элементов, основная надпись;
//   лист 2… — маршрутная карта.
// Виды рендерятся отдельным WebGL-рендером в ортогональной проекции: белые грани,
// контур (обратная оболочка) и рёбра CAD — чёрным.
import * as THREE from 'three';
import { segText } from './techproc.js';

const DPI = 200;
const MM = DPI / 25.4;            // пикселей на мм листа
const W = 297, H = 210;           // A4 альбом, мм
const FRAME = { l: 20, t: 5, r: 5, b: 5 };
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
	}
	return glr;
}

function buildScene(meshes, outlineMm) {
	const scene = new THREE.Scene();
	const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
	const hull = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
	hull.onBeforeCompile = (sh) => {
		sh.uniforms.uT = { value: outlineMm };
		sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uT;');
	};
	const line = new THREE.LineBasicMaterial({ color: 0x000000 });
	for (const m of meshes) {
		const g = m.geometry;
		if (!g.attributes.normal) g.computeVertexNormals();
		if (!g.userData._edges25) g.userData._edges25 = new THREE.EdgesGeometry(g, 25);
		for (const obj of [new THREE.Mesh(g, white), new THREE.Mesh(g, hull), new THREE.LineSegments(g.userData._edges25, line)]) {
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
	// проекция точки модели в координаты листа (px)
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
// размер между точками a, b (px) с выносом на offPx перпендикулярно
function dim(ctx, a, b, offPx, label) {
	const dx = b[0] - a[0], dy = b[1] - a[1];
	const len = Math.hypot(dx, dy);
	if (len < 1) return;
	const nx = -dy / len, ny = dx / len;
	const A = [a[0] + nx * offPx, a[1] + ny * offPx], B = [b[0] + nx * offPx, b[1] + ny * offPx];
	pen(ctx, 0.18);
	const ext = Math.sign(offPx) * 2 * MM;
	ctx.beginPath();
	ctx.moveTo(a[0] + nx * Math.sign(offPx) * 1 * MM, a[1] + ny * Math.sign(offPx) * 1 * MM); ctx.lineTo(A[0] + nx * ext, A[1] + ny * ext);
	ctx.moveTo(b[0] + nx * Math.sign(offPx) * 1 * MM, b[1] + ny * Math.sign(offPx) * 1 * MM); ctx.lineTo(B[0] + nx * ext, B[1] + ny * ext);
	ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
	ctx.stroke();
	const ang = Math.atan2(dy, dx);
	arrow(ctx, B[0], B[1], ang); arrow(ctx, A[0], A[1], ang + Math.PI);
	ctx.save();
	ctx.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
	let r = ang;
	if (r > Math.PI / 2 || r <= -Math.PI / 2) r += Math.PI;
	ctx.rotate(r);
	font(ctx, 3.2); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
	ctx.fillText(label, 0, -0.6 * MM);
	ctx.restore();
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
	const x = W - FRAME.r - 185, y = H - FRAME.b - 55;
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

// ---------------------------------------------------------------------------
// Лист 1 — эскиз детали
// ---------------------------------------------------------------------------
function sketchSheet(meshes, part, meta) {
	const { c, ctx } = newSheet();
	const box = part.box;
	const radius = box.getSize(new THREE.Vector3()).length();
	const area = { x: FRAME.l + 6, y: FRAME.t + 8, w: 178, h: 128 };   // область видов
	let views, s;

	if (part.type === 'rotational') {
		const a = part.axis.axis, u = part.axis.u, w = part.axis.w;
		const main = makeView(box, a, u);
		const left = makeView(box, w, u);
		const nOut = Math.min(3, part.outer.length);
		const gap = 20 + nOut * 7;
		const fits = (k, withLeft) => (main.w + (withLeft ? left.w : 0)) * k + (withLeft ? gap : 12) + 22 <= area.w + 8 && Math.max(main.h, left.h) * k + 40 <= area.h;
		const sWith = SCALES.find((k) => fits(k, true)) || 0.01;
		const sMain = SCALES.find((k) => fits(k, false)) || 0.01;
		// вид слева (круг) нужен, только если не мешает крупному главному виду
		const withLeft = sWith >= sMain;
		s = withLeft ? sWith : sMain;
		views = [{ v: main, x: area.x + 18, y: area.y + 16 }];
		if (withLeft) views.push({ v: left, x: area.x + 18 + main.w * s + gap, y: area.y + 16 });
	} else {
		const sz = box.getSize(new THREE.Vector3());
		const X = sz.y > sz.x ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const Z = new THREE.Vector3(0, 0, 1);
		const main = makeView(box, X, Z);
		const top = makeView(box, X, new THREE.Vector3().crossVectors(Z, X));
		const left = makeView(box, new THREE.Vector3().crossVectors(X, Z), Z);
		s = SCALES.find((k) => (main.w + left.w) * k + 40 <= area.w && (main.h + top.h) * k + 35 <= area.h) || 0.01;
		views = [
			{ v: main, x: area.x + 16, y: area.y + 10 },
			{ v: top, x: area.x + 16, y: area.y + 10 + main.h * s + 20 },
			{ v: left, x: area.x + 16 + main.w * s + 22, y: area.y + 10 },
		];
	}
	const sc = buildScene(meshes, 0.3 / s);
	const proj = views.map((V) => drawView(ctx, sc, V.v, V.x, V.y, s, radius));
	// изометрия справа вверху (без масштаба)
	// изометрия с той же стороны, что и в окне программы
	const isoN = new THREE.Vector3(1, -1.15, 0.75).normalize();
	const isoUp = new THREE.Vector3(0, 0, 1).addScaledVector(isoN, -isoN.z).normalize();
	const iso = makeView(box, new THREE.Vector3().crossVectors(isoUp, isoN), isoUp);
	const isoBox = { x: W - FRAME.r - 80, y: FRAME.t + 6, w: 72, h: 60 };
	const sIso = Math.min(isoBox.w / iso.w, isoBox.h / iso.h) * 0.9;
	const isoScene = buildScene(meshes, 0.3 / sIso);
	drawView(ctx, isoScene, iso, isoBox.x + (isoBox.w - iso.w * sIso) / 2, isoBox.y + (isoBox.h - iso.h * sIso) / 2, sIso, radius);
	isoScene.dispose();
	sc.dispose();

	// размеры
	if (part.type === 'rotational') {
		const P = proj[0];
		const ax = part.axis;
		const at = (t, r) => ax.center.clone().addScaledVector(ax.axis, ax.tmin + t).addScaledVector(ax.u, r);
		const R = part.D / 2;
		// общая длина — над видом
		dim(ctx, P(at(0, R)), P(at(part.length, R)), -(7 * MM), f2(part.length));
		// цепочка длин — под видом: по всем точкам профиля (если он есть), иначе по цилиндрам
		const pr = part.profile && part.profile.outer.points.length >= 2 ? part.profile.outer : null;
		let cuts = pr ? pr.points.map((q) => q.t) : part.outer.flatMap((sg) => [sg.t0, sg.t1]);
		cuts = [...new Set([0, part.length, ...cuts].map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q);
		// слишком мелкие участки на листе объединяем, чтобы подписи не налезали
		const minMm = 4.5 / s;
		const keep = [cuts[0]];
		for (const v of cuts.slice(1, -1)) if (v - keep[keep.length - 1] >= minMm) keep.push(v);
		const lastCut = cuts[cuts.length - 1];
		if (keep.length > 1 && lastCut - keep[keep.length - 1] < minMm) keep.pop();   // крошечный последний участок — к соседнему
		keep.push(lastCut);
		if (keep.length > 2 && keep.length < 25) {
			for (let i = 0; i < keep.length - 1; i++) dim(ctx, P(at(keep[i], -R)), P(at(keep[i + 1], -R)), 6 * MM, f2(keep[i + 1] - keep[i]));
		}
		// радиусы дуг профиля — подписью с выноской
		if (pr) {
			for (const sg of pr.segs) {
				if (sg.el.kind !== 'arc') continue;
				const e = sg.el;
				const a0 = pr.points[sg.from], a1 = pr.points[sg.to];
				const ang0 = Math.atan2(a0.r - e.rc, a0.t - e.tc), ang1 = Math.atan2(a1.r - e.rc, a1.t - e.tc);
				let sweep = ang1 - ang0;               // дуги профиля меньше 180°: берём короткую сторону
				while (sweep > Math.PI) sweep -= Math.PI * 2;
				while (sweep <= -Math.PI) sweep += Math.PI * 2;
				const am = ang0 + sweep / 2;
				const mt = e.tc + e.R * Math.cos(am), mr = e.rc + e.R * Math.sin(am);
				const [px, py] = P(at(mt, mr));
				const [cx, cy] = P(at(e.tc, e.rc));
				const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy) || 1;
				const ex = px + dx / l * 7 * MM, ey = py + dy / l * 7 * MM;
				pen(ctx, 0.15);
				ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.lineTo(ex + (dx >= 0 ? 9 : -9) * MM, ey); ctx.stroke();
				arrow(ctx, px, py, Math.atan2(py - ey, px - ex));
				font(ctx, 3); ctx.textAlign = dx >= 0 ? 'left' : 'right'; ctx.textBaseline = 'bottom';
				ctx.fillText('R' + f2(e.R), ex + (dx >= 0 ? 0.5 : -0.5) * MM, ey - 0.4 * MM);
			}
		}
		// диаметры ступеней: на широкой ступени — прямо на виде, на узкой — выносом вправо
		const seen = new Set();
		const segs = [...part.outer].sort((p, q) => q.len - p.len).filter((sg) => { const k = f2(sg.d); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
		const viewRight = P(at(part.length, 0))[0];
		let outside = 0;
		for (const sg of segs.sort((p, q) => q.d - p.d)) {
			const tm = (sg.t0 + sg.t1) / 2;
			const a = P(at(tm, -sg.d / 2)), b = P(at(tm, sg.d / 2));
			if (sg.len * s >= 9) dim(ctx, a, b, 0, 'Ø' + f2(sg.d));
			else {
				const xs = P(at(sg.t1, 0))[0];
				const off = viewRight - xs + (8 + outside * 7) * MM;
				dim(ctx, P(at(sg.t1, -sg.d / 2)), P(at(sg.t1, sg.d / 2)), off, 'Ø' + f2(sg.d));
				outside++;
			}
		}
		// вид слева: наружный диаметр
		if (proj[1]) {
			const P2 = proj[1];
			const c0 = ax.center.clone().addScaledVector(ax.axis, ax.tmin);
			dim(ctx, P2(c0.clone().addScaledVector(ax.w, -R)), P2(c0.clone().addScaledVector(ax.w, R)), -(R * s * MM + 7 * MM), 'Ø' + f2(part.D));
		}
		// осевая линия на главном виде
		pen(ctx, 0.18); ctx.setLineDash([6 * MM / 2, 1.2 * MM, 1 * MM, 1.2 * MM]);
		const a0 = P(at(-3 / s, 0)), a1 = P(at(part.length + 3 / s, 0));
		ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke(); ctx.setLineDash([]);
	} else {
		const V = views.map((x) => x.v);
		const corner = (vi, uu, vv) => {
			const v = V[vi];
			return [(views[vi].x + (uu - v.umin) * s) * MM, (views[vi].y + (v.vmax - vv) * s) * MM];
		};
		dim(ctx, corner(0, V[0].umin, V[0].vmin), corner(0, V[0].umax, V[0].vmin), 7 * MM, f2(V[0].w));
		dim(ctx, corner(0, V[0].umin, V[0].vmin), corner(0, V[0].umin, V[0].vmax), -7 * MM, f2(V[0].h));
		dim(ctx, corner(1, V[1].umin, V[1].vmin), corner(1, V[1].umin, V[1].vmax), -7 * MM, f2(V[1].h));
		// координаты центров отверстий на виде сверху — от левого нижнего угла
		const top = V[1];
		part.holeCoords = [];
		for (const h of part.holes) {
			const pts = h.items.map((g) => {
				const d = g.center.clone().sub(top.c);
				return [snap(d.dot(top.right) - top.umin), snap(d.dot(top.up) - top.vmin)];
			}).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
			part.holeCoords.push({ d: h.d, pts });
		}
		const origin = corner(1, top.umin, top.vmin);
		pen(ctx, 0.25);
		ctx.beginPath(); ctx.arc(origin[0], origin[1], 1.2 * MM, 0, Math.PI * 2); ctx.stroke();
		text(ctx, '0', origin[0] / MM - 3, origin[1] / MM + 3, 2.6, 'center');
	}

	// таблица элементов (слева внизу)
	const rows = elementRows(part);
	const tx = FRAME.l + 3, ty = H - FRAME.b - 55, tw = W - FRAME.r - 185 - FRAME.l - 6;
	pen(ctx, 0.35);
	text(ctx, part.type === 'rotational' ? 'Поверхности и отверстия' : 'Отверстия и элементы', tx, ty + 3, 3, 'left', true);
	pen(ctx, 0.18);
	let yy = ty + 8;
	for (const [k, v] of rows) {
		font(ctx, 2.7);
		const ls = wrapLines(ctx, v, (tw - 26) * MM);
		if (yy + ls.length * 3.6 > H - FRAME.b - 2) break;
		text(ctx, k, tx, yy, 2.7);
		ls.forEach((l, i) => text(ctx, l, tx + 24, yy + i * 3.6, 2.7));
		yy += Math.max(5, ls.length * 3.6 + 1.4);
	}

	// технические требования / примечание (справа над надписью)
	const nx = W - FRAME.r - 80, ny = FRAME.t + 72;
	text(ctx, 'Примечания', nx, ny, 3, 'left', true);
	const notes = [
		'1. Эскиз построен по 3D-модели, размеры для справок.',
		'2. Резьбы, допуски, шероховатость, фаски — по чертежу заказчика.',
		...(part.type === 'rotational' && part.profile && part.profile.outer.points.length >= 2 ? ['Полный профиль с координатами точек — лист 2.'] : []),
		`Заготовка: ${meta.blank || '—'}.`,
		`Масса детали ${meta.mass || '—'}.`,
	];
	let ly = ny + 6;
	font(ctx, 2.7);
	for (const n of notes.map((t, i) => `${i + 1}. ` + t.replace(/^\d+\.\s*/, ''))) {
		const ls = wrapLines(ctx, n, 76 * MM);
		for (const l of ls) { text(ctx, l, nx, ly, 2.7); ly += 3.8; }
	}
	text(ctx, `Масштаб видов ${scaleLabel(s)}`, area.x, FRAME.t + 5, 3, 'left');

	return { c, scale: scaleLabel(s) };
}

function elementRows(part) {
	const rows = [];
	if (part.type === 'rotational') {
		const outer = [...part.outer].sort((a, b) => a.t0 - b.t0);
		if (outer.length) rows.push(['Наружные:', outer.map((s) => `Ø${f2(s.d)}×${f2(s.len)}`).join(', ')]);
		if (part.bores.length) rows.push(['Расточки:', part.bores.map((b) => `Ø${f2(b.d)}${b.through ? ' сквозн.' : ' гл. ' + f2(b.len)}`).join(', ')]);
		for (const h of part.holes) rows.push(['Отверстия:', `${h.count} отв. Ø${f2(h.d)}${h.through ? ' насквозь' : ', гл. ' + f2(h.len)}`]);
		if (part.sidePlanes) rows.push(['Лыски/пазы:', `${part.sidePlanes} плоск. — по модели`]);
	} else {
		for (const h of part.holes) {
			rows.push([`${h.count}×Ø${f2(h.d)}`, h.through ? 'насквозь' : `глубина ${f2(h.len)} мм`]);
			const hc = (part.holeCoords || []).find((x) => x.d === h.d);
			if (hc) rows.push(['  X;Y от «0»:', hc.pts.map(([x, y]) => `(${f2(x)}; ${f2(y)})`).join(' ')]);
		}
		if (part.bosses.length) rows.push(['Цилиндры:', part.bosses.map((b) => 'Ø' + f2(b.d)).join(', ')]);
		rows.push(['Плоскости:', `${part.planes} граней`]);
	}
	if (part.fillets && part.fillets.length) rows.push(['Скругления:', part.fillets.map((r) => 'R' + r).join(', ')]);
	return rows;
}

// ---------------------------------------------------------------------------
// Лист «Профиль для токарной обработки»: главный вид с номерами точек + таблица
// ---------------------------------------------------------------------------
function profileSheets(meshes, part, meta) {
	const pr = part.profile;
	const ax = part.axis;
	const box = part.box;
	const radius = box.getSize(new THREE.Vector3()).length();
	const main = makeView(box, ax.axis, ax.u);
	const area = { x: FRAME.l + 14, y: FRAME.t + 22, w: 248, h: 78 };
	const s = SCALES.find((k) => main.w * k <= area.w && main.h * k <= area.h) || 0.01;
	const { c, ctx } = newSheet();
	text(ctx, 'ПРОФИЛЬ ДЛЯ ТОКАРНОЙ ОБРАБОТКИ', (FRAME.l + W - FRAME.r) / 2, FRAME.t + 6, 4.5, 'center', true);
	text(ctx, `${meta.name}   ·   Масштаб ${scaleLabel(s)}   ·   Z — от левого торца, Z′ — от правого`, (FRAME.l + W - FRAME.r) / 2, FRAME.t + 12, 2.8, 'center');
	const x0 = area.x + (area.w - main.w * s) / 2, y0 = area.y + (area.h - main.h * s) / 2;
	const sc = buildScene(meshes, 0.3 / s);
	const P = drawView(ctx, sc, main, x0, y0, s, radius);
	sc.dispose();
	const at = (t, r) => ax.center.clone().addScaledVector(ax.axis, ax.tmin + t).addScaledVector(ax.u, r);
	// осевая
	pen(ctx, 0.18); ctx.setLineDash([3 * MM, 1.2 * MM, 1 * MM, 1.2 * MM]);
	const a0 = P(at(-4 / s, 0)), a1 = P(at(part.length + 4 / s, 0));
	ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke(); ctx.setLineDash([]);
	dim(ctx, P(at(0, part.D / 2)), P(at(part.length, part.D / 2)), -(6 * MM), f2(part.length));

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
	const L = part.length;
	const addRows = (prof, prefix) => prof.points.forEach((q, i) => {
		const sg = prof.segs.find((x) => x.from === i);
		const nx = prof.points[i + 1];
		const txt = sg ? segText(sg, prof.points)
			: !nx ? 'конец контура'
			: Math.abs(nx.t - q.t) < 0.02 ? `торец (уступ) до Ø${f2(nx.r * 2)}`
			: 'переход — по модели';
		rows.push([prefix + (i + 1), f2(q.t), f2(L - q.t), f2(q.r * 2), txt]);
	});
	addRows(pr.outer, '');
	if (pr.inner.points.length) { rows.push(['', '', '', '', 'Расточка (внутренний контур):']); addRows(pr.inner, 'В'); }

	const pages = [{ c, ctx }];
	const colW = [9, 16, 16, 17, 76];
	const tableTop = area.y + area.h + 8;
	const rowH = 4.3;
	const bottom = H - FRAME.b - 15;
	const perCol = Math.floor((bottom - tableTop - 6) / rowH);
	let pageIdx = 0, col = 0, row = 0;
	const header = (cx, ty, cctx) => {
		const heads = ['№', 'Z', 'Z′', 'Ø', 'Участок до следующей точки'];
		pen(cctx, 0.3);
		let x = cx;
		cctx.fillStyle = '#eef1f5'; cctx.fillRect(cx * MM, ty * MM, colW.reduce((p, q) => p + q, 0) * MM, 5.5 * MM); cctx.fillStyle = '#000';
		heads.forEach((h, i) => { text(cctx, h, x + (i < 4 ? colW[i] / 2 : 1.5), ty + 2.8, 2.6, i < 4 ? 'center' : 'left', true); x += colW[i]; });
		pen(cctx, 0.25); rect(cctx, cx, ty, colW.reduce((p, q) => p + q, 0), 5.5);
	};
	const colX = (k) => FRAME.l + 4 + k * 136;
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
	const note = 'Точки и размеры — по 3D-модели (вершины сетки лежат на поверхности). Допуски и шероховатость — по чертежу заказчика.';
	pages.forEach((pg) => text(pg.ctx, note, FRAME.l + 4, H - FRAME.b - 9, 2.4));
	return pages;
}

// ---------------------------------------------------------------------------
// Маршрутная карта
// ---------------------------------------------------------------------------
function routeSheets(route, meta) {
	const pages = [];
	const top = FRAME.t + 4;
	const x0 = FRAME.l + 2, x1 = W - FRAME.r - 2;
	const colNo = 14, colOp = 72;
	const bodyBottom = H - FRAME.b - 16;
	let page = null, y = 0;
	const lh = 4.6;
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
		text(ctx, 'Опер.', x0 + colNo / 2, y + 3.5, 3, 'center', true);
		text(ctx, 'Наименование операции, оборудование', x0 + colNo + 2, y + 3.5, 3, 'left', true);
		text(ctx, 'Содержание операции (переходы)', x0 + colNo + colOp + 2, y + 3.5, 3, 'left', true);
		y += 7;
		line(ctx, x0, y, x1, y);
	};
	start();
	for (const op of route) {
		const { ctx } = page;
		font(ctx, 3);
		const stepLines = [];
		op.steps.forEach((s, i) => {
			const ls = wrapLines(ctx, `${i + 1}. ${s}`, (x1 - x0 - colNo - colOp - 4) * MM);
			ls.forEach((l, j) => stepLines.push(j ? '    ' + l : l));
		});
		const leftLines = [...wrapLines(ctx, op.name, (colOp - 4) * MM)];
		font(ctx, 2.7);
		const eqLines = op.equip ? wrapLines(ctx, op.equip, (colOp - 4) * MM) : [];
		const need = Math.max(stepLines.length, leftLines.length + eqLines.length) * lh + 3;
		if (y + need > bodyBottom) start();
		const c2 = page.ctx;
		const y0 = y;
		text(c2, op.no, x0 + colNo / 2, y + 3, 3.4, 'center', true);
		leftLines.forEach((l, i) => text(c2, l, x0 + colNo + 2, y + 3 + i * lh, 3.2, 'left', true));
		eqLines.forEach((l, i) => text(c2, l, x0 + colNo + 2, y + 3 + (leftLines.length + i) * lh, 2.7));
		stepLines.forEach((l, i) => text(c2, l, x0 + colNo + colOp + 2, y + 3 + i * lh, 3));
		y += need;
		pen(c2, 0.18);
		line(c2, x0, y, x1, y);
		line(c2, x0 + colNo, y0, x0 + colNo, y); line(c2, x0 + colNo + colOp, y0, x0 + colNo + colOp, y);
	}
	return pages;
}

// ---------------------------------------------------------------------------
export function renderSheets({ meshes, part, route, meta }) {
	const sketch = sketchSheet(meshes, part, meta);
	const prof = part.type === 'rotational' && part.profile && part.profile.outer.points.length >= 2 ? profileSheets(meshes, part, meta) : [];
	const routes = routeSheets(route, meta);
	const total = 1 + prof.length + routes.length;
	const m = { ...meta, scale: sketch.scale };
	titleBlock(sketch.c.getContext('2d'), m, 1, total, 'Эскиз детали');
	const small = (ctx, label, no) => {
		const x = W - FRAME.r - 110, y = H - FRAME.b - 12;
		pen(ctx, 0.35); rect(ctx, x, y, 110, 12);
		text(ctx, `${meta.designation} — ${label}`, x + 3, y + 6, 3, 'left', true);
		text(ctx, `Лист ${no} / ${total}`, x + 107, y + 6, 3, 'right');
	};
	prof.forEach((p, i) => small(p.ctx, 'профиль', 2 + i));
	routes.forEach((p, i) => {
		small(p.ctx, 'маршрутная карта', 2 + prof.length + i);
		text(p.ctx, `${meta.author ? 'Разраб. ' + meta.author + '   ' : ''}${meta.date}`, FRAME.l + 2, H - FRAME.b - 6, 2.8);
	});
	return [sketch.c, ...prof.map((p) => p.c), ...routes.map((p) => p.c)];
}
