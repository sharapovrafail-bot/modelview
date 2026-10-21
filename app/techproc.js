// Анализ детали по 3D-модели и черновик технологического процесса:
// тип детали (тело вращения / корпусная), элементы для токарной и фрезерной
// обработки, план установов, заготовка по сортаменту, маршрут операций
// с инструментом и режимами резания.
// Результат — ЧЕРНОВИК для технолога: резьбы, допуски и шероховатость в STEP
// обычно не записаны и по геометрии не определяются.
import * as THREE from 'three';
import { faceTriangles, analyzeFace } from './measure-math.js';

// Круг стальной горячекатаный, ГОСТ 2590 (мм)
const BAR = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
	41, 42, 43, 44, 45, 46, 47, 48, 50, 52, 53, 54, 55, 56, 58, 60, 62, 63, 65, 67, 68, 70, 72, 75, 78, 80, 82, 85, 87, 90, 92, 95, 97, 100,
	105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200, 210, 220, 230, 240, 250, 260, 270, 280,
	290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400];
// Лист / плита горячекатаные, ГОСТ 19903 (толщины, мм)
const PLATE = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
	105, 110, 120, 125, 130, 140, 150, 160];
// Свёрла (мм) — ряд, который обычно есть в цехе
const DRILLS = [1, 1.5, 2, 2.5, 3, 3.3, 3.5, 4, 4.2, 4.5, 5, 5.5, 6, 6.5, 6.8, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.2, 10.5, 11, 12, 13, 14, 15, 16, 17, 18,
	19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 32];
// Концевые фрезы (мм)
const END_MILLS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const nextStd = (list, v) => list.find((x) => x >= v - 1e-9) || Math.ceil(v / 10) * 10;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');
const f2 = (v) => (Math.round(v * 100) / 100 + 0).toLocaleString('ru-RU');

// Станки цеха: ограничения, которые влияют на маршрут и режимы
export const MACHINES = {
	lathe: { rpm: 3500, liveRpm: 5000, liveDrillMax: 16, barMax: 76, tail: true },   // DOOSAN PUMA 3050LM: ось C, без Y, ER25
	mill: { rpm: 8000, x: 1000, y: 520, z: 535 },                                       // KVL 1000, Fanuc 0i-MF
};

export const DEFAULT_EQUIPMENT = {
	saw: 'Ленточнопильный станок',
	lathe: 'Токарный с ЧПУ DOOSAN PUMA 3050LM',
	mill: 'Фрезерный центр с ЧПУ KVL 1000 (Fanuc 0i-MF)',
	bench: 'Верстак слесарный',
	heat: 'Термический участок',
	grind: 'Круглошлифовальный / плоскошлифовальный станок',
	edm: 'Электроэрозионный станок',
	qc: 'Стол ОТК',
};

// ---------------------------------------------------------------------------
// Режимы резания (твёрдый сплав; свёрла — Р6М5К5). Средние значения для
// единичного производства — технолог правит под свой инструмент.
// ---------------------------------------------------------------------------
const CUT = {
	steel: { name: 'сталь', turnR: [180, 0.25], turnF: [220, 0.1], bore: [150, 0.12], drill: 22, face: [180, 0.12], endR: [100, 0.04], endF: [130, 0.03] },
	stainless: { name: 'нерж. сталь', turnR: [120, 0.2], turnF: [150, 0.08], bore: [100, 0.1], drill: 12, face: [120, 0.1], endR: [60, 0.03], endF: [80, 0.025] },
	alu: { name: 'алюминий', turnR: [400, 0.3], turnF: [500, 0.12], bore: [350, 0.15], drill: 60, face: [400, 0.15], endR: [250, 0.06], endF: [300, 0.04] },
	brass: { name: 'латунь / бронза', turnR: [250, 0.25], turnF: [300, 0.1], bore: [200, 0.12], drill: 40, face: [250, 0.12], endR: [180, 0.05], endF: [220, 0.04] },
	cast: { name: 'чугун', turnR: [150, 0.3], turnF: [180, 0.12], bore: [120, 0.12], drill: 20, face: [150, 0.15], endR: [90, 0.05], endF: [110, 0.04] },
	titan: { name: 'титан', turnR: [60, 0.15], turnF: [80, 0.08], bore: [50, 0.08], drill: 10, face: [50, 0.08], endR: [40, 0.03], endF: [50, 0.02] },
};
export function materialGroup(text) {
	const s = String(text || '').toLowerCase();
	if (/алюм|д16|амг|ад31|ад33|ак4|ак6|в95|1561|ал\d|\bal\b|6061|7075/.test(s)) return 'alu';
	if (/нерж|12х18|08х18|20х13|30х13|40х13|14х17|aisi\s*3|х18н/.test(s)) return 'stainless';
	if (/латун|бронз|\bл63|\bлс|\bбр|медь|\bм1\b/.test(s)) return 'brass';
	if (/чугун|\bсч|\bвч/.test(s)) return 'cast';
	if (/титан|\bвт\d|\bот4/.test(s)) return 'titan';
	return 'steel';
}
const rpm = (vc, d, max) => Math.min(max, Math.max(50, Math.round(1000 * vc / (Math.PI * Math.max(d, 1)) / 10) * 10));
const drillFeed = (d) => Math.min(0.3, Math.max(0.03, Math.round((0.012 * d + 0.03) * 100) / 100));
const fmtF = (v) => String(v).replace('.', ',');
// подбор режима: возвращает текст и числа для УП
export function cutMode(mat, kind, d, maxRpm) {
	const c = CUT[mat] || CUT.steel;
	if (kind === 'turnR' || kind === 'turnF' || kind === 'bore') {
		const [vc, f] = c[kind];
		return { vc, f, s: rpm(vc, d, maxRpm), text: `Vc ${vc} м/мин (G96, G50 S${maxRpm}), f ${fmtF(f)} мм/об` };
	}
	if (kind === 'drill' || kind === 'center') {
		const vc = kind === 'center' ? Math.round(c.drill * 0.8) : c.drill;
		const f = kind === 'center' ? 0.05 : drillFeed(d);
		const s = rpm(vc, d, maxRpm);
		return { vc, f, s, F: Math.round(s * f), text: `n ${s} об/мин, f ${fmtF(f)} мм/об (F${Math.round(s * f)})` };
	}
	const z = kind === 'face' ? (d >= 63 ? 5 : 4) : (mat === 'alu' ? 3 : 4);
	const [vc, fz] = c[kind];
	const s = rpm(vc, d, maxRpm);
	return { vc, fz, z, s, F: Math.round(s * z * fz / 10) * 10, text: `n ${s} об/мин, F${Math.round(s * z * fz / 10) * 10} мм/мин (fz ${fmtF(fz)})` };
}
const drillFor = (d) => [...DRILLS].reverse().find((x) => x <= d + 1e-6) || d;

// ---------------------------------------------------------------------------
// 1. Грани модели -> цилиндры и плоскости
// ---------------------------------------------------------------------------
function collectFaces(meshes, onProgress) {
	const faces = [];
	let done = 0;
	const total = meshes.reduce((n, m) => n + ((m.geometry.userData.faces || []).length || 1), 0);
	for (const m of meshes) {
		const g = m.geometry;
		const ud = g.userData;
		if (ud.faces && ud.faceOf) {
			ud.faces.forEach((f) => {
				const tris = new Uint32Array(f.last - f.first + 1);
				for (let i = 0; i < tris.length; i++) tris[i] = f.first + i;
				const a = analyzeFace(m, tris);
				a.points = null;
				a.mesh = m; a.tris = tris;
				faces.push(a);
				done++;
			});
		} else {
			// сетка без граней CAD (STL): режем на области по плавности нормалей
			const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
			if (n > 300000) { done++; continue; }
			const seen = new Uint8Array(n);
			for (let t = 0; t < n; t++) {
				if (seen[t]) continue;
				const { tris } = faceTriangles(g, t);
				for (const x of tris) seen[x] = 1;
				const a = analyzeFace(m, tris);
				a.points = null;
				a.mesh = m; a.tris = tris;
				faces.push(a);
			}
			done++;
		}
		onProgress && onProgress(done / total);
	}
	return faces;
}

// половинки и куски одного цилиндра — в одну группу
function groupCylinders(faces) {
	const groups = [];
	for (const f of faces) {
		if (f.type !== 'cylinder') continue;
		const tol = Math.max(f.radius * 2e-3, 1e-3);
		let g = groups.find((x) => Math.abs(x.radius - f.radius) < tol && Math.abs(x.axis.dot(f.axis)) > 0.9995 &&
			lineDist(x.center, x.axis, f.center) < tol);
		const t0 = f.axisStart.clone().sub(f.center).dot(f.axis), t1 = f.axisEnd.clone().sub(f.center).dot(f.axis);
		if (!g) {
			g = { radius: f.radius, axis: f.axis.clone(), center: f.center.clone(), area: 0, sweep: 0, hole: f.hole, holeVotes: 0, tmin: Infinity, tmax: -Infinity, faces: 0 };
			groups.push(g);
		}
		const off = f.center.clone().sub(g.center).dot(g.axis) * 1;
		const sgn = Math.sign(f.axis.dot(g.axis)) || 1;
		g.tmin = Math.min(g.tmin, off + Math.min(t0 * sgn, t1 * sgn));
		g.tmax = Math.max(g.tmax, off + Math.max(t0 * sgn, t1 * sgn));
		g.area += f.area;
		g.sweep = Math.min(Math.PI * 2, g.sweep + f.sweep);
		g.holeVotes += f.hole ? f.area : -f.area;
		g.hole = g.holeVotes > 0;
		g.faces++;
	}
	return groups;
}
function lineDist(c, a, p) {
	const d = p.clone().sub(c);
	d.addScaledVector(a, -d.dot(a));
	return d.length();
}
// расстояние между двумя прямыми (ось детали и ось отверстия)
function linesDist(c1, a1, c2, a2) {
	const n = new THREE.Vector3().crossVectors(a1, a2);
	const l = n.length();
	if (l < 1e-6) return lineDist(c1, a1, c2);
	return Math.abs(c2.clone().sub(c1).dot(n)) / l;
}

