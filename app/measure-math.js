// Геометрия для измерений: выделение грани CAD под курсором и распознавание
// плоскости / цилиндра (отверстие, вал, скругление).
//
// Для STEP/IGES/BREP грани берутся из разбиения OpenCascade (geometry.userData.faceOf),
// вершины сетки лежат точно на поверхности — поэтому радиус, подогнанный по ним,
// совпадает с размером в CAD. Для STL/OBJ грань находится наращиванием области
// по плавным переходам нормалей (точность ниже — зависит от сетки файла).
import * as THREE from 'three';

const SMOOTH_ANGLE = Math.cos(THREE.MathUtils.degToRad(12));
const REGION_LIMIT = 300000; // треугольников в одной «грани» сетки

// ---------- треугольники грани ----------
export function faceTriangles(geom, tri) {
	const ud = geom.userData;
	if (ud.faceOf && ud.faces) {
		const f = ud.faces[ud.faceOf[tri]];
		if (f) {
			const out = new Uint32Array(f.last - f.first + 1);
			for (let i = 0; i < out.length; i++) out[i] = f.first + i;
			return { tris: out, exact: true };
		}
	}
	return { tris: growRegion(geom, tri), exact: false };
}

function triCount(geom) {
	return (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
}
function vIndex(geom, t, k) {
	return geom.index ? geom.index.array[t * 3 + k] : t * 3 + k;
}

// смежность треугольников по общим рёбрам (по совпадающим координатам)
function adjacency(geom) {
	if (geom.userData._adj) return geom.userData._adj;
	const P = geom.attributes.position.array;
	const n = triCount(geom);
	const box = new THREE.Box3().setFromBufferAttribute(geom.attributes.position);
	const q = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, 1e-9) * 1e-6;
	const ids = new Map();
	const vid = new Int32Array(n * 3);
	for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
		const i = vIndex(geom, t, k) * 3;
		const key = Math.round(P[i] / q) + ',' + Math.round(P[i + 1] / q) + ',' + Math.round(P[i + 2] / q);
		let id = ids.get(key);
		if (id === undefined) { id = ids.size; ids.set(key, id); }
		vid[t * 3 + k] = id;
	}
	const nv = ids.size;
	const edges = new Map();
	const nb = new Int32Array(n * 3).fill(-1);
	for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
		const a = vid[t * 3 + k], b = vid[t * 3 + (k + 1) % 3];
		const key = a < b ? a * nv + b : b * nv + a; // nv² < 2^53 для любых реальных сеток
		const other = edges.get(key);
		if (other === undefined) edges.set(key, t * 3 + k);
		else { nb[t * 3 + k] = Math.floor(other / 3); nb[other] = t; }
	}
	geom.userData._adj = nb;
	return nb;
}

function triNormal(geom, t, out) {
	const P = geom.attributes.position.array;
	const a = vIndex(geom, t, 0) * 3, b = vIndex(geom, t, 1) * 3, c = vIndex(geom, t, 2) * 3;
	const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
	const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
	out.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
	const l = out.length();
	if (l > 0) out.divideScalar(l);
	return l / 2;
}

function growRegion(geom, start) {
	const nb = adjacency(geom);
	const seen = new Uint8Array(triCount(geom));
	const out = [start];
	seen[start] = 1;
	const na = new THREE.Vector3(), nbv = new THREE.Vector3();
	for (let i = 0; i < out.length && out.length < REGION_LIMIT; i++) {
		const t = out[i];
		triNormal(geom, t, na);
		for (let k = 0; k < 3; k++) {
			const u = nb[t * 3 + k];
			if (u < 0 || seen[u]) continue;
			triNormal(geom, u, nbv);
			if (na.dot(nbv) >= SMOOTH_ANGLE) { seen[u] = 1; out.push(u); }
		}
	}
	return Uint32Array.from(out);
}

