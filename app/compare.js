// Сравнение двух ревизий детали.
// На входе — «суп» треугольников обеих моделей (по 9 чисел на треугольник) в общей
// системе координат модели. Для каждой вершины A ищется расстояние до поверхности B
// (и наоборот) через равномерную сетку ячеек. Итог: цвета вершин A (совпадает /
// отклонение / только в A) и треугольники B, которых нет в A (добавленный материал).
import * as THREE from 'three';

const tri = new THREE.Triangle();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Vector3();

function buildGrid(soup, cell) {
	const grid = new Map();
	const inv = 1 / cell;
	const n = soup.length / 9;
	for (let t = 0; t < n; t++) {
		const o = t * 9;
		let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
		for (let k = 0; k < 9; k += 3) {
			const x = soup[o + k], y = soup[o + k + 1], z = soup[o + k + 2];
			if (x < x0) x0 = x; if (x > x1) x1 = x;
			if (y < y0) y0 = y; if (y > y1) y1 = y;
			if (z < z0) z0 = z; if (z > z1) z1 = z;
		}
		const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
		const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
		const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
		for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) {
			const key = ix + ',' + iy + ',' + iz;
			let list = grid.get(key);
			if (!list) { list = []; grid.set(key, list); }
			list.push(t);
		}
	}
	return grid;
}

// расстояние от точки до ближайшего треугольника (не дальше maxDist; иначе Infinity)
function nearest(grid, soup, cell, x, y, z, maxDist, stamp, seen) {
	const inv = 1 / cell;
	const r = Math.ceil(maxDist * inv);
	const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
	let best = maxDist * maxDist;
	let found = false;
	tmpP.set(x, y, z);
	for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) for (let iz = cz - r; iz <= cz + r; iz++) {
		const list = grid.get(ix + ',' + iy + ',' + iz);
		if (!list) continue;
		for (const t of list) {
			if (seen[t] === stamp) continue;
			seen[t] = stamp;
			const o = t * 9;
			tri.a.set(soup[o], soup[o + 1], soup[o + 2]);
			tri.b.set(soup[o + 3], soup[o + 4], soup[o + 5]);
			tri.c.set(soup[o + 6], soup[o + 7], soup[o + 8]);
			tri.closestPointToPoint(tmpP, tmpQ);
			const d = tmpQ.distanceToSquared(tmpP);
			if (d <= best) { best = d; found = true; }
		}
	}
	return found ? Math.sqrt(best) : Infinity;
}

function triArea(s, o) {
	const ux = s[o + 3] - s[o], uy = s[o + 4] - s[o + 1], uz = s[o + 5] - s[o + 2];
	const wx = s[o + 6] - s[o], wy = s[o + 7] - s[o + 1], wz = s[o + 8] - s[o + 2];
	const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
	return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

// Расстояния от вершин `from` до поверхности `to`. Повторяющиеся вершины считаются один раз.
async function distances(from, to, tol, maxDist, onProgress, label) {
	const box = new THREE.Box3();
	for (let i = 0; i < to.length; i += 3) box.expandByPoint(tmpP.set(to[i], to[i + 1], to[i + 2]));
	const size = box.getSize(new THREE.Vector3());
	const cell = Math.max(maxDist, Math.max(size.x, size.y, size.z) / 150, 1e-6);
	const grid = buildGrid(to, cell);
	const seen = new Uint32Array(to.length / 9);
	const out = new Float32Array(from.length / 3);
	const memo = new Map();
	const q = Math.max(tol * 0.01, 1e-7);
	let stamp = 0;
	const n = from.length / 3;
	for (let v = 0; v < n; v++) {
		const x = from[v * 3], y = from[v * 3 + 1], z = from[v * 3 + 2];
		const key = Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q);
		let d = memo.get(key);
		if (d === undefined) {
			stamp++;
			if (stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
			d = nearest(grid, to, cell, x, y, z, maxDist, stamp, seen);
			memo.set(key, d);
		}
		out[v] = d;
		if ((v & 16383) === 0) { onProgress && onProgress(label, v / n); await new Promise((r) => setTimeout(r, 0)); }
	}
	return out;
}

const COL_SAME = new THREE.Color(0xb9c1cc);
const COL_WARN = new THREE.Color(0xffc23d);
const COL_FAR = new THREE.Color(0xff3b3b);

export async function compareSoups(soupA, soupB, tol, onProgress) {
	const maxDist = tol * 10;
	const dA = await distances(soupA, soupB, tol, maxDist, onProgress, 'A');
	const dB = await distances(soupB, soupA, tol, maxDist, onProgress, 'B');

	// цвета A: серый — совпадает, жёлтый→красный — отклонение, красный — нет в B
	const colors = new Float32Array(soupA.length);
	const c = new THREE.Color();
	let maxDev = 0, missing = false;
	for (let v = 0; v < dA.length; v++) {
		const d = dA[v];
		if (d <= tol) c.copy(COL_SAME);
		else if (d === Infinity) { c.copy(COL_FAR); missing = true; }
		else { const t = Math.min(1, (d - tol) / (maxDist - tol)); c.copy(COL_WARN).lerp(COL_FAR, t); }
		if (d !== Infinity && d > maxDev) maxDev = d;
		colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
	}

	// площади: изменённая часть A и добавленная часть B
	let areaA = 0, areaRemoved = 0, areaB = 0, areaAdded = 0;
	for (let t = 0; t < dA.length / 3; t++) {
		const s = triArea(soupA, t * 9);
		areaA += s;
		if (Math.max(dA[t * 3], dA[t * 3 + 1], dA[t * 3 + 2]) > tol) areaRemoved += s;
	}
	const added = [];
	for (let t = 0; t < dB.length / 3; t++) {
		const s = triArea(soupB, t * 9);
		areaB += s;
		if (Math.min(dB[t * 3], dB[t * 3 + 1], dB[t * 3 + 2]) > tol || Math.max(dB[t * 3], dB[t * 3 + 1], dB[t * 3 + 2]) > tol * 3) {
			areaAdded += s;
			for (let k = 0; k < 9; k++) added.push(soupB[t * 9 + k]);
		}
	}
	return { colors, added: new Float32Array(added), areaA, areaRemoved, areaB, areaAdded, maxDev, missing, tol };
}
