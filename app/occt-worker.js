// Фоновый разбор STEP / IGES / BREP через OpenCascade (WebAssembly).
importScripts('lib/occt/occt-import-js.js');

let occtPromise = null;
function getOcct() {
	if (!occtPromise) {
		occtPromise = occtimportjs({ locateFile: (p) => 'lib/occt/' + p });
	}
	return occtPromise;
}
getOcct(); // прогреваем wasm сразу при старте

onmessage = async (ev) => {
	const { id, format, buffer, params } = ev.data;
	try {
		const occt = await getOcct();
		const result = occt.ReadFile(format, new Uint8Array(buffer), params);
		if (!result || !result.success) {
			postMessage({ id, error: 'OpenCascade не смог прочитать файл' });
			return;
		}
		// Переводим массивы в typed arrays и передаём без копирования
		const transfer = [];
		for (const m of result.meshes) {
			m.attributes.position.array = new Float32Array(m.attributes.position.array);
			transfer.push(m.attributes.position.array.buffer);
			if (m.attributes.normal) {
				m.attributes.normal.array = new Float32Array(m.attributes.normal.array);
				transfer.push(m.attributes.normal.array.buffer);
			}
			if (m.index) {
				m.index.array = new Uint32Array(m.index.array);
				transfer.push(m.index.array.buffer);
			}
		}
		postMessage({ id, result }, transfer);
	} catch (e) {
		postMessage({ id, error: String(e && e.message || e) });
	}
};