// ---------------------------------------------------------------------------
// Профиль тела вращения (образующая) для токарной обработки.
// Вершины сетки лежат точно на поверхности, поэтому для поверхности вращения
// вокруг оси детали точки (Z, R) каждой грани ложатся ровно на её образующую:
// прямую (цилиндр, конус, торец) или дугу (сфера, тор). Грани, у которых точки
// не ложатся ни на прямую, ни на дугу (лыски, боковые отверстия), в профиль не входят.
// ---------------------------------------------------------------------------
function revolutionProfile(faces, rot) {
	const a = rot.axis, c = rot.center, L = rot.tmax - rot.tmin;
	const tolFit = Math.max(0.004, L * 2e-5);
	const els = [];
	const v = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
	for (const f of faces) {
		if (!f.mesh || !f.tris) continue;
		const g = f.mesh.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null, M = f.mesh.matrixWorld;
		const seen = new Map();
		const pts = [];
		let orient = 0, area = 0, nt = 0, nr = 0;
		const tr = (vi) => {
			let q = seen.get(vi);
			if (!q) {
				v.set(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]).applyMatrix4(M).sub(c);
				const t = v.dot(a);
				const r = Math.sqrt(Math.max(0, v.lengthSq() - t * t));
				q = { t: t - rot.tmin, r, p: v.clone() };
				seen.set(vi, q); pts.push(q);
			}
			return q;
		};
		for (const t of f.tris) {
			const q0 = tr(I ? I[t * 3] : t * 3), q1 = tr(I ? I[t * 3 + 1] : t * 3 + 1), q2 = tr(I ? I[t * 3 + 2] : t * 3 + 2);
			A.subVectors(q1.p, q0.p); B.subVectors(q2.p, q0.p); n.crossVectors(A, B);
			const s2 = n.length(); if (!s2) continue;
			n.divideScalar(s2);
			C.copy(q0.p).add(q1.p).add(q2.p).divideScalar(3);
			const ct = C.dot(a);
			C.addScaledVector(a, -ct);
			const rl = C.length();
			const radial = rl > 1e-9 ? C.divideScalar(rl) : null;
			const w = s2 / 2;
			area += w;
			nt += n.dot(a) * w;
			if (radial) { const d = n.dot(radial); orient += d * w; nr += d * w; }
		}
		if (pts.length < 2 || area <= 0) continue;
		// поверхность вращения вокруг оси детали охватывает заметный угол; канавки рифления,
		// лунки и пазы — узкие по углу, в профиль их не берём
		if (!isRevolved(pts, rot)) continue;
		const fit = fitLine(pts) ;
		let el = null;
		if (fit.dev < tolFit) {
			el = { kind: 'line', p0: fit.p0, p1: fit.p1 };
		} else if (pts.length >= 4) {
			const cf = fitCircle2(pts);
			if (cf && cf.dev < tolFit * 2 && cf.R < L * 50) {
				const angs = pts.map((q) => Math.atan2(q.r - cf.rc, q.t - cf.tc)).sort((x, y) => x - y);
				let gap = angs[0] + Math.PI * 2 - angs[angs.length - 1], a0 = angs[0], a1 = angs[angs.length - 1];
				for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > gap) { gap = angs[i] - angs[i - 1]; a0 = angs[i]; a1 = angs[i - 1]; }
				const end = (ang) => ({ t: cf.tc + cf.R * Math.cos(ang), r: Math.max(0, cf.rc + cf.R * Math.sin(ang)) });
				// выпуклость: нормаль смотрит от центра дуги
				const mid = end(a0 + (Math.PI * 2 - gap) / 2);
				const convex = (mid.t - cf.tc) * nt + (mid.r - cf.rc) * nr > 0;
				el = { kind: 'arc', p0: end(a0), p1: end(a1), R: cf.R, tc: cf.tc, rc: cf.rc, convex };
			}
		}
		if (!el) continue;
		el.orient = orient / area;     // >0 — наружная, <0 — внутренняя (расточка)
		el.area = area;
		// направление обхода — по возрастанию Z
		if (el.p1.t < el.p0.t - 1e-9 || (Math.abs(el.p1.t - el.p0.t) < 1e-9 && el.p1.r < el.p0.r)) [el.p0, el.p1] = [el.p1, el.p0];
		els.push(el);
	}

	const vertical = (e) => e.kind === 'line' && Math.abs(e.p1.t - e.p0.t) < tolFit * 3;
	const outer = els.filter((e) => !vertical(e) && e.orient > 0.02);
	const inner = els.filter((e) => !vertical(e) && e.orient < -0.02);
	return { outer: chain(outer, tolFit), inner: chain(inner, tolFit), L };
}

function isRevolved(pts, rot) {
	const angs = [];
	for (const q of pts) if (q.r > 1e-3) angs.push(Math.atan2(q.p.dot(rot.w), q.p.dot(rot.u)));
	if (angs.length < 3) return true;              // точки на оси (вершина конуса, центр торца)
	angs.sort((a, b) => a - b);
	let gap = angs[0] + Math.PI * 2 - angs[angs.length - 1];
	for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1]);
	return Math.PI * 2 - gap > Math.PI / 3;
}

// склеивает соседние куски одной образующей и строит точки контура
function chain(list, tol) {
	list.sort((x, y) => x.p0.t - y.p0.t || x.p1.t - y.p1.t);
	const merged = [];
	for (const e of list) {
		const last = merged[merged.length - 1];
		if (last && same(last, e, tol) && Math.abs(last.p1.t - e.p0.t) < tol * 5 && Math.abs(last.p1.r - e.p0.r) < tol * 5) {
			last.p1 = e.p1;
			continue;
		}
		// перекрывающиеся куски (например, две половинки цилиндра) — тоже в один
		const dup = merged.find((m) => same(m, e, tol) && e.p0.t < m.p1.t + tol && e.p1.t > m.p0.t - tol);
		if (dup) { if (e.p0.t < dup.p0.t) dup.p0 = e.p0; if (e.p1.t > dup.p1.t) dup.p1 = e.p1; continue; }
		merged.push({ ...e });
	}
	merged.sort((x, y) => x.p0.t - y.p0.t);
	const pts = [];
	const push = (p) => {
		const q = pts[pts.length - 1];
		if (q && Math.abs(q.t - p.t) < tol * 5 && Math.abs(q.r - p.r) < tol * 5) return pts.length - 1;
		pts.push({ t: p.t, r: p.r });
		return pts.length - 1;
	};
	const segs = [];
	for (const e of merged) {
		const i0 = push(e.p0), i1 = push(e.p1);
		if (i1 > i0) segs.push({ from: i0, to: i1, el: e });
	}
	return { points: pts, segs, elements: merged };
}
function same(a, b, tol) {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'arc') return Math.abs(a.R - b.R) < tol * 3 && Math.abs(a.tc - b.tc) < tol * 3 && Math.abs(a.rc - b.rc) < tol * 3;
	// прямые: одна и та же прямая в плоскости (Z, R)
	const dx = a.p1.t - a.p0.t, dy = a.p1.r - a.p0.r, l = Math.hypot(dx, dy) || 1;
	const d = (p) => Math.abs((p.t - a.p0.t) * dy - (p.r - a.p0.r) * dx) / l;
	return d(b.p0) < tol * 3 && d(b.p1) < tol * 3;
}
function fitLine(pts) {
	let mt = 0, mr = 0;
	for (const q of pts) { mt += q.t; mr += q.r; }
	mt /= pts.length; mr /= pts.length;
	let stt = 0, srr = 0, str = 0;
	for (const q of pts) { const dt = q.t - mt, dr = q.r - mr; stt += dt * dt; srr += dr * dr; str += dt * dr; }
	const ang = 0.5 * Math.atan2(2 * str, stt - srr);
	const ux = Math.cos(ang), uy = Math.sin(ang);
	let dev = 0, lo = Infinity, hi = -Infinity;
	for (const q of pts) {
		const dt = q.t - mt, dr = q.r - mr;
		dev = Math.max(dev, Math.abs(-dt * uy + dr * ux));
		const s = dt * ux + dr * uy;
		lo = Math.min(lo, s); hi = Math.max(hi, s);
	}
	return { dev, p0: { t: mt + ux * lo, r: mr + uy * lo }, p1: { t: mt + ux * hi, r: mr + uy * hi } };
}
function fitCircle2(pts) {
	let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
	const n = pts.length;
	for (const q of pts) { const x = q.t, y = q.r, z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
	const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], rhs = [-sxz, -syz, -sz];
	const det = (q) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
	const d = det(m);
	if (Math.abs(d) < 1e-300) return null;
	const sol = [0, 1, 2].map((col) => det(m.map((row, i) => row.map((val, j) => (j === col ? rhs[i] : val)))) / d);
	const tc = -sol[0] / 2, rc = -sol[1] / 2, rr = tc * tc + rc * rc - sol[2];
	if (!(rr > 0)) return null;
	const R = Math.sqrt(rr);
	let dev = 0;
	for (const q of pts) dev = Math.max(dev, Math.abs(Math.hypot(q.t - tc, q.r - rc) - R));
	return { tc, rc, R, dev };
}

