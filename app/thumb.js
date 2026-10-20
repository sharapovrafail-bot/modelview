// Генератор эскизов для Проводника Windows.
// Python (modelview.py --thumbs) вызывает window.renderThumb(id, ext, size);
// данные файла забираются с встроенного сервера по api/job/<id>, результат — PNG в base64.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const OCCT = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', brep: 'brep', brp: 'brep' };
const DEFAULT_COLOR = new THREE.Color().setRGB(0.74, 0.76, 0.8, THREE.SRGBColorSpace);
// почти чёрный серый цвет из CAD (часто «цвет по умолчанию» в IGES) показываем сталью
const isDarkGrey = (c) => { const h = c.getHSL({}); return h.s < 0.15 && h.l < 0.3; };
const EDGE_LIMIT = 400000; // треугольников — у моделей крупнее рёбра не строим

const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ---------- OpenCascade в воркере ----------
const worker = new Worker('occt-worker.js');
let jobSeq = 0;
const pending = new Map();
worker.onmessage = (ev) => {
	const p = pending.get(ev.data.id);
	if (!p) return;
	pending.delete(ev.data.id);
	ev.data.error ? p.reject(new Error(ev.data.error)) : p.resolve(ev.data.result);
};
function occtParse(format, buffer) {
	return new Promise((resolve, reject) => {
		const id = ++jobSeq;
		pending.set(id, { resolve, reject });
		worker.postMessage({ id, format, buffer, params: {
			linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio',
			linearDeflection: 0.003, angularDeflection: 0.8,
		} }, [buffer]);
	});
}

function material(color, vertexColors) {
	const hsl = color.getHSL({});
	const metal = hsl.s < 0.15;
	// почти чёрный «бесцветный» цвет из CAD превратил бы сталь в чёрное пятно
	if (metal && !vertexColors && hsl.l < 0.3) color = DEFAULT_COLOR;
	return new THREE.MeshStandardMaterial({
		color: metal ? (vertexColors ? new THREE.Color(0xb4b9c0) : color.clone().multiplyScalar(0.8)) : (vertexColors ? new THREE.Color(0xffffff) : color),
		vertexColors, side: THREE.DoubleSide,
		metalness: metal ? 0.92 : 0.2, roughness: metal ? 0.26 : 0.45, envMapIntensity: metal ? 1.3 : 0.75,
		polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
	});
}

function occtToGroup(res) {
	const root = new THREE.Group();
	const meshes = res.meshes.map((m) => {
		const g = new THREE.BufferGeometry();
		const pos = m.attributes.position.array;
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		if (m.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.attributes.normal.array, 3));
		const idx = m.index ? m.index.array : null;
		if (idx) g.setIndex(new THREE.BufferAttribute(idx, 1));
		if (!m.attributes.normal) g.computeVertexNormals();
		let base = m.color ? new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace) : DEFAULT_COLOR;
		if (isDarkGrey(base)) base = DEFAULT_COLOR;
		let vc = false;
		if (idx && m.brep_faces && m.brep_faces.some((f) => f.color)) {
			vc = true;
			const col = new Float32Array(pos.length);
			for (let k = 0; k < col.length; k += 3) { col[k] = base.r; col[k + 1] = base.g; col[k + 2] = base.b; }
			const c = new THREE.Color();
			for (const f of m.brep_faces) {
				if (!f.color) continue;
				c.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
				if (isDarkGrey(c)) c.copy(DEFAULT_COLOR); // чёрная «бесцветная» грань -> сталь
				for (let t = f.first; t <= f.last; t++) for (let j = 0; j < 3; j++) {
					const v = idx[t * 3 + j] * 3;
					col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
				}
			}
			g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		}
		return new THREE.Mesh(g, material(base, vc));
	});
	const build = (node, grp) => {
		for (const mi of node.meshes || []) { const s = meshes[mi]; grp.add(s.parent ? s.clone() : s); }
		for (const ch of node.children || []) { const sub = new THREE.Group(); grp.add(sub); build(ch, sub); }
	};
	build(res.root, root);
	return root;
}

function restyle(obj) {
	obj.traverse((o) => {
		if (!o.isMesh) return;
		const g = o.geometry;
		if (!g.attributes.normal) g.computeVertexNormals();
		const src = Array.isArray(o.material) ? o.material[0] : o.material;
		const vc = !!g.attributes.color;
		const color = src && src.color && !vc ? src.color.clone() : DEFAULT_COLOR.clone();
		o.material = material(color, vc);
	});
	return obj;
}

async function parse(ext, buffer) {
	if (OCCT[ext]) return { obj: occtToGroup(await occtParse(OCCT[ext], buffer)), yUp: false };
	switch (ext) {
		case 'stl': return { obj: restyle(new THREE.Mesh(new STLLoader().parse(buffer))), yUp: false };
		case 'ply': return { obj: restyle(new THREE.Mesh(new PLYLoader().parse(buffer))), yUp: false };
		case 'obj': return { obj: restyle(new OBJLoader().parse(new TextDecoder().decode(buffer))), yUp: true };
		case '3mf': return { obj: restyle(new ThreeMFLoader().parse(buffer)), yUp: false };
		case 'glb': case 'gltf': {
			const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buffer, '', res, rej));
			return { obj: restyle(gltf.scene), yUp: true };
		}
	}
	throw new Error('формат не поддерживается: ' + ext);
}

function dispose(obj) {
	obj.traverse((o) => {
		if (o.geometry) o.geometry.dispose();
		if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
	});
}

async function renderThumb(id, ext, size) {
	const buffer = await (await fetch('api/job/' + id)).arrayBuffer();
	const { obj, yUp } = await parse(ext, buffer);
	const scene = new THREE.Scene();
	scene.environment = envMap;
	const root = new THREE.Group();
	if (yUp) root.rotation.x = Math.PI / 2;
	root.add(obj);
	scene.add(root);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x404650, 0.5));
	root.updateMatrixWorld(true);

	let tris = 0;
	obj.traverse((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
	if (tris <= EDGE_LIMIT) {
		const em = new THREE.LineBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.45 });
		const ms = [];
		obj.traverse((o) => { if (o.isMesh) ms.push(o); });
		for (const m of ms) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), em));
	}

	const box = new THREE.Box3().setFromObject(root);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const r = Math.max(sphere.radius, 1e-6);
	const cam = new THREE.PerspectiveCamera(30, 1, r * 0.01, r * 20);
	cam.up.set(0, 0, 1);
	const dir = new THREE.Vector3(1, -1.15, 0.75).normalize();
	cam.position.copy(sphere.center).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.98);
	cam.lookAt(sphere.center);
	const key = new THREE.DirectionalLight(0xffffff, 1.2);
	key.position.copy(cam.position).add(new THREE.Vector3(0, 0, r * 2));
	scene.add(key);

	size = Math.max(32, Math.min(1024, size | 0));
	renderer.setPixelRatio(1);
	renderer.setSize(size, size, false);
	renderer.render(scene, cam);
	const url = canvas.toDataURL('image/png');
	dispose(root);
	return url.slice(url.indexOf(',') + 1);
}

window.renderThumb = (id, ext, size) => renderThumb(id, ext, size).catch((e) => 'ERROR:' + (e && e.message || e));
window.thumbReady = true;