// ---------- распознавание поверхности ----------
// Возвращает { type: 'plane'|'cylinder'|'other', area, centroid, ... } в мировых координатах.
export function analyzeFace(mesh, tris) {
	const geom = mesh.geometry;
	const P = geom.attributes.position.array;
	const M = mesh.matrixWorld;
	const used = new Map();
	const pts = [];
	const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
	const n = new THREE.Vector3(), sumN = new THREE.Vector3(), centroid = new THREE.Vector3();
	const cov = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz — сумма нормалей n·nᵀ с весом площади
	const tn = [];
	let area = 0;
	const pt = (i) => {
		let p = used.get(i);
		if (!p) { p = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M); used.set(i, p); pts.push(p); }
		return p;
	};
	for (const t of tris) {
		const a = pt(vIndex(geom, t, 0)), b = pt(vIndex(geom, t, 1)), c = pt(vIndex(geom, t, 2));
		A.subVectors(b, a); B.subVectors(c, a);
		n.crossVectors(A, B);
		const s = n.length() / 2;
		if (s <= 0) continue;
		n.normalize();
		area += s;
		sumN.addScaledVector(n, s);
		C.copy(a).add(b).add(c).multiplyScalar(s / 3);
		centroid.add(C);
		cov[0] += s * n.x * n.x; cov[1] += s * n.x * n.y; cov[2] += s * n.x * n.z;
		cov[3] += s * n.y * n.y; cov[4] += s * n.y * n.z; cov[5] += s * n.z * n.z;
		tn.push(n.clone(), s, a.clone().add(b).add(c).divideScalar(3));
	}
	if (area <= 0) return { type: 'other', area: 0, centroid: pts[0] || new THREE.Vector3() };
	centroid.divideScalar(area);

	// плоскость: все нормали почти совпадают
	const meanN = sumN.clone().normalize();
	let maxDev = 0;
	for (let i = 0; i < tn.length; i += 3) maxDev = Math.max(maxDev, 1 - Math.min(1, tn[i].dot(meanN)));
	if (maxDev < 1 - Math.cos(THREE.MathUtils.degToRad(1.5))) {
		return { type: 'plane', area, centroid, normal: meanN, points: pts };
	}

	// цилиндр: нормали лежат в плоскости, перпендикулярной оси -> ось = собственный вектор
	// с наименьшим собственным числом матрицы Σ n·nᵀ
	const { values, vectors } = eigenSym3(cov);
	const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
	const total = values[0] + values[1] + values[2];
	const axis = vectors[order[0]].clone().normalize();
	if (pts.length >= 6 && values[order[0]] / total < 0.03) {
		const u = new THREE.Vector3(), v = new THREE.Vector3();
		u.crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
		v.crossVectors(axis, u).normalize();
		const o = centroid;
		const xy = pts.map((p) => { const d = p.clone().sub(o); return [d.dot(u), d.dot(v), d.dot(axis)]; });
		const circ = fitCircle(xy);
		if (circ && circ.r > 0) {
			let rms = 0;
			for (const [x, y] of xy) { const e = Math.hypot(x - circ.cx, y - circ.cy) - circ.r; rms += e * e; }
			rms = Math.sqrt(rms / xy.length);
			if (rms / circ.r < 0.01) {
				const center = o.clone().addScaledVector(u, circ.cx).addScaledVector(v, circ.cy);
				// угловой охват дуги и длина вдоль оси
				const angs = xy.map(([x, y]) => Math.atan2(y - circ.cy, x - circ.cx)).sort((a, b) => a - b);
				let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1];
				let startAngle = angs[0];
				for (let i = 1; i < angs.length; i++) {
					if (angs[i] - angs[i - 1] > gap) { gap = angs[i] - angs[i - 1]; startAngle = angs[i]; }
				}
				const sweep = 2 * Math.PI - gap;
				let zmin = Infinity, zmax = -Infinity;
				for (const p of xy) { zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); }
				// отверстие или вал: у отверстия нормали смотрят к оси
				let toward = 0;
				const radial = new THREE.Vector3();
				for (let i = 0; i < tn.length; i += 3) {
					radial.copy(tn[i + 2]).sub(center);
					radial.addScaledVector(axis, -radial.dot(axis));
					toward -= tn[i].dot(radial) * tn[i + 1];
				}
				const axisStart = center.clone().addScaledVector(axis, zmin);
				const axisEnd = center.clone().addScaledVector(axis, zmax);
				return {
					type: 'cylinder', area, centroid, axis, center: axisStart.clone().add(axisEnd).multiplyScalar(0.5),
					axisStart, axisEnd, radius: circ.r, sweep, startAngle, hole: toward > 0, rms, u, v, points: pts,
				};
			}
		}
	}
	return { type: 'other', area, centroid, normal: meanN, points: pts };
}