// вид участка профиля между точками a и b
export function segKind(seg, pts) {
	const a = pts[seg.from], b = pts[seg.to], e = seg.el;
	if (e.kind === 'arc') return 'arc';
	if (Math.abs(b.r - a.r) < 0.005) return 'cyl';
	if (Math.abs(b.t - a.t) < 0.005) return 'face';
	if (Math.abs(b.t - a.t) < 3 && Math.abs(b.r - a.r) < 3) return 'chamfer';
	return 'cone';
}
// описание участка профиля между точками
export function segText(seg, pts) {
	const a = pts[seg.from], b = pts[seg.to], e = seg.el;
	const k = segKind(seg, pts);
	if (k === 'arc') return `дуга R${f2(e.R)} ${e.convex ? 'выпуклая' : 'вогнутая'}, центр Z${f2(e.tc)} Ø${f2(Math.max(0, e.rc) * 2)}`;
	if (k === 'cyl') return 'цилиндр';
	if (k === 'face') return 'торец';
	const ang = Math.atan2(Math.abs(b.r - a.r), Math.abs(b.t - a.t)) * 180 / Math.PI;
	if (k === 'chamfer') return `фаска ${chamferText(a, b)}`;
	return `конус, угол ${f1(ang)}° к оси (${f1(ang * 2)}° при вершине)`;
}
function chamferText(a, b) {
	const dz = Math.abs(b.t - a.t), dr = Math.abs(b.r - a.r);
	const ang = Math.atan2(dr, dz) * 180 / Math.PI;
	if (Math.abs(ang - 45) < 1) return `${f2(dz)}×45°`;
	return `${f2(dz)}×${f1(ang)}°`;
}

