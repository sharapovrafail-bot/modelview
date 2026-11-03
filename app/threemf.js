// Загрузчик 3MF для RafCAD View.
// Встроенный ThreeMFLoader из three.js не понимает «производственное» расширение 3MF:
// Bambu Studio, Orca Slicer, PrusaSlicer 2.6+ кладут сетки деталей в отдельные файлы
// (3D/Objects/object_1.model), а главный 3D/3dmodel.model лишь ссылается на них через p:path.
// Здесь читаются все *.model архива, компоненты со ссылками на другие файлы, трансформации
// компонентов и элементов <build>, цвета из basematerials / colorgroup.
import * as THREE from 'three';
import * as fflate from 'three/addons/libs/fflate.module.js';

// цвет «без цвета» — тот же серый, что в RafCAD View для STL (в реалистичном режиме — сталь)
const NO_COLOR = new THREE.Color().setRGB(0.74, 0.76, 0.8, THREE.SRGBColorSpace);
const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

export function parse3mf(buffer) {
	let zip;
	try { zip = fflate.unzipSync(new Uint8Array(buffer)); }
	catch (e) { throw new Error('Файл 3MF повреждён (это не ZIP-архив)'); }
	const norm = (p) => '/' + String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
	const files = {};
	for (const name of Object.keys(zip)) files[norm(name).toLowerCase()] = { name: norm(name), data: zip[name] };
	const text = (path) => { const f = files[norm(path).toLowerCase()]; return f ? new TextDecoder().decode(f.data) : null; };

	// главный файл модели — из _rels/.rels, иначе 3D/3dmodel.model, иначе любой *.model
	let root = null;
	const rels = text('/_rels/.rels');
	if (rels) {
		const m = /Target="([^"]+\.model)"[^>]*Type="[^"]*3dmodel"|Type="[^"]*3dmodel"[^>]*Target="([^"]+\.model)"/i.exec(rels);
		if (m) root = norm(m[1] || m[2]);
	}
	if (!root || !text(root)) root = text('/3D/3dmodel.model') ? '/3D/3dmodel.model' : null;
	if (!root) {
		const any = Object.values(files).find((f) => /\.model$/i.test(f.name));
		if (!any) throw new Error('В архиве 3MF нет файла модели (*.model)');
		root = any.name;
	}

	const models = new Map(); // путь -> { doc, objects: Map(id -> element), unit, materials }
	function loadModel(path) {
		const key = norm(path).toLowerCase();
		if (models.has(key)) return models.get(key);
		const xml = text(path);
		if (xml == null) { models.set(key, null); return null; }
		const doc = new DOMParser().parseFromString(xml, 'application/xml');
		if (doc.getElementsByTagName('parsererror').length) throw new Error('Ошибка XML в ' + path);
		const modelEl = doc.documentElement;
		const objects = new Map();
		const materials = new Map(); // id -> [THREE.Color]
		for (const el of byTag(modelEl, 'object')) objects.set(el.getAttribute('id'), el);
		for (const el of byTag(modelEl, 'basematerials')) {
			materials.set(el.getAttribute('id'), byTag(el, 'base').map((b) => parseColor(b.getAttribute('displaycolor'))));
		}
		for (const el of byTag(modelEl, 'colorgroup')) {
			materials.set(el.getAttribute('id'), byTag(el, 'color').map((c) => parseColor(c.getAttribute('color'))));
		}
		const m = { path: norm(path), modelEl, objects, materials, unit: UNIT_MM[modelEl.getAttribute('unit') || 'millimeter'] || 1 };
		models.set(key, m);
		return m;
	}

	const geomCache = new Map(); // путь|id -> { geometry, color } (одна сетка на объект, клоны делят геометрию)
	function meshOf(model, el) {
		const key = model.path + '|' + el.getAttribute('id');
		if (geomCache.has(key)) return geomCache.get(key);
		const meshEl = byTag(el, 'mesh')[0];
		const vEl = byTag(meshEl, 'vertices')[0], tEl = byTag(meshEl, 'triangles')[0];
		const vs = vEl ? byTag(vEl, 'vertex') : [];
		const ts = tEl ? byTag(tEl, 'triangle') : [];
		const pos = new Float32Array(vs.length * 3);
		for (let i = 0; i < vs.length; i++) {
			pos[i * 3] = +vs[i].getAttribute('x'); pos[i * 3 + 1] = +vs[i].getAttribute('y'); pos[i * 3 + 2] = +vs[i].getAttribute('z');
		}
		const idx = new Uint32Array(ts.length * 3);
		const objPid = el.getAttribute('pid'), objP = el.getAttribute('pindex');
		let colors = null, triColors = false;
		for (let i = 0; i < ts.length; i++) {
			const t = ts[i];
			idx[i * 3] = +t.getAttribute('v1'); idx[i * 3 + 1] = +t.getAttribute('v2'); idx[i * 3 + 2] = +t.getAttribute('v3');
			if (t.hasAttribute('pid') || t.hasAttribute('p1')) triColors = true;
		}
		const objColor = colorFrom(model, objPid, objP);
		let geometry;
		if (triColors) {
			// цвет по треугольникам: развернуть сетку, цвет в вершинах
			const P = new Float32Array(ts.length * 9);
			colors = new Float32Array(ts.length * 9);
			const base = objColor || NO_COLOR;
			for (let i = 0; i < ts.length; i++) {
				const t = ts[i];
				const pid = t.getAttribute('pid') || objPid;
				const p1 = t.getAttribute('p1'), p2 = t.getAttribute('p2') || p1, p3 = t.getAttribute('p3') || p1;
				const cs = [p1, p2, p3].map((p) => (p != null ? colorFrom(model, pid, p) : null) || base);
				for (let k = 0; k < 3; k++) {
					const v = idx[i * 3 + k] * 3;
					P.set([pos[v], pos[v + 1], pos[v + 2]], i * 9 + k * 3);
					colors.set([cs[k].r, cs[k].g, cs[k].b], i * 9 + k * 3);
				}
			}
			geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
			geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		} else {
			geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
			geometry.setIndex(new THREE.BufferAttribute(idx, 1));
		}
		geometry.computeVertexNormals();
		const r = { geometry, color: triColors ? null : objColor };
		geomCache.set(key, r);
		return r;
	}

	function buildObject(model, id, depth) {
		if (depth > 16) return null;
		const el = model && model.objects.get(id);
		if (!el) return null;
		const name = el.getAttribute('name') || '';
		if (byTag(el, 'mesh').length) {
			const { geometry, color } = meshOf(model, el);
			const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: color || NO_COLOR, vertexColors: !!geometry.attributes.color }));
			mesh.name = name || 'Тело';
			return mesh;
		}
		const comps = byTag(el, 'components')[0];
		if (!comps) return null;
		const group = new THREE.Group();
		group.name = name || 'Сборка';
		for (const c of byTag(comps, 'component')) {
			const path = c.getAttributeNS(NS_PROD, 'path') || c.getAttribute('p:path');
			const target = path ? loadModel(path) : model;
			const child = buildObject(target, c.getAttribute('objectid'), depth + 1);
			if (!child) continue;
			applyTransform(child, c.getAttribute('transform'));
			if (target && target.unit !== model.unit) child.scale.multiplyScalar(target.unit / model.unit);
			group.add(child);
		}
		return group.children.length ? group : null;
	}

	const main = loadModel(root);
	if (!main) throw new Error('Не найден файл модели ' + root);
	const scene = new THREE.Group();
	scene.name = 'Модель 3MF';
	const buildEl = byTag(main.modelEl, 'build')[0];
	const items = buildEl ? byTag(buildEl, 'item') : [];
	if (items.length) {
		for (const it of items) {
			if (it.getAttribute('printable') === '0') continue;
			const path = it.getAttributeNS(NS_PROD, 'path') || it.getAttribute('p:path');
			const model = path ? loadModel(path) : main;
			const obj = buildObject(model, it.getAttribute('objectid'), 0);
			if (!obj) continue;
			applyTransform(obj, it.getAttribute('transform'));
			scene.add(obj);
		}
	} else {
		// нет <build> — показываем все объекты, на которые никто не ссылается
		const used = new Set();
		for (const el of main.objects.values()) for (const c of byTag(el, 'component')) used.add(c.getAttribute('objectid'));
		for (const id of main.objects.keys()) if (!used.has(id)) { const o = buildObject(main, id, 0); if (o) scene.add(o); }
	}
	if (!scene.children.length) throw new Error('В файле 3MF не найдено ни одной детали с сеткой');
	if (main.unit !== 1) scene.scale.setScalar(main.unit);
	return scene;
}

function byTag(el, name) {
	if (!el) return [];
	// без учёта префикса пространства имён
	return [...el.getElementsByTagNameNS('*', name)];
}
function applyTransform(obj, t) {
	if (!t) return;
	const v = t.trim().split(/\s+/).map(Number);
	if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return;
	const m = new THREE.Matrix4().set(
		v[0], v[3], v[6], v[9],
		v[1], v[4], v[7], v[10],
		v[2], v[5], v[8], v[11],
		0, 0, 0, 1);
	obj.applyMatrix4(m);
}
function parseColor(s) {
	if (!s) return null;
	const m = /^#?([0-9a-f]{6})/i.exec(s.trim());
	return m ? new THREE.Color().setRGB(
		parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255, THREE.SRGBColorSpace) : null;
}
function colorFrom(model, pid, pindex) {
	if (pid == null) return null;
	const list = model.materials.get(pid);
	if (!list) return null;
	return list[+(pindex || 0)] || null;
}
