// Анализ детали по 3D-модели и черновик технологического процесса:
// тип детали (тело вращения / корпусная), элементы для токарной и фрезерной
// обработки, заготовка по сортаменту, маршрут операций.
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
const nextStd = (list, v) => list.find((x) => x >= v - 1e-9) || Math.ceil(v / 10) * 10;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');
const f2 = (v) => (Math.round(v * 100) / 100).toLocaleString('ru-RU');

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

	// глухое отверстие: у конца есть «дно» — грань с центром на оси отверстия (плоское дно или конус сверла)
	const capped = (g) => {
		for (const f of faces) {
			if (f.type === 'cylinder' || !f.centroid) continue;
			if (lineDist(g.center, g.axis, f.centroid) > g.radius * 0.6) continue;
			const t = f.centroid.clone().sub(g.center).dot(g.axis);
			if (Math.abs(t - g.tmin) < g.radius * 1.2 || Math.abs(t - g.tmax) < g.radius * 1.2) {
				// плоскость дна должна быть поперёк оси, а площадь — не больше сечения отверстия ×1,5
				if (f.type === 'plane' && Math.abs(f.normal.dot(g.axis)) < 0.99) continue;
				if (f.area > Math.PI * g.radius * g.radius * 1.5) continue;
				return true;
			}
		}
		return false;
	};
	const holeGroups = (list) => {
		const out = [];
		for (const g of list) {
			const d = g.radius * 2;
			const len = g.tmax - g.tmin;
			const blind = capped(g);
			let e = out.find((x) => Math.abs(x.d - d) < 0.01 && Math.abs(x.len - len) < 0.05 && x.blind === blind);
			if (!e) { e = { d, len, count: 0, items: [], blind }; out.push(e); }
			e.count++;
			e.items.push(g);
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
		const offHoles = holeGroups(cyl.filter((g) => g.hole && !onAxis(g) && g.sweep > Math.PI * 1.6));
		const sidePlanes = planes.filter((p) => Math.abs(p.normal.dot(rot.axis)) < 0.999);
		const faceCount = planes.length - sidePlanes.length;
		return {
			type: 'rotational', axis: rot, length: L, D: rot.D,
			outer: merge(outer), bores: merge(bores).map((b) => ({ ...b, through: b.len > L - 0.5 })),
			holes: offHoles.map((h) => ({ ...h, through: !h.blind })), sidePlanes: sidePlanes.length, facePlanes: faceCount,
			fillets, size, box,
		};
	}

	// корпусная деталь
	const holes = holeGroups(cyl.filter((g) => g.hole && g.sweep > Math.PI * 1.6)).map((h) => ({ ...h, through: !h.blind }));
	const bosses = holeGroups(cyl.filter((g) => !g.hole && g.sweep > Math.PI * 1.6));
	return { type: 'prismatic', size, box, planes: planes.length, holes, bosses, fillets };
}

// ---------------------------------------------------------------------------
// 3. Заготовка
// ---------------------------------------------------------------------------
export function chooseBlank(part, density) {
	const rho = (density || 7.85) / 1e6; // кг/мм³
	if (part.type === 'rotational') {
		const D = part.D;
		const allow = D <= 30 ? 1.5 : D <= 80 ? 2 : D <= 150 ? 2.5 : 3.5;
		const Db = nextStd(BAR, D + 2 * allow);
		const face = D <= 50 ? 1.5 : 2.5; // подрезка каждого торца
		const cut = 3; // ширина пропила / отрезки
		const Lb = ceilTo(part.length + 2 * face + cut, 1);
		const mass = Math.PI / 4 * Db * Db * Lb * rho;
		return {
			kind: 'bar', D: Db, L: Lb, mass,
			text: `Круг Ø${Db} ГОСТ 2590, длина ${Lb} мм`,
			note: `Ø${f2(D)} + 2×${f1(allow)} мм припуск → ближайший по сортаменту Ø${Db}; длина ${f2(part.length)} + подрезка торцов 2×${f1(face)} + отрезка ${cut} мм`,
		};
	}
	const s = [part.size.x, part.size.y, part.size.z].sort((a, b) => a - b);
	const t = nextStd(PLATE, s[0] + 3);
	const w = ceilTo(s[1] + 6, 5), l = ceilTo(s[2] + 6, 5);
	const mass = t * w * l * rho;
	return {
		kind: 'plate', t, w, l, mass,
		text: `Лист (плита) t=${t} ГОСТ 19903, заготовка ${l}×${w}×${t} мм`,
		note: `габарит ${f2(s[2])}×${f2(s[1])}×${f2(s[0])} + припуск ~3 мм на сторону по контуру, 1,5 мм по толщине`,
	};
}