// OpenCascade делит полный цилиндр на две половины по шву. Находим остальные грани
// того же тела, лежащие на этом же цилиндре (все проверочные вершины на расстоянии R
// от оси), и возвращаем объединённый список треугольников.
export function mergeCoaxialFaces(mesh, tris, f) {
	const geom = mesh.geometry;
	const ud = geom.userData;
	if (f.type !== 'cylinder' || !ud.faces || !ud.faceOf) return tris;
	const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
	const c = f.center.clone().applyMatrix4(inv);
	const ax = f.axis.clone().transformDirection(inv);
	const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).x || 1;
	const r = f.radius / scale;
	const tol = Math.max(r * 2e-4, 1e-6);
	const P = geom.attributes.position.array, I = geom.index ? geom.index.array : null;
	const own = ud.faceOf[tris[0]];
	const d = new THREE.Vector3();
	const onCyl = (vi) => {
		d.set(P[vi * 3] - c.x, P[vi * 3 + 1] - c.y, P[vi * 3 + 2] - c.z);
		const along = d.dot(ax);
		d.addScaledVector(ax, -along);
		return Math.abs(d.length() - r) < tol;
	};
	const parts = [tris];
	let total = tris.length;
	ud.faces.forEach((face, fi) => {
		if (fi === own) return;
		const n = face.last - face.first + 1;
		if (n <= 0 || total + n > 2000000) return;
		// до 9 проверочных вершин, равномерно по грани
		const step = Math.max(1, Math.floor(n / 3));
		for (let tt = face.first; tt <= face.last; tt += step) {
			for (let k = 0; k < 3; k++) if (!onCyl(I ? I[tt * 3 + k] : tt * 3 + k)) return;
		}
		const out = new Uint32Array(n);
		for (let i = 0; i < n; i++) out[i] = face.first + i;
		parts.push(out);
		total += n;
	});
	if (parts.length === 1) return tris;
	const all = new Uint32Array(total);
	let o = 0;
	for (const p of parts) { all.set(p, o); o += p.length; }
	return all;
}

// окружность по точкам (метод наименьших квадратов Каса) в плоскости uv
function fitCircle(xy) {
	let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
	const n = xy.length;
	for (const [x, y] of xy) {
		const z = x * x + y * y;
		sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
	}
	// [sxx sxy sx; sxy syy sy; sx sy n] · [D E F] = -[sxz syz sz]
	const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
	const r = [-sxz, -syz, -sz];
	const s = solve3(m, r);
	if (!s) return null;
	const [D, E, F] = s;
	const cx = -D / 2, cy = -E / 2;
	const rr = cx * cx + cy * cy - F;
	return rr > 0 ? { cx, cy, r: Math.sqrt(rr) } : null;
}

function solve3(m, r) {
	const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
	const d = det(m);
	if (Math.abs(d) < 1e-300) return null;
	const out = [];
	for (let c = 0; c < 3; c++) {
		const a = m.map((row, i) => row.map((v, j) => (j === c ? r[i] : v)));
		out.push(det(a) / d);
	}
	return out;
}

