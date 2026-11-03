# Сборка RafCAD View.app для macOS (на GitHub Actions: macos-latest — Apple M, macos-13 — Intel)
import os, json
ROOT = os.path.abspath(os.path.join(SPECPATH, '..'))
VER = json.load(open(os.path.join(ROOT, 'app', 'version.json'), encoding='utf-8'))['version']
EXTS = ['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'stl', 'obj', 'ply', '3mf', 'glb', 'gltf', 'dxf', 'dwg']

a = Analysis([os.path.join(SPECPATH, 'rafcad_mac.py')], pathex=[ROOT],
             datas=[(os.path.join(ROOT, 'app'), 'app'), (os.path.join(ROOT, 'server.py'), '.')],
             hiddenimports=['server', 'webview.platforms.cocoa'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='RafCADView', console=False, argv_emulation=True)
coll = COLLECT(exe, a.binaries, a.datas, name='RafCADView')
app = BUNDLE(coll, name='RafCAD View.app', icon=os.path.join(SPECPATH, 'rafcad.icns'),
             bundle_identifier='ru.sharapov.rafcadview',
             info_plist={
                 'NSHumanReadableCopyright': '© 2026 Рафаил Шарапов · rafail@sharapov-cnc.ru',
                 'CFBundleName': 'RafCAD View', 'CFBundleDisplayName': 'RafCAD View',
                 'CFBundleShortVersionString': VER, 'CFBundleVersion': VER,
                 'LSMinimumSystemVersion': '11.0', 'NSHighResolutionCapable': True,
                 'CFBundleDocumentTypes': [{
                     'CFBundleTypeName': '3D-модель / чертёж', 'CFBundleTypeRole': 'Viewer',
                     'LSHandlerRank': 'Alternate', 'CFBundleTypeExtensions': EXTS,
                 }],
             })