// ---------------------------------------------------------------------------
// 4. Маршрут
// ---------------------------------------------------------------------------
export function buildRoute(part, blank, o) {
	const eq = { ...DEFAULT_EQUIPMENT, ...(o.equipment || {}) };
	const ops = [];
	let no = 5;
	const add = (name, equip, steps) => { ops.push({ no: String(no).padStart(3, '0'), name, equip, steps: steps.filter(Boolean) }); no += 5; };
	const grindAllow = o.grinding ? ' с припуском 0,2–0,3 мм на сторону под шлифование (поверхности по чертежу)' : '';

	add('Заготовительная', eq.saw, [
		blank.kind === 'bar' ? `Отрезать заготовку Ø${blank.D} × ${blank.L} мм из прутка` : `Вырезать заготовку ${blank.l}×${blank.w}×${blank.t} мм`,
	]);

	if (part.type === 'rotational') {
		const outer = [...part.outer].sort((a, b) => b.d - a.d);
		const bores = [...part.bores].sort((a, b) => a.d - b.d);
		const L = part.length;
		const rough = ['Установ А: закрепить заготовку в патроне', 'Подрезать торец'];
		for (const s of outer) rough.push(`Точить Ø${f2(s.d)} на длину ${f2(s.len)} мм предварительно, припуск 0,5–1 мм на сторону`);
		for (const b of bores) {
			const dr = b.d > 24 ? Math.max(10, Math.floor(b.d - 6)) : null;
			rough.push(b.through
				? `${dr ? `Сверлить Ø${dr} насквозь, р` : 'Р'}асточить отверстие Ø${f2(b.d)} предварительно${dr ? '' : ' (сверлить)'}, припуск 0,3–0,5 мм`
				: `${dr ? `Сверлить Ø${dr}, р` : 'Р'}асточить отверстие Ø${f2(b.d)} на глубину ${f2(b.len)} мм предварительно`);
		}
		rough.push('Установ Б: переустановить деталь', `Подрезать второй торец в размер ${f2(L)} мм (с припуском под чистовую 0,3 мм)`);
		add('Токарная (черновая)', eq.lathe, rough);

		const fin = ['Установ А', 'Подрезать торец начисто'];
		for (const s of outer) fin.push(`Точить Ø${f2(s.d)} на длину ${f2(s.len)} мм начисто${grindAllow}`);
		for (const b of bores) fin.push(`Расточить отверстие Ø${f2(b.d)}${b.through ? '' : ` на глубину ${f2(b.len)} мм`} начисто${grindAllow}`);
		fin.push('Снять фаски, выполнить канавки и резьбы — по чертежу');
		fin.push('Установ Б', `Подрезать торец в размер ${f2(L)} мм начисто`, 'Снять фаски — по чертежу');
		add('Токарная (чистовая)', eq.lathe, fin);

		if (part.holes.length || part.sidePlanes) {
			const mill = ['Установить деталь в призмы / делительное приспособление'];
			if (part.sidePlanes) mill.push(`Фрезеровать лыски, пазы, плоскости — ${part.sidePlanes} шт. (по модели)`);
			for (const h of part.holes) mill.push(drillText(h));
			add('Фрезерная (сверлильная)', eq.mill, mill);
		}
	} else {
		const s = [part.size.x, part.size.y, part.size.z].sort((a, b) => b - a);
		add('Фрезерная (черновая)', eq.mill, [
			'Установить заготовку в тиски',
			`Фрезеровать 6 сторон в размер ${f2(s[0] + 1)} × ${f2(s[1] + 1)} × ${f2(s[2] + 0.6)} мм (припуск под чистовую)`,
			part.holes.some((h) => h.d >= 20) ? 'Предварительно обработать отверстия большого диаметра' : null,
		]);
		const fin = ['Установ А: базирование по обработанным поверхностям',
			`Фрезеровать в размер ${f2(s[0])} × ${f2(s[1])} × ${f2(s[2])} мм`,
			`Фрезеровать контур, карманы, плоскости — по модели (${part.planes} плоских граней)`];
		for (const h of part.holes) fin.push(drillText(h));
		if (part.bosses.length) fin.push(`Обработать цилиндрические поверхности: ${part.bosses.map((b) => 'Ø' + f2(b.d) + (b.count > 1 ? ' (' + b.count + ' шт.)' : '')).join(', ')}`);
		fin.push('Установ Б: перевернуть, обработать вторую сторону — по чертежу');
		add('Фрезерная (чистовая)', eq.mill, fin);
	}

	add('Слесарная', eq.bench, ['Притупить острые кромки, снять заусенцы', 'Промыть деталь']);
	if (o.heat) add('Термическая', eq.heat, [o.heatText || 'Закалка и отпуск — по чертежу (HRC …)', 'Контроль твёрдости']);
	if (o.grinding) add('Шлифовальная', eq.grind, ['Шлифовать поверхности, указанные в чертеже, в окончательный размер']);
	if (o.edm) add('Электроэрозионная', eq.edm, [o.edmText || 'Вырезать / прошить элементы по чертежу (пазы, острые внутренние углы, профиль)']);
	if (o.coating) add('Покрытие', '', [o.coatingText || 'Нанести покрытие — по чертежу']);
	add('Контрольная', eq.qc, ['Контроль размеров, формы и шероховатости по чертежу', 'Оформить паспорт / клеймо ОТК']);
	return ops;

	function drillText(h) {
		const n = h.count > 1 ? `${h.count} отв.` : 'отверстие';
		const depth = h.through ? 'насквозь' : `на глубину ${f2(h.len)} мм`;
		if (h.d >= 20) return `Сверлить и расточить (фрезеровать) ${n} Ø${f2(h.d)} ${depth}`;
		return `Центровать и сверлить ${n} Ø${f2(h.d)} ${depth}`;
	}
}