// собственные значения/векторы симметричной 3×3 (метод Якоби)
function eigenSym3(c) {
	const a = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]];
	const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	for (let sweep = 0; sweep < 50; sweep++) {
		let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
		if (off < 1e-14) break;
		for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
			if (Math.abs(a[p][q]) < 1e-18) continue;
			const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
			const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
			for (let k = 0; k < 3; k++) {
				const akp = a[k][p], akq = a[k][q];
				a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq;
			}
			for (let k = 0; k < 3; k++) {
				const apk = a[p][k], aqk = a[q][k];
				a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk;
			}
			for (let k = 0; k < 3; k++) {
				const vkp = v[k][p], vkq = v[k][q];
				v[k][p] = cs * vkp - sn * vkq; v[k][q] = sn * vkp + cs * vkq;
			}
		}
	}
	return {
		values: [a[0][0], a[1][1], a[2][2]],
		vectors: [0, 1, 2].map((j) => new THREE.Vector3(v[0][j], v[1][j], v[2][j])),
	};
}

// ---------- соотношения двух граней ----------
// Возвращает { kind, value, text[] , a, b } — a/b точки для размерной линии.
export function relate(f1, f2) {
	const dir = (f) => (f.type === 'cylinder' ? f.axis : f.normal);
	const d1 = dir(f1), d2 = dir(f2);
	if (!d1 || !d2) return null;
	const cosA = Math.min(1, Math.abs(d1.dot(d2)));
	const angle = THREE.MathUtils.radToDeg(Math.acos(cosA)); // 0..90
	const PAR = 0.5; // градусов

	if (f1.type === 'plane' && f2.type === 'plane') {
		if (angle < PAR) {
			const dist = Math.abs(f2.centroid.clone().sub(f1.centroid).dot(d1));
			const a = f1.centroid.clone();
			const b = a.clone().addScaledVector(d1, f2.centroid.clone().sub(f1.centroid).dot(d1));
			return { kind: 'Расстояние между плоскостями', value: dist, unit: 'мм', a, b };
		}
		return { kind: 'Угол между плоскостями', value: angle, alt: 180 - angle, unit: '°', a: f1.centroid, b: f2.centroid };
	}
	if (f1.type === 'cylinder' && f2.type === 'cylinder') {
		if (angle < PAR) {
			const w = f2.center.clone().sub(f1.center);
			w.addScaledVector(d1, -w.dot(d1));
			const a = f1.center.clone(), b = a.clone().add(w);
			return { kind: 'Межосевое расстояние', value: w.length(), unit: 'мм', a, b };
		}
		return { kind: 'Угол между осями', value: angle, alt: 180 - angle, unit: '°', a: f1.center, b: f2.center };
	}
	// плоскость + цилиндр
	const pl = f1.type === 'plane' ? f1 : f2.type === 'plane' ? f2 : null;
	const cy = f1.type === 'cylinder' ? f1 : f2.type === 'cylinder' ? f2 : null;
	if (pl && cy) {
		const perp = Math.abs(cy.axis.dot(pl.normal)); // 0 — ось параллельна плоскости
		if (perp < Math.sin(THREE.MathUtils.degToRad(PAR))) {
			const s = cy.center.clone().sub(pl.centroid).dot(pl.normal);
			const a = cy.center.clone(), b = a.clone().addScaledVector(pl.normal, -s);
			return { kind: 'От оси до плоскости', value: Math.abs(s), unit: 'мм', a, b };
		}
		const ang = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, perp)));
		return { kind: 'Угол оси к плоскости', value: ang, alt: 90 - ang, unit: '°', a: cy.center, b: pl.centroid };
	}
	return { kind: 'Угол между гранями', value: angle, alt: 180 - angle, unit: '°', a: f1.centroid, b: f2.centroid };
}