// ---------------------------------------------------------------------------
// 2. Анализ детали
// ---------------------------------------------------------------------------
export function analyzePart(meshes, onProgress) {
	const faces = collectFaces(meshes, onProgress);
	const cyl = groupCylinders(faces);
	const planes = faces.filter((f) => f.type === 'plane');
	const totalArea = faces.reduce((s, f) => s + f.area, 0) || 1;

	// все вершины — для габаритов вдоль любой оси
	const pts = [];
	for (const m of meshes) {
		const P = m.geometry.attributes.position.array;
		const step = Math.max(1, Math.floor(P.length / 3 / 60000)) * 3;
		const v = new THREE.Vector3();
		for (let i = 0; i < P.length; i += step) pts.push(v.set(P[i], P[i + 1], P[i + 2]).clone().applyMatrix4(m.matrixWorld));
	}
	const box = new THREE.Box3().setFromPoints(pts);
	const size = box.getSize(new THREE.Vector3());

	// главная ось: цилиндры на одной прямой с наибольшей площадью
	const axes = [];
	for (const g of cyl) {
		let a = axes.find((x) => Math.abs(x.axis.dot(g.axis)) > 0.9995 && lineDist(x.center, x.axis, g.center) < Math.max(1e-3, g.radius * 2e-3) + x.tol);
		if (!a) { a = { axis: g.axis.clone(), center: g.center.clone(), area: 0, tol: 0.01, rOuter: 0 }; axes.push(a); }
		a.area += g.area;
		if (!g.hole && g.sweep > Math.PI * 1.6) a.rOuter = Math.max(a.rOuter, g.radius);
	}
	axes.sort((x, y) => y.area - x.area);
	let rot = null;
	for (const a of axes.slice(0, 3)) {
		if (!a.rOuter) continue;
		const u = new THREE.Vector3().crossVectors(a.axis, Math.abs(a.axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
		const w = new THREE.Vector3().crossVectors(a.axis, u);
		let umin = Infinity, umax = -Infinity, wmin = Infinity, wmax = -Infinity, tmin = Infinity, tmax = -Infinity;
		for (const p of pts) {
			const d = p.clone().sub(a.center);
			const pu = d.dot(u), pw = d.dot(w), pt = d.dot(a.axis);
			umin = Math.min(umin, pu); umax = Math.max(umax, pu); wmin = Math.min(wmin, pw); wmax = Math.max(wmax, pw);
			tmin = Math.min(tmin, pt); tmax = Math.max(tmax, pt);
		}
		const D = 2 * a.rOuter;
		if (umax - umin <= D * 1.03 + 0.05 && wmax - wmin <= D * 1.03 + 0.05 && a.area / totalArea > 0.15) {
			rot = { axis: a.axis, center: a.center, u, w, tmin, tmax, D };
			break;
		}
	}

	// глухое отверстие: у одного конца есть «дно» — грань с центром на оси отверстия
	// (плоское дно или конус сверла). Возвращает, у какого конца дно: 'min' | 'max' | null.
	const bottomEnd = (g) => {
		for (const f of faces) {
			if (f.type === 'cylinder' || !f.centroid) continue;
			if (lineDist(g.center, g.axis, f.centroid) > g.radius * 0.6) continue;
			const t = f.centroid.clone().sub(g.center).dot(g.axis);
			const nearMin = Math.abs(t - g.tmin) < g.radius * 1.2, nearMax = Math.abs(t - g.tmax) < g.radius * 1.2;
			if (!nearMin && !nearMax) continue;
			// плоскость дна должна быть поперёк оси, а площадь — не больше сечения отверстия ×1,5
			if (f.type === 'plane' && Math.abs(f.normal.dot(g.axis)) < 0.99) continue;
			if (f.area > Math.PI * g.radius * g.radius * 1.5) continue;
			return nearMin && (!nearMax || Math.abs(t - g.tmin) < Math.abs(t - g.tmax)) ? 'min' : 'max';
		}
		return null;
	};
	// направления, с которых отверстие открыто (единичные векторы)
	const openDirs = (g) => {
		const b = bottomEnd(g);
		if (!b) return [g.axis.clone(), g.axis.clone().negate()];
		return [b === 'min' ? g.axis.clone() : g.axis.clone().negate()];
	};
	const holeGroups = (list, classify) => {
		const out = [];
		for (const g of list) {
			const d = g.radius * 2;
			const len = g.tmax - g.tmin;
			const dirs = openDirs(g);
			const blind = dirs.length === 1;
			const extra = classify ? classify(g, dirs) : {};
			let e = out.find((x) => Math.abs(x.d - d) < 0.01 && Math.abs(x.len - len) < 0.05 && x.blind === blind && x.key === extra.key);
			if (!e) { e = { d, len, count: 0, items: [], blind, through: !blind, ...extra }; out.push(e); }
			e.count++;
			e.items.push({ ...g, dirs, ...extra.item });
		}
		return out.sort((a, b) => b.d - a.d);
	};
	const fillets = [...new Set(cyl.filter((g) => g.sweep < Math.PI * 0.75 && g.radius < Math.max(size.x, size.y, size.z) * 0.1).map((g) => f1(g.radius)))];

	if (rot) {
		const onAxis = (g) => Math.abs(g.axis.dot(rot.axis)) > 0.9995 && lineDist(rot.center, rot.axis, g.center) < Math.max(0.01, g.radius * 2e-3);
		const tOf = (g) => {
			const c = g.center.clone().sub(rot.center).dot(rot.axis);
			const s = Math.sign(g.axis.dot(rot.axis)) || 1;
			return [c + Math.min(g.tmin * s, g.tmax * s) - rot.tmin, c + Math.max(g.tmin * s, g.tmax * s) - rot.tmin];
		};
		const outer = [], bores = [];
		for (const g of cyl) {
			if (!onAxis(g) || g.sweep < Math.PI * 1.2) continue;
			const [a, b] = tOf(g);
			(g.hole ? bores : outer).push({ d: g.radius * 2, t0: a, t1: b, len: b - a });
		}
		const merge = (list) => {
			list.sort((a, b) => a.t0 - b.t0);
			const out = [];
			for (const s of list) {
				const last = out.find((x) => Math.abs(x.d - s.d) < 0.01 && s.t0 <= x.t1 + 0.05 && s.t1 >= x.t0 - 0.05);
				if (last) { last.t0 = Math.min(last.t0, s.t0); last.t1 = Math.max(last.t1, s.t1); last.len = last.t1 - last.t0; }
				else out.push({ ...s });
			}
			return out;
		};
		const L = rot.tmax - rot.tmin;
		const tPos = (p) => p.clone().sub(rot.center).dot(rot.axis) - rot.tmin;
		// отверстия не на оси: осевые (параллельно оси — сверлятся с торца по оси C),
		// радиальные (ось отверстия пересекает ось детали) и прочие (нужна ось Y / фрезерный)
		const classify = (g, dirs) => {
			const par = Math.abs(g.axis.dot(rot.axis));
			const d = g.center.clone().sub(rot.center);
			const t = d.dot(rot.axis);
			d.addScaledVector(rot.axis, -t);
			const angle = Math.atan2(d.dot(rot.w), d.dot(rot.u)) * 180 / Math.PI;
			if (par > 0.999) {
				const s = dirs.map((v) => (v.dot(rot.axis) > 0 ? 'right' : 'left'));
				const opens = s.length === 2 ? 'both' : s[0];
				const r = d.length();
				return { kind: 'axial', key: 'axial' + opens + f1(r), opens, item: { r, angle, t: tPos(g.center) } };
			}
			if (par < 0.02 && linesDist(rot.center, rot.axis, g.center, g.axis) < Math.max(0.05, g.radius * 0.05)) {
				return { kind: 'radial', key: 'radial', opens: 'side', item: { angle, t: tPos(g.center) } };
			}
			return { kind: 'other', key: 'other', opens: 'side', item: { angle, t: tPos(g.center) } };
		};
		const offHoles = holeGroups(cyl.filter((g) => g.hole && !onAxis(g) && g.sweep > Math.PI * 1.6), classify).map((h) => {
			if (h.kind === 'axial') {
				const r = h.items[0].r;
				const angs = h.items.map((x) => x.angle).sort((a, b) => a - b);
				const even = h.count > 1 && angs.every((a, i) => i === 0 || Math.abs(a - angs[i - 1] - 360 / h.count) < 0.5);
				return { ...h, pcd: 2 * r, even };
			}
			return h;
		});
		// лыски, пазы и прочие плоскости вдоль оси: группируем по нормали и расстоянию от оси
		const flats = [];
		for (const p of planes) {
			const c = Math.abs(p.normal.dot(rot.axis));
			if (c > 0.999) continue;                         // торцы и уступы — это токарный профиль
			if (p.area < Math.max(1, totalArea * 5e-4)) continue;
			const dist = p.centroid.clone().sub(rot.center).dot(p.normal);
			let f = flats.find((x) => x.normal.dot(p.normal) > 0.9995 && Math.abs(x.dist - dist) < 0.02);
			if (!f) { f = { normal: p.normal.clone(), dist, area: 0, oblique: c > 0.01, faces: 0 }; flats.push(f); }
			f.area += p.area; f.faces++;
		}
		// пары противоположных лысок — размер «под ключ»
		const used = new Set();
		const flatSets = [];
		for (const f of flats) {
			if (used.has(f) || f.oblique) continue;
			const opp = flats.find((x) => !used.has(x) && x !== f && x.normal.dot(f.normal) < -0.9995 && Math.abs(x.dist - f.dist) < 0.05);
			if (opp) { used.add(f); used.add(opp); flatSets.push({ kind: 'pair', S: f.dist + opp.dist, dist: f.dist, normal: f.normal }); }
		}
		// пары с одинаковым S: 2 — квадрат/лыски, 3 — шестигранник, 4 — восьмигранник; больше — шлицы/рифление;
		// узкая пара у оси (S < 0,6 Ø) — паз (шлиц) шириной S
		const bySize = [];
		for (const p of flatSets) {
			let g = bySize.find((x) => Math.abs(x.S - p.S) < 0.05);
			if (!g) { g = { S: p.S, pairs: [] }; bySize.push(g); }
			g.pairs.push(p);
		}
		const pairs = flatSets.length;
		flatSets.length = 0;
		for (const g of bySize) {
			const n = g.pairs.length;
			const kind = n > 4 ? 'spline' : g.S < 0.6 * rot.D ? 'slot' : n === 1 ? 'pair' : 'polygon';
			flatSets.push({ kind, S: g.S, n, dist: g.S / 2, normal: g.pairs[0].normal });
		}
		for (const f of flats) if (!used.has(f)) flatSets.push({ kind: f.oblique ? 'oblique' : 'single', dist: f.dist, normal: f.normal });
		const profile = revolutionProfile(faces, rot);
		const part = {
			type: 'rotational', axis: rot, length: L, D: rot.D, profile,
			outer: merge(outer),
			bores: merge(bores).map((b) => ({ ...b, through: b.len > L - 0.5, opens: b.len > L - 0.5 ? 'both' : b.t0 < 0.5 ? 'left' : b.t1 > L - 0.5 ? 'right' : 'inside' })),
			holes: offHoles, flats: flatSets, flatPairs: pairs, sidePlanes: flatSets.length,
			fillets, size, box, totalArea,
		};
		part.plan = turnPlan(part);
		return part;
	}

	// ----- корпусная деталь -----
	const holes = holeGroups(cyl.filter((g) => g.hole && g.sweep > Math.PI * 1.6));
	const bosses = holeGroups(cyl.filter((g) => !g.hole && g.sweep > Math.PI * 1.6));
	// внутренние скругления (вогнутые частичные цилиндры) — ограничивают диаметр фрезы
	const innerR = cyl.filter((g) => g.hole && g.sweep < Math.PI * 1.2).map((g) => ({ r: g.radius, axis: g.axis }));
	const part = { type: 'prismatic', size, box, planes: planes.length, holes, bosses, fillets, innerR, totalArea };
	part.setups = millSetups(part, planes, box);
	return part;
}

// ---------------------------------------------------------------------------
// План токарной обработки: какой стороной зажимать.
// Установ А обрабатывает сторону с поверхностью под зажим (обычно наибольший
// Ø достаточной длины), установ Б зажимает деталь за неё в мягких кулачках
// и обрабатывает остальное. Z в каждом установе — от свободного торца (Z0), в минус.
// ---------------------------------------------------------------------------
function turnPlan(part) {
	const L = part.length, D = part.D;
	const cands = part.outer.filter((s) => s.len >= 4);
	// качество зажима: длина губок (не больше 30 мм) и диаметр
	const score = (s) => Math.min(s.len, 0.6 * s.d, 30) * Math.sqrt(s.d);
	const clamp = cands.sort((a, b) => score(b) - score(a))[0] || null;
	let aEnd, split;
	if (clamp) {
		aEnd = (clamp.t0 + clamp.t1) / 2 > L / 2 ? 'right' : 'left';
		split = aEnd === 'right' ? clamp.t0 : clamp.t1;
		// поверхность под зажим целиком в установе А, но не весь вал: иначе в уст. Б нечего держать
		if (aEnd === 'right' && split < 0.5) split = 0;
		if (aEnd === 'left' && split > L - 0.5) split = L;
	} else { aEnd = 'right'; split = L / 2; }
	const lenA = aEnd === 'right' ? L - split : split;
	const lenB = L - lenA;
	const face = D <= 30 ? 1 : D <= 80 ? 1.5 : 2;
	// в установе А заготовку держат за необработанную часть стороны Б; если её мало — технологический припуск
	const minGrip = Math.max(10, Math.min(25, 0.25 * D));
	const gripAllow = Math.max(0, Math.ceil(minGrip - lenB - face));
	const inA = (t) => (aEnd === 'right' ? t >= split - 1e-6 : t <= split + 1e-6);
	const inB = (t) => (aEnd === 'right' ? t <= split + 1e-6 : t >= split - 1e-6);
	const zA = (t) => (aEnd === 'right' ? t - L : -t);
	const zB = (t) => (aEnd === 'right' ? -t : t - L);
	const pr = part.profile;
	const pick = (prof, test) => (prof ? prof.points.map((q, i) => ({ ...q, i })).filter((q) => test(q.t)) : []);
	// внутренний контур: со стороны А растачиваем до самого узкого места, остальное — со стороны Б
	let innerSplit = null;
	if (pr && pr.inner.points.length) {
		const ip = pr.inner.points;
		let k = 0;
		ip.forEach((q, i) => { if (q.r < ip[k].r - 1e-6) k = i; });
		innerSplit = ip[k].t;
	}
	const inInnerA = (t) => (innerSplit == null ? false : aEnd === 'right' ? t >= innerSplit - 1e-6 : t <= innerSplit + 1e-6);
	const inInnerB = (t) => (innerSplit == null ? false : aEnd === 'right' ? t <= innerSplit + 1e-6 : t >= innerSplit - 1e-6);
	const stickA = Math.ceil(lenA + face + 5);
	const stickB = Math.ceil(lenB + face + 5);
	const sideEnd = (side) => (side === 'A' ? aEnd : aEnd === 'right' ? 'left' : 'right');
	// уступ на границе установов обрабатывается с той стороны, к которой он обращён:
	// при проходе от свободного торца к патрону Ø на уступе должен расти, иначе он — в другом установе
	const trim = (list, freeRight) => {
		const seq = [...list].sort((p, q) => (freeRight ? q.i - p.i : p.i - q.i));
		while (seq.length >= 2) {
			const a = seq[seq.length - 2], b = seq[seq.length - 1];
			if (Math.abs(a.t - split) < 0.02 && Math.abs(b.t - split) < 0.02 && b.r < a.r - 1e-6) seq.pop(); else break;
		}
		return seq.sort((p, q) => p.i - q.i);
	};
	const hasBoreAt = (end) => part.bores.some((b) => b.opens === end || b.opens === 'both');
	return {
		aEnd, split, clamp, lenA, lenB, face, gripAllow, minGrip, innerSplit,
		stickA, stickB,
		// задний центр — если вылет больше трёх диаметров и на торце нет отверстия
		tailA: lenA > 3 * D && !hasBoreAt(sideEnd('A')),
		tailB: lenB > 3 * sideMaxD(part, aEnd === 'right' ? 0 : split, aEnd === 'right' ? split : L) && !hasBoreAt(sideEnd('B')),
		zA, zB, sideEnd,
		outerA: trim(pick(pr && pr.outer, inA), aEnd === 'right'), outerB: trim(pick(pr && pr.outer, inB), aEnd !== 'right'),
		innerA: pick(pr && pr.inner, inInnerA), innerB: pick(pr && pr.inner, inInnerB),
	};
}

// наибольший Ø на участке [t0, t1] — по нему оцениваем жёсткость вылета
function sideMaxD(part, t0, t1) {
	const pr = part.profile;
	const ds = pr && pr.outer.points.length ? pr.outer.points.filter((q) => q.t >= t0 - 1e-6 && q.t <= t1 + 1e-6).map((q) => q.r * 2)
		: part.outer.filter((s) => s.t1 >= t0 && s.t0 <= t1).map((s) => s.d);
	return ds.length ? Math.max(...ds) : part.D;
}
// точки контура от свободного торца к патрону: Ø где-то уменьшается — поднутрение
export function hasUndercut(seq) {
	let max = -Infinity;
	for (const q of seq) {
		if (q.r < max - 0.01) return true;
		max = Math.max(max, q.r);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Установы на фрезерном станке (3 оси): элементы группируются по направлению
// подхода инструмента (±X, ±Y, ±Z модели). Установ А — сторона с наибольшим
// числом элементов, установ Б — противоположная (там же фрезеруется толщина),
// остальные стороны с элементами — дополнительные установы.
// ---------------------------------------------------------------------------
const DIRS = [
	{ v: new THREE.Vector3(0, 0, 1), name: '+Z' }, { v: new THREE.Vector3(0, 0, -1), name: '−Z' },
	{ v: new THREE.Vector3(1, 0, 0), name: '+X' }, { v: new THREE.Vector3(-1, 0, 0), name: '−X' },
	{ v: new THREE.Vector3(0, 1, 0), name: '+Y' }, { v: new THREE.Vector3(0, -1, 0), name: '−Y' },
];
function millSetups(part, planes, box) {
	const top = (v) => Math.max(box.max.dot(v), box.min.dot(v));     // крайний уровень по направлению v
	const sides = DIRS.map((d) => ({ ...d, floors: [], holes: [], topArea: 0, score: 0 }));
	const dirOf = (n) => sides.find((s) => s.v.dot(n) > 0.9998);
	let oblique = 0;
	for (const p of planes) {
		if (p.area < Math.max(0.5, part.totalArea * 2e-4)) continue;
		const s = dirOf(p.normal);
		if (!s) { oblique++; continue; }
		const depth = top(s.v) - p.centroid.dot(s.v);
		if (depth < 0.05) { s.topArea += p.area; continue; }
		let f = s.floors.find((x) => Math.abs(x.depth - depth) < 0.02);
		if (!f) { f = { depth, area: 0, count: 0 }; s.floors.push(f); }
		f.area += p.area; f.count++;
	}
	const obliqueHoles = [];
	for (const h of part.holes) for (const it of h.items) {
		// сквозное — с любой из двух сторон; потом отдадим той, где больше работы
		const cand = it.dirs.map(dirOf).filter(Boolean);
		if (!cand.length) { obliqueHoles.push({ h, it }); continue; }
		it.cand = cand;
	}
	// мелкие площадки (переходы скруглений) — не уровни обработки
	for (const s of sides) s.floors = s.floors.filter((f) => f.area >= Math.max(2, part.totalArea * 3e-3));
	for (const s of sides) s.score = s.floors.length * 2 + s.floors.reduce((n, f) => n + f.area, 0) / (part.totalArea || 1);
	for (const h of part.holes) for (const it of h.items) if (it.cand) for (const s of it.cand) s.score += 1;
	// ось установов А/Б: где больше уровней и отверстий с обеих сторон; А — сторона с бо́льшим счётом, при равенстве — +Z
	const opp = (s) => sides.find((x) => x.v.dot(s.v) < -0.99);
	const pairScore = (s) => s.score + opp(s).score;
	const order = [...sides].sort((a, b) => pairScore(b) - pairScore(a) || b.score - a.score || (a.name === '+Z' ? -1 : b.name === '+Z' ? 1 : 0));
	const A = order[0];
	const B = opp(A);
	// уровни на боковых сторонах при 3-осевой обработке сверху — это стенки карманов и контура: они в установах А/Б
	for (const s of sides) if (s !== A && s !== B) s.floors = [];
	// отверстия: в установ А, если доступны оттуда; иначе Б; иначе боковой установ с наибольшим счётом
	for (const h of part.holes) for (const it of h.items) {
		if (!it.cand) continue;
		const s = it.cand.includes(A) ? A : it.cand.includes(B) ? B : it.cand.sort((a, b) => b.score - a.score)[0];
		s.holes.push({ h, it });
	}
	// оси вида для установа: смотрим против направления подхода, X — вдоль длинной стороны
	const frame = (s) => {
		const perp = DIRS.filter((d) => Math.abs(d.v.dot(s.v)) < 0.5 && d.v.x + d.v.y + d.v.z > 0);
		const ext = (v) => Math.abs(box.max.dot(v) - box.min.dot(v));
		const right = perp.sort((a, b) => ext(b.v) - ext(a.v))[0].v.clone();
		const up = new THREE.Vector3().crossVectors(s.v, right);
		return { right, up, normal: s.v.clone() };
	};
	const used = [A, B, ...order.filter((s) => s !== A && s !== B && s.holes.length)];
	const letters = 'АБВГДЕ';
	const res = used.map((s, i) => {
		const fr = frame(s);
		const ext = (v) => Math.abs(box.max.dot(v) - box.min.dot(v));
		// координаты отверстий: X/Y от левого нижнего угла вида, Z0 — верх установа
		const x0 = Math.min(box.min.dot(fr.right), box.max.dot(fr.right)), y0 = Math.min(box.min.dot(fr.up), box.max.dot(fr.up));
		const groups = [];
		for (const { h, it } of s.holes) {
			let g = groups.find((x) => x.h === h);
			if (!g) { g = { h, d: h.d, blind: h.blind, len: h.len, pts: [] }; groups.push(g); }
			// начало отверстия по высоте установа (0 — верх, в минус): отверстие может идти со дна кармана
			const av = it.axis.dot(s.v), cv = it.center.dot(s.v);
			const zTop = Math.max(cv + av * it.tmin, cv + av * it.tmax) - top(s.v);
			g.pts.push([it.center.dot(fr.right) - x0, it.center.dot(fr.up) - y0, Math.min(0, zTop)]);
		}
		groups.forEach((g) => g.pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
		// внутренние вертикальные углы этого установа ограничивают диаметр фрезы
		const rIn = part.innerR.filter((x) => Math.abs(x.axis.dot(s.v)) > 0.999).map((x) => x.r);
		return {
			letter: letters[i] || String(i + 1), dir: s.name, ...fr, rMin: rIn.length ? Math.min(...rIn) : null,
			sizeX: ext(fr.right), sizeY: ext(fr.up), height: ext(s.v),
			floors: s.floors.sort((a, b) => a.depth - b.depth), holes: groups.sort((a, b) => b.d - a.d),
			// наружный контур: боковые грани не совпадают с габаритом заготовки
			contour: i === 0 && DIRS.filter((d) => Math.abs(d.v.dot(s.v)) < 0.5).some((d) => sides.find((x) => x.name === d.name).topArea < faceArea(box, d.v) * 0.85),
		};
	});
	res.oblique = oblique; res.obliqueHoles = obliqueHoles.length;
	return res;
}
function faceArea(box, v) {
	const s = box.getSize(new THREE.Vector3());
	return Math.abs(v.x) > 0.5 ? s.y * s.z : Math.abs(v.y) > 0.5 ? s.x * s.z : s.x * s.y;
}

// ---------------------------------------------------------------------------
// 3. Заготовка
// ---------------------------------------------------------------------------
export function chooseBlank(part, density, o = {}) {
	const rho = (density || 7.85) / 1e6; // кг/мм³
	if (part.type === 'rotational') {
		const D = part.D, pl = part.plan;
		const allow = D <= 30 ? 1.5 : D <= 80 ? 2 : D <= 150 ? 2.5 : 3.5;
		const Db = nextStd(BAR, D + 2 * allow);
		// пруток через шпиндель: деталь отрезается на станке, зажим — за пруток
		const bar = o.blankMode === 'bar' && Db <= MACHINES.lathe.barMax;
		const grip = bar ? 0 : pl.gripAllow;
		const Lb = bar ? ceilTo(part.length + pl.face + 3, 1) : ceilTo(part.length + 2 * pl.face + grip, 1);
		const mass = Math.PI / 4 * Db * Db * Lb * rho;
		return {
			kind: 'bar', D: Db, L: Lb, mass, fromBar: bar, grip,
			text: bar ? `Пруток Ø${Db} ГОСТ 2590 (через шпиндель), на деталь ${Lb} мм` : `Круг Ø${Db} ГОСТ 2590, длина ${Lb} мм`,
			note: `Ø${f2(D)} + 2×${f1(allow)} мм припуск → ближайший по сортаменту Ø${Db}; длина ${f2(part.length)}` +
				(bar ? ` + подрезка ${f1(pl.face)} + отрезной резец 3 мм` : ` + подрезка торцов 2×${f1(pl.face)}${grip ? ` + технологический припуск под зажим ${grip} мм` : ''}`),
		};
	}
	const s = [part.size.x, part.size.y, part.size.z].sort((a, b) => a - b);
	const t = nextStd(PLATE, s[0] + 3);
	const w = ceilTo(s[1] + 6, 5), l = ceilTo(s[2] + 6, 5);
	const mass = t * w * l * rho;
	return {
		kind: 'plate', t, w, l, mass,
		text: `Лист (плита) t=${t} ГОСТ 19903, заготовка ${l}×${w}×${t} мм`,
		note: `габарит ${f2(s[2])}×${f2(s[1])}×${f2(s[0])} + припуск ~3 мм на сторону по контуру, ≥1,5 мм по толщине`,
	};
}

// ---------------------------------------------------------------------------
// 4. Маршрут: операция = установ. У операции — переходы и инструмент с режимами.
// ---------------------------------------------------------------------------
export function buildRoute(part, blank, o) {
	const eq = { ...DEFAULT_EQUIPMENT, ...(o.equipment || {}) };
	const mat = materialGroup(o.material);
	const ops = [];
	let no = 5;
	const add = (name, equip, steps, tools = []) => {
		ops.push({ no: String(no).padStart(3, '0'), name, equip, steps: steps.filter(Boolean), tools: tools.filter(Boolean) });
		no += 5;
	};
	const grind = o.grinding ? ', припуск 0,2–0,3 мм на сторону под шлифование (поверхности по чертежу)' : '';

	if (part.type === 'rotational') turningRoute(part, blank, o, eq, mat, add, grind);
	else millingRoute(part, blank, o, eq, mat, add, grind);

	add('Слесарная', eq.bench, ['Притупить острые кромки, снять заусенцы', 'Промыть деталь']);
	if (o.heat) add('Термическая', eq.heat, [o.heatText || 'Закалка и отпуск — по чертежу (HRC …)', 'Контроль твёрдости']);
	if (o.grinding) add('Шлифовальная', eq.grind, ['Шлифовать поверхности, указанные в чертеже, в окончательный размер']);
	if (o.edm) add('Электроэрозионная', eq.edm, [o.edmText || 'Вырезать / прошить элементы по чертежу (пазы, острые внутренние углы, профиль)']);
	if (o.coating) add('Покрытие', '', [o.coatingText || 'Нанести покрытие — по чертежу']);
	add('Контрольная', eq.qc, ['Контроль размеров, формы и шероховатости по чертежу', 'Оформить паспорт / клеймо ОТК']);
	return ops;
}

// инструмент токарного станка (номера позиций в револьвере — как в УП)
export const LATHE_TOOLS = {
	rough: { t: 'T0101', name: 'Резец проходной PCLNR 2525M12, пл. CNMG 120408' },
	finish: { t: 'T0303', name: 'Резец контурный SVJBR 2525M16, пл. VBMT 160404' },
	center: { t: 'T0505', name: 'Сверло центровочное А3,15' },
	drill: { t: 'T0707', name: 'Сверло' },
	bore: { t: 'T0909', name: 'Резец расточной S16R-SCLCR09, пл. CCMT 09T304' },
	cutoff: { t: 'T1111', name: 'Резец отрезной 3 мм' },
	live: { t: 'T0202', name: 'Приводной блок осевой ER25' },
	liveR: { t: 'T0404', name: 'Приводной блок радиальный ER25' },
};

function turningRoute(part, blank, o, eq, mat, add, grind) {
	const pl = part.plan, L = part.length, pr = part.profile;
	const maxS = MACHINES.lathe.rpm;
	const Db = blank.D;
	const sideName = (s) => (s === 'A' ? 'А' : 'Б');
	const endWord = (end) => (end === 'right' ? 'правого' : 'левого');

	if (!blank.fromBar) add('Заготовительная', eq.saw, [`Отрезать заготовку Ø${blank.D} × ${blank.L} мм`], ['Пила ленточная']);

	// элементы контура стороны: цилиндры, фаски, радиусы, конусы — конкретно
	const contourText = (pts) => {
		if (!pr || pts.length < 2) return null;
		const idx = new Set(pts.map((q) => q.i));
		const segs = pr.outer.segs.filter((sg) => idx.has(sg.from) && idx.has(sg.to));
		const P = pr.outer.points;
		const kinds = { cyl: new Set(), chamfer: new Set(), arc: new Set(), cone: [] };
		for (const sg of segs) {
			const k = segKind(sg, P);
			if (k === 'cyl') kinds.cyl.add('Ø' + f2(P[sg.from].r * 2));
			else if (k === 'chamfer') kinds.chamfer.add(chamferText(P[sg.from], P[sg.to]));
			else if (k === 'arc') kinds.arc.add('R' + f2(sg.el.R) + (sg.el.convex ? '' : ' вогн.'));
			else if (k === 'cone') kinds.cone.push(f1(Math.atan2(Math.abs(P[sg.to].r - P[sg.from].r), Math.abs(P[sg.to].t - P[sg.from].t)) * 360 / Math.PI) + '°');
		}
		const parts = [];
		if (kinds.cyl.size) parts.push([...kinds.cyl].join(', '));
		if (kinds.cone.length) parts.push('конус ' + [...new Set(kinds.cone)].join(', '));
		if (kinds.arc.size) parts.push([...kinds.arc].join(', '));
		if (kinds.chamfer.size) parts.push('фаски ' + [...kinds.chamfer].join(', '));
		return parts.join('; ');
	};
	const range = (pts) => (pts.length ? `т.${pts[0].i + 1}–т.${pts[pts.length - 1].i + 1}` : '');
	const concaveMin = (pts) => {
		if (!pr) return null;
		const idx = new Set(pts.map((q) => q.i));
		const r = pr.outer.segs.filter((sg) => idx.has(sg.from) && idx.has(sg.to) && sg.el.kind === 'arc' && !sg.el.convex).map((sg) => sg.el.R);
		return r.length ? Math.min(...r) : null;
	};
	// канавки и поднутрения: от свободного торца к патрону Ø где-то уменьшается — G71 не пройдёт, нужен G73
	const undercut = (pts, end) => hasUndercut(end === 'right' ? [...pts].reverse() : pts);

	// отверстия по оси C: осевые — с того торца, куда открыты; радиальные — в установе Б
	const liveMax = MACHINES.lathe.liveDrillMax;
	const cHoles = { A: [], B: [] }, kvlHoles = [];
	for (const h of part.holes) {
		if (h.kind === 'axial' && h.d <= liveMax + 1e-6) {
			const endA = pl.sideEnd('A'), endB = pl.sideEnd('B');
			// с торца Б (деталь уже почти готова), если отверстие туда открыто
			const side = h.opens === 'both' || h.opens === endB ? 'B' : h.opens === endA ? 'A' : null;
			if (side) { cHoles[side].push(h); continue; }
		}
		if (h.kind === 'radial' && h.d <= liveMax + 1e-6) { cHoles.B.push(h); continue; }
		kvlHoles.push(h);
	}
	const cHoleText = (h) => {
		const n = h.count > 1 ? `${h.count} отв.` : 'отв.';
		const depth = h.through ? 'насквозь' : `на глубину ${f2(h.len)} мм`;
		if (h.kind === 'axial') {
			const where = h.count > 1 ? ` на Ø${f2(h.pcd)}${h.even ? `, равномерно (шаг ${f1(360 / h.count)}°)` : ''}` : ` на расстоянии ${f2(h.pcd / 2)} мм от оси`;
			return `Ось C, приводной инструмент: центровать и сверлить ${n} Ø${f2(h.d)} ${depth}${where}`;
		}
		return `Ось C, приводной инструмент: центровать и сверлить радиальные ${n} Ø${f2(h.d)} ${depth}, Z ${f2(h.items[0].t)} от левого торца`;
	};
	const cTools = (list) => {
		const out = [];
		if (!list.length) return out;
		const axial = list.some((h) => h.kind === 'axial'), radial = list.some((h) => h.kind === 'radial');
		const blk = [axial && LATHE_TOOLS.live.t, radial && LATHE_TOOLS.liveR.t].filter(Boolean).join(' / ');
		out.push(`${blk} Сверло центровочное Ø6 90° — ${cutMode(mat, 'center', 6, MACHINES.lathe.liveRpm).text}`);
		for (const d of [...new Set(list.map((h) => drillFor(h.d)))]) out.push(`${blk} Сверло Ø${f2(d)} — ${cutMode(mat, 'drill', d, MACHINES.lathe.liveRpm).text}`);
		return out;
	};

	const side = (S) => {
		const outerPts = S === 'A' ? pl.outerA : pl.outerB;
		const innerPts = S === 'A' ? pl.innerA : pl.innerB;
		const end = pl.sideEnd(S);
		const len = S === 'A' ? pl.lenA : pl.lenB;
		const steps = [], tools = [];
		const tail = S === 'A' ? pl.tailA : pl.tailB;
		if (S === 'A') {
			if (blank.fromBar) steps.push(`Подать пруток Ø${Db}, вылет ${pl.stickA + 3} мм (с учётом отрезки), зажать`);
			else steps.push(`Закрепить заготовку в трёхкулачковом патроне за Ø${Db}, вылет ${pl.stickA} мм`);
		} else {
			const c = pl.clamp;
			steps.push(c
				? `Переустановить: зажать за Ø${f2(c.d)} (обработан в уст. А) в мягких кулачках, длина зажима ${f1(Math.min(c.len, 30))} мм, упор в уступ; вылет ${pl.stickB} мм`
				: `Переустановить деталь, зажать за обработанную поверхность в мягких кулачках, вылет ${pl.stickB} мм`);
		}
		if (tail) steps.push(`Подрезать торец, сверлить центровое отверстие А3,15 ГОСТ 14034 (если центровое на детали недопустимо — оставить технологический хвостовик), поджать задним центром (M78)`);
		// торец
		if (S === 'B' && blank.grip) steps.push(`Отрезать (подрезать) технологический припуск ${blank.grip} мм, подрезать торец в размер ${f2(L)} мм`);
		else if (S === 'B') steps.push(`Подрезать торец в размер ${f2(L)} мм`);
		else steps.push(`Подрезать торец ${endWord(end)} конца, снять ${f1(pl.face)} мм`);
		// сверление по оси (сквозное — в установе А)
		const bores = part.bores.filter((b) => (S === 'A' ? b.opens === 'both' || b.opens === end : b.opens === end));
		const minBore = bores.length ? Math.min(...bores.map((b) => b.d)) : null;
		let drillD = null;
		// неглубокую выточку растачивают с торца без сверления
		const deepest = bores.length ? Math.max(...bores.map((b) => b.len)) : 0;
		if (minBore && (bores.some((b) => b.through) || deepest > Math.min(6, 0.25 * minBore))) {
			drillD = minBore <= 20 ? drillFor(minBore - (minBore > 6 ? 1 : 0.2)) : Math.min(30, drillFor(minBore - 6));
			const through = bores.some((b) => b.through);
			const depth = through ? 'насквозь' : `на глубину ${f2(deepest)} мм`;
			steps.push(`Центровать, сверлить Ø${f2(drillD)} ${depth}`);
		}
		// наружный контур
		if (outerPts.length >= 2) {
			const txt = contourText(outerPts);
			const uc = undercut(outerPts, end);
			steps.push(`Точить начерно наружный контур ${range(outerPts)} (лист «Профиль»), припуск 0,5 мм на Ø и 0,1 мм по Z${uc ? ' — есть поднутрения: цикл G73' : ''}`);
			steps.push(`Точить начисто наружный контур ${range(outerPts)}${txt ? ': ' + txt : ''}${grind}`);
			const cm = concaveMin(outerPts);
			if (cm != null && cm < 0.8) steps.push(`Вогнутый радиус R${f2(cm)} меньше радиуса пластины — канавочный / фасонный резец`);
		} else {
			const segs = part.outer.filter((s) => (S === 'A' ? (pl.aEnd === 'right' ? s.t1 > pl.split + 0.01 : s.t0 < pl.split - 0.01) : (pl.aEnd === 'right' ? s.t0 < pl.split - 0.01 : s.t1 > pl.split + 0.01)));
			for (const s of segs) steps.push(`Точить Ø${f2(s.d)} на длину ${f2(s.len)} мм начерно и начисто${grind}`);
		}
		// расточка
		if (innerPts.length >= 2) {
			// диаметры с точностью 0,1 мм (резьба и мелкие переходы дают много почти одинаковых)
			const dl = [...new Set(innerPts.map((q) => Math.round(q.r * 20) / 10))].sort((p, q) => q - p);
			const ds = dl.slice(0, 6).map((d) => 'Ø' + f1(d)).join(', ') + (dl.length > 6 ? ' …' : '');
			steps.push(`Расточить начерно и начисто внутренний контур ${innerPts.map((q) => 'В' + (q.i + 1)).filter((x, i, a) => i === 0 || i === a.length - 1).join('–')}: ${ds}${grind}`);
		} else for (const b of bores) if (b.d - (drillD || 0) > 0.6) steps.push(`Расточить Ø${f2(b.d)}${b.through ? '' : ` на глубину ${f2(b.len)} мм`} начерно и начисто${grind}`);
		// ось C
		for (const h of cHoles[S]) steps.push(cHoleText(h));
		if (S === 'A' && blank.fromBar) steps.push(`Отрезать деталь с припуском ${f1(pl.face)} мм на подрезку`);

		// инструмент и режимы
		const dRef = Math.max(...(outerPts.length ? outerPts.map((q) => q.r * 2) : [part.D]));
		tools.push(`${LATHE_TOOLS.rough.t} ${LATHE_TOOLS.rough.name} — черн.: ${cutMode(mat, 'turnR', dRef, maxS).text}, ap 2 мм`);
		tools.push(`${LATHE_TOOLS.finish.t} ${LATHE_TOOLS.finish.name} — чист.: ${cutMode(mat, 'turnF', dRef, maxS).text}, ap 0,25 мм`);
		if (minBore || tail) tools.push(`${LATHE_TOOLS.center.t} ${LATHE_TOOLS.center.name} — ${cutMode(mat, 'center', 6, maxS).text}`);
		if (drillD) tools.push(`${LATHE_TOOLS.drill.t} Сверло Ø${f2(drillD)} — ${cutMode(mat, 'drill', drillD, maxS).text}`);
		if (innerPts.length >= 2 || bores.some((b) => b.d - (drillD || 0) > 0.6)) tools.push(`${LATHE_TOOLS.bore.t} ${LATHE_TOOLS.bore.name} — ${cutMode(mat, 'bore', minBore || 20, maxS).text}`);
		if (S === 'A' && blank.fromBar) tools.push(`${LATHE_TOOLS.cutoff.t} ${LATHE_TOOLS.cutoff.name} — Vc 80 м/мин, f 0,05 мм/об`);
		tools.push(...cTools(cHoles[S]));
		const what = len < 0.5 ? 'подрезка торца' : `${end === 'right' ? 'правая' : 'левая'} сторона, ${f2(len)} мм`;
		add(`Токарная с ЧПУ — установ ${sideName(S)} (${what})`, eq.lathe, steps, tools);
	};
	side('A');
	side('B');

	// фрезерная: то, что токарный без оси Y не сделает
	if (kvlHoles.length || part.flats.length) {
		const steps = [];
		const multi = part.flats.length > 1 || kvlHoles.some((h) => h.count > 1);
		steps.push(multi
			? 'Установить деталь в патрон поворотного стола (стол наклонён на 90°, ось C вдоль Y), выверить'
			: 'Установить деталь в тиски с призматическими губками, выверить по оси');
		const tools = [];
		const fl = part.flats;
		const polyName = (n) => (n === 2 ? 'квадрат' : n === 3 ? 'шестигранник' : n === 4 ? 'восьмигранник' : `${n * 2}-гранник`);
		for (const f of fl) {
			if (f.kind === 'pair') steps.push(`Фрезеровать лыски под ключ S=${f2(f.S)} мм`);
			else if (f.kind === 'polygon') steps.push(`Фрезеровать ${polyName(f.n)} под ключ S=${f2(f.S)} мм`);
			else if (f.kind === 'spline') steps.push(`Шлицы / рифление: ${f.n * 2} граней, S=${f2(f.S)} мм — по чертежу (фреза / долбление)`);
			else if (f.kind === 'slot') steps.push(`Фрезеровать паз (шлиц) шириной ${f2(f.S)} мм${f.n > 1 ? `, ${f.n} шт.` : ''} — по модели`);
		}
		const singles = fl.filter((f) => f.kind === 'single');
		if (singles.length) steps.push(`Фрезеровать ${singles.length > 1 ? singles.length + ' лыски' : 'лыску'} на расстоянии ${[...new Set(singles.map((f) => f2(f.dist)))].join(' / ')} мм от оси`);
		const obl = fl.filter((f) => f.kind === 'oblique');
		if (obl.length) steps.push(`Фрезеровать наклонные плоскости — ${obl.length} шт. (по модели)`);
		if (fl.length) tools.push(`Фреза концевая Ø12 Z4 — ${cutMode(mat, 'endR', 12, MACHINES.mill.rpm).text}`);
		for (const h of kvlHoles) {
			steps.push(`Центровать и сверлить ${h.count > 1 ? h.count + ' отв.' : 'отв.'} Ø${f2(h.d)} ${h.through ? 'насквозь' : `на глубину ${f2(h.len)} мм`} (по модели)`);
		}
		if (kvlHoles.length) {
			tools.push(`Сверло центровочное Ø10 90° — ${cutMode(mat, 'center', 10, MACHINES.mill.rpm).text}`);
			for (const d of [...new Set(kvlHoles.map((h) => drillFor(h.d)))]) tools.push(`Сверло Ø${f2(d)} — ${cutMode(mat, 'drill', d, MACHINES.mill.rpm).text}`);
		}
		add('Фрезерная с ЧПУ (лыски, отверстия вне оси)', eq.mill, steps, tools);
	}
}

function millingRoute(part, blank, o, eq, mat, add, grind) {
	const maxS = MACHINES.mill.rpm;
	const setups = part.setups;
	add('Заготовительная', eq.saw, [`Вырезать заготовку ${blank.l}×${blank.w}×${blank.t} мм`], ['Пила ленточная']);
	const face = blank.w >= 60 ? 63 : 50;
	// черновая фреза — по размеру детали; чистовая — не больше внутреннего радиуса угла ×2
	const small = Math.min(part.size.x, part.size.y, part.size.z);
	const roughD = small >= 80 ? 16 : small >= 30 ? 12 : small >= 15 ? 8 : 6;
	// углы меньше R1 фрезой не делают (ЭЭО) — для них фрезу не мельчим
	const finishD = (rMin) => (rMin == null ? roughD : rMin < 1 ? Math.min(roughD, 6) : Math.min(roughD, [...END_MILLS].reverse().find((d) => d <= 2 * rMin * 0.95 + 1e-6) || END_MILLS[0]));
	const big = Math.max(part.size.x, part.size.y, part.size.z) > 160;
	// мелкие «отверстия» глубиной меньше трети Ø — цековки и круглые углубления, их фрезеруют
	const isPocket = (g) => g.blind && g.len < g.d * 0.3;
	const holeText = (g) => {
		const n = g.pts.length > 1 ? `${g.pts.length} отв.` : 'отв.';
		const depth = g.blind ? `на глубину ${f2(g.len)} мм` : 'насквозь';
		if (isPocket(g)) return `Фрезеровать круглые углубления Ø${f2(g.d)} глубиной ${f2(g.len)} мм${g.pts.length > 1 ? ` — ${g.pts.length} шт.` : ''}`;
		if (g.d > 40) return `Фрезеровать (расточить) отверстие Ø${f2(g.d)} ${depth} по винтовой траектории начерно и начисто${grind}`;
		if (g.d > 16) return `Сверлить Ø${f2(Math.min(30, drillFor(g.d - 4)))} и фрезеровать (расточить) ${n} Ø${f2(g.d)} ${depth}${grind}`;
		return `Центровать и сверлить ${n} Ø${f2(g.d)} ${depth}`;
	};
	setups.forEach((s, i) => {
		const steps = [], tools = [];
		const H = s.height;
		if (i === 0) steps.push(big
			? 'Установить заготовку на стол станка на параллельные подкладки, закрепить прихватами, выверить'
			: `Установить заготовку в тиски, вылет над губками ≥ ${f1(Math.min(H, (s.floors.at(-1)?.depth || 0) + 5) + 3)} мм, базирование по необработанной плоскости`);
		else if (i === 1) steps.push('Перевернуть, базировать по обработанной в уст. А плоскости и боковой стороне');
		else steps.push(`Установить деталью вверх стороной ${s.dir} (или повернуть стол), базировать по обработанным плоскостям`);
		if (i === 0) {
			steps.push(`Фрезеровать верхнюю плоскость, снять ~1,5 мм`);
			if (s.contour) steps.push(`Фрезеровать наружный контур в размер ${f2(s.sizeX)} × ${f2(s.sizeY)} мм на глубину ~${f1(Math.max(1, H - 6))} мм (остаток — в уст. Б)`);
			else steps.push(`Фрезеровать боковые стороны в размер ${f2(s.sizeX)} × ${f2(s.sizeY)} мм`);
		} else if (i === 1) {
			steps.push(`Фрезеровать плоскость в размер толщины ${f2(H)} мм${grind}`);
			if (setups[0].contour) steps.push('Дофрезеровать наружный контур на оставшуюся глубину');
		}
		for (const f of s.floors) steps.push(`Фрезеровать карман / уступ до глубины ${f2(f.depth)} мм от верха${f.count > 1 ? ` (${f.count} уч.)` : ''} начерно и начисто`);
		for (const g of s.holes) steps.push(holeText(g));
		const fin = finishD(s.rMin);
		if (s.rMin != null && s.rMin < 1) steps.push(`Внутренние углы R${f2(s.rMin)} — фрезой не получить, дорабатывать электроэрозией или по согласованию увеличить R`);
		if (i === 0 || i === 1) tools.push(`Фреза торцевая Ø${face} — ${cutMode(mat, 'face', face, maxS).text}`);
		const milled = s.floors.length || (i < 2 && setups[0].contour) || s.holes.some((g) => isPocket(g) || g.d > 16);
		if (milled) {
			tools.push(`Фреза концевая Ø${roughD} — черн.: ${cutMode(mat, 'endR', roughD, maxS).text}`);
			tools.push(`Фреза концевая Ø${fin} — чист.: ${cutMode(mat, 'endF', fin, maxS).text}${s.rMin != null && s.rMin >= 1 ? ` (внутр. углы R${f2(s.rMin)})` : ''}`);
		}
		const drilled = s.holes.filter((g) => !isPocket(g) && g.d <= 40);
		if (drilled.length) {
			tools.push(`Сверло центровочное Ø10 90° — ${cutMode(mat, 'center', 10, maxS).text}`);
			for (const d of [...new Set(drilled.map((g) => (g.d > 16 ? Math.min(30, drillFor(g.d - 4)) : drillFor(g.d))))]) tools.push(`Сверло Ø${f2(d)} — ${cutMode(mat, 'drill', d, maxS).text}`);
		}
		add(`Фрезерная с ЧПУ — установ ${s.letter} (сторона ${s.dir})`, eq.mill, steps, tools);
	});
	if (setups.oblique || setups.obliqueHoles) {
		add('Фрезерная с ЧПУ — наклонные элементы', eq.mill, [
			'Наклонить стол на нужный угол вручную, зафиксировать, выверить',
			`Обработать наклонные элементы: ${setups.oblique ? setups.oblique + ' плоск.' : ''}${setups.oblique && setups.obliqueHoles ? ', ' : ''}${setups.obliqueHoles ? setups.obliqueHoles + ' отв.' : ''} — по модели`,
		]);
	}
}

export function describePart(part) {
	if (part.type === 'rotational') {
		const pl = part.plan;
		const rows = [
			['Тип:', 'тело вращения (токарная обработка)'],
			['Наибольший Ø:', 'Ø' + f2(part.D) + ' мм'],
			['Длина:', f2(part.length) + ' мм'],
			['Ступени:', part.outer.length ? [...part.outer].sort((a, b) => a.t0 - b.t0).map((s) => 'Ø' + f2(s.d)).join(' · ') : '—'],
			['Расточки:', part.bores.length ? part.bores.map((b) => 'Ø' + f2(b.d) + (b.through ? ' сквозн.' : '')).join(' · ') : '—'],
		];
		for (const h of part.holes) {
			const kind = h.kind === 'axial' ? (h.count > 1 ? `на Ø${f2(h.pcd)}` : 'осевое') : h.kind === 'radial' ? 'радиальн.' : 'вне оси';
			rows.push(['Отверстия:', `${h.count > 1 ? h.count + '×' : ''}Ø${f2(h.d)} ${kind}${h.through ? ', скв.' : ''}`]);
		}
		if (part.flats.length) {
			const names = { pair: 'под ключ', polygon: 'многогранник', spline: 'шлицы/рифление', slot: 'паз' };
			const main = part.flats.filter((f) => names[f.kind]).map((f) => `${names[f.kind]} S${f2(f.S)}`);
			const other = part.flats.filter((f) => !names[f.kind]).length;
			rows.push(['Лыски, пазы:', [...main, other ? other + ' плоск.' : ''].filter(Boolean).join(', ')]);
		}
		if (pl.clamp) rows.push(['Установы:', `А — ${pl.aEnd === 'right' ? 'правая' : 'левая'} сторона (${f2(pl.lenA)} мм), Б — зажим за Ø${f2(pl.clamp.d)}`]);
		return rows;
	}
	const s = part.size;
	const rows = [
		['Тип:', 'корпусная (фрезерная обработка)'],
		['Габариты:', `${f2(s.x)} × ${f2(s.y)} × ${f2(s.z)} мм`],
		['Отверстия:', part.holes.length ? part.holes.map((h) => (h.count > 1 ? h.count + '×' : '') + 'Ø' + f2(h.d) + (h.through ? ' скв.' : '')).join(' · ') : '—'],
		['Установы:', part.setups.map((x) => `${x.letter} (${x.dir}): ${x.floors.length} уровн., ${x.holes.reduce((n, g) => n + g.pts.length, 0)} отв.`).join('; ')],
	];
	const rr = part.setups.filter((x) => x.rMin != null).map((x) => x.rMin);
	if (rr.length) rows.push(['Внутр. углы:', 'R' + f2(Math.min(...rr)) + ' (ограничивает Ø чистовой фрезы)']);
	return rows;
}