export function describePart(part) {
	if (part.type === 'rotational') {
		const rows = [
			['Тип:', 'тело вращения (токарная обработка)'],
			['Наибольший Ø:', 'Ø' + f2(part.D) + ' мм'],
			['Длина:', f2(part.length) + ' мм'],
			['Ступени:', part.outer.length ? [...part.outer].sort((a, b) => a.t0 - b.t0).map((s) => 'Ø' + f2(s.d)).join(' · ') : '—'],
			['Расточки:', part.bores.length ? part.bores.map((b) => 'Ø' + f2(b.d) + (b.through ? ' сквозн.' : '')).join(' · ') : '—'],
		];
		if (part.holes.length) rows.push(['Отверстия:', part.holes.map((h) => (h.count > 1 ? h.count + '×' : '') + 'Ø' + f2(h.d)).join(' · ')]);
		if (part.sidePlanes) rows.push(['Лыски/пазы:', part.sidePlanes + ' плоск.']);
		return rows;
	}
	const s = part.size;
	const rows = [
		['Тип:', 'корпусная (фрезерная обработка)'],
		['Габариты:', `${f2(s.x)} × ${f2(s.y)} × ${f2(s.z)} мм`],
		['Плоских граней:', String(part.planes)],
		['Отверстия:', part.holes.length ? part.holes.map((h) => (h.count > 1 ? h.count + '×' : '') + 'Ø' + f2(h.d) + (h.through ? ' скв.' : '')).join(' · ') : '—'],
	];
	if (part.fillets.length) rows.push(['Скругления:', part.fillets.map((r) => 'R' + r).join(' · ')]);
	return rows;
}
