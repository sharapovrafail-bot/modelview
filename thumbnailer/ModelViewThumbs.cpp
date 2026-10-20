// ModelViewThumbs.dll — обработчик эскизов Проводника для 3D-файлов (STEP, IGES, STL, OBJ…).
//
// Проводник передаёт содержимое файла (IInitializeWithStream) и просит картинку
// нужного размера (IThumbnailProvider). Сама отрисовка делается генератором
// ModelView.exe --thumbs (лежит рядом с DLL): DLL отправляет ему файл по
// 127.0.0.1:47621 и получает PNG. Если генератор не запущен — запускает его.
//
// Регистрация — установщиком (HKCU\Software\Classes\CLSID\{...}), см. build\setup.iss.

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <wincodec.h>
#include <new>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <vector>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "windowscodecs.lib")

// {8B1C7E52-3F4A-4D6B-9C2E-5A7D0F1B3E64}
static const CLSID CLSID_ModelViewThumbs =
	{ 0x8b1c7e52, 0x3f4a, 0x4d6b, { 0x9c, 0x2e, 0x5a, 0x7d, 0x0f, 0x1b, 0x3e, 0x64 } };

static const unsigned short THUMB_PORT = 47621;
static const ULONGLONG MAX_BYTES = 300ull * 1024 * 1024;

static HMODULE g_module = nullptr;
static long g_refs = 0;

// Журнал для диагностики: %TEMP%\ModelViewThumbs.log (пишется, только если файл уже существует)
static void Log(const char* fmt, ...) {
	wchar_t path[MAX_PATH];
	if (!GetTempPathW(MAX_PATH, path)) return;
	wcscat_s(path, L"ModelViewThumbs.log");
	if (GetFileAttributesW(path) == INVALID_FILE_ATTRIBUTES) return;
	char buf[512];
	va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
	HANDLE f = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
	if (f == INVALID_HANDLE_VALUE) return;
	char line[600];
	int n = sprintf_s(line, "[%lu] %s\r\n", GetCurrentProcessId(), buf);
	DWORD w; WriteFile(f, line, n, &w, nullptr); CloseHandle(f);
}

// ---------------------------------------------------------------------------
// Связь с генератором
// ---------------------------------------------------------------------------
static SOCKET ConnectOnce() {
	SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (s == INVALID_SOCKET) return s;
	sockaddr_in a = {};
	a.sin_family = AF_INET;
	a.sin_port = htons(THUMB_PORT);
	a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	if (connect(s, reinterpret_cast<sockaddr*>(&a), sizeof(a)) != 0) {
		closesocket(s);
		return INVALID_SOCKET;
	}
	DWORD timeout = 110000; // большой STEP может считаться десятки секунд
	setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
	setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
	return s;
}

static void StartGenerator() {
	// один запуск на все потоки, пока генератор поднимается
	static volatile LONG lastStart = 0;
	LONG now = static_cast<LONG>(GetTickCount64() / 1000);
	if (now - InterlockedCompareExchange(&lastStart, 0, 0) < 10) return;
	InterlockedExchange(&lastStart, now);

	wchar_t path[MAX_PATH];
	if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return;
	PathRemoveFileSpecW(path);
	PathAppendW(path, L"ModelView.exe");
	std::wstring cmd = L"\"" + std::wstring(path) + L"\" --thumbs";
	STARTUPINFOW si = { sizeof(si) };
	PROCESS_INFORMATION pi = {};
	Log("start generator");
	if (CreateProcessW(path, &cmd[0], nullptr, nullptr, FALSE,
			CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB, nullptr, nullptr, &si, &pi) ||
		CreateProcessW(path, &cmd[0], nullptr, nullptr, FALSE,
			CREATE_NO_WINDOW | DETACHED_PROCESS, nullptr, nullptr, &si, &pi)) {
		CloseHandle(pi.hThread);
		CloseHandle(pi.hProcess);
	}
}

static SOCKET ConnectGenerator() {
	SOCKET s = ConnectOnce();
	if (s != INVALID_SOCKET) return s;
	StartGenerator();
	for (int i = 0; i < 150; i++) { // до 15 с на запуск
		Sleep(100);
		s = ConnectOnce();
		if (s != INVALID_SOCKET) return s;
	}
	return INVALID_SOCKET;
}

static bool SendAll(SOCKET s, const void* data, size_t len) {
	const char* p = static_cast<const char*>(data);
	while (len) {
		int n = send(s, p, static_cast<int>(len > (1 << 20) ? (1 << 20) : len), 0);
		if (n <= 0) return false;
		p += n; len -= n;
	}
	return true;
}

static bool RecvAll(SOCKET s, void* data, size_t len) {
	char* p = static_cast<char*>(data);
	while (len) {
		int n = recv(s, p, static_cast<int>(len > (1 << 20) ? (1 << 20) : len), 0);
		if (n <= 0) return false;
		p += n; len -= n;
	}
	return true;
}

static bool RequestPng(const std::string& ext, UINT size, const std::vector<BYTE>& file, std::vector<BYTE>& png) {
	WSADATA wsa;
	if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
	bool ok = false;
	SOCKET s = ConnectGenerator();
	if (s != INVALID_SOCKET) {
		char head[24] = { 'M', 'V', 'T', '1' };
		memcpy(head + 4, ext.c_str(), ext.size() < 8 ? ext.size() : 8);
		UINT32 sz = size;
		UINT64 len = file.size();
		memcpy(head + 12, &sz, 4);
		memcpy(head + 16, &len, 8);
		UINT32 outLen = 0;
		if (SendAll(s, head, sizeof(head)) && SendAll(s, file.data(), file.size()) &&
			RecvAll(s, &outLen, 4) && outLen > 0 && outLen < 64u * 1024 * 1024) {
			png.resize(outLen);
			ok = RecvAll(s, png.data(), outLen);
		}
		closesocket(s);
	}
	WSACleanup();
	return ok;
}

// PNG -> 32-битный HBITMAP с альфа-каналом
static HRESULT PngToBitmap(const std::vector<BYTE>& png, HBITMAP* out) {
	IWICImagingFactory* factory = nullptr;
	HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory));
	if (FAILED(hr)) return hr;
	IStream* mem = SHCreateMemStream(png.data(), static_cast<UINT>(png.size()));
	IWICBitmapDecoder* dec = nullptr;
	IWICBitmapFrameDecode* frame = nullptr;
	IWICBitmapSource* conv = nullptr;
	hr = mem ? factory->CreateDecoderFromStream(mem, nullptr, WICDecodeMetadataCacheOnDemand, &dec) : E_OUTOFMEMORY;
	if (SUCCEEDED(hr)) hr = dec->GetFrame(0, &frame);
	if (SUCCEEDED(hr)) hr = WICConvertBitmapSource(GUID_WICPixelFormat32bppBGRA, frame, &conv);
	UINT w = 0, h = 0;
	if (SUCCEEDED(hr)) hr = conv->GetSize(&w, &h);
	if (SUCCEEDED(hr)) {
		BITMAPINFO bmi = {};
		bmi.bmiHeader.biSize = sizeof(bmi.bmiHeader);
		bmi.bmiHeader.biWidth = static_cast<LONG>(w);
		bmi.bmiHeader.biHeight = -static_cast<LONG>(h); // сверху вниз
		bmi.bmiHeader.biPlanes = 1;
		bmi.bmiHeader.biBitCount = 32;
		bmi.bmiHeader.biCompression = BI_RGB;
		void* bits = nullptr;
		HBITMAP bmp = CreateDIBSection(nullptr, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
		hr = bmp ? conv->CopyPixels(nullptr, w * 4, w * h * 4, static_cast<BYTE*>(bits)) : E_OUTOFMEMORY;
		if (SUCCEEDED(hr)) *out = bmp;
		else if (bmp) DeleteObject(bmp);
	}
	if (conv) conv->Release();
	if (frame) frame->Release();
	if (dec) dec->Release();
	if (mem) mem->Release();
	factory->Release();
	return hr;
}

// ---------------------------------------------------------------------------
// COM-объект обработчика
// ---------------------------------------------------------------------------
class ThumbProvider : public IInitializeWithStream, public IThumbnailProvider {
	long refs_ = 1;
	IStream* stream_ = nullptr;
public:
	ThumbProvider() { InterlockedIncrement(&g_refs); }
	virtual ~ThumbProvider() {
		if (stream_) stream_->Release();
		InterlockedDecrement(&g_refs);
	}

	IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
		static const QITAB qit[] = {
			QITABENT(ThumbProvider, IInitializeWithStream),
			QITABENT(ThumbProvider, IThumbnailProvider),
			{ nullptr, 0 },
		};
		return QISearch(this, qit, riid, ppv);
	}
	IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&refs_); }
	IFACEMETHODIMP_(ULONG) Release() {
		long r = InterlockedDecrement(&refs_);
		if (!r) delete this;
		return r;
	}

	IFACEMETHODIMP Initialize(IStream* stream, DWORD) {
		if (stream_) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
		stream_ = stream;
		stream_->AddRef();
		return S_OK;
	}

	IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP* phbmp, WTS_ALPHATYPE* alpha) {
		Log("GetThumbnail cx=%u", cx);
		if (!stream_ || !phbmp) return E_UNEXPECTED;
		*phbmp = nullptr;

		// расширение — из имени файла в потоке
		STATSTG st = {};
		if (FAILED(stream_->Stat(&st, STATFLAG_DEFAULT))) return E_FAIL;
		std::string ext;
		if (st.pwcsName) {
			const wchar_t* dot = PathFindExtensionW(st.pwcsName);
			for (const wchar_t* c = dot && *dot ? dot + 1 : L""; *c && ext.size() < 8; c++)
				ext += static_cast<char>(*c < 128 ? towlower(*c) : '_');
			CoTaskMemFree(st.pwcsName);
		}
		Log("ext=%s size=%llu", ext.c_str(), st.cbSize.QuadPart);
		if (ext.empty() || st.cbSize.QuadPart == 0 || st.cbSize.QuadPart > MAX_BYTES) return E_FAIL;

		// читаем файл целиком
		std::vector<BYTE> file;
		try { file.resize(static_cast<size_t>(st.cbSize.QuadPart)); }
		catch (...) { return E_OUTOFMEMORY; }
		LARGE_INTEGER zero = {};
		stream_->Seek(zero, STREAM_SEEK_SET, nullptr);
		size_t got = 0;
		while (got < file.size()) {
			ULONG n = 0;
			HRESULT hr = stream_->Read(file.data() + got, static_cast<ULONG>(file.size() - got > (1u << 20) ? (1u << 20) : file.size() - got), &n);
			if (FAILED(hr) || n == 0) break;
			got += n;
		}
		if (got != file.size()) return E_FAIL;

		std::vector<BYTE> png;
		if (!RequestPng(ext, cx, file, png)) { Log("RequestPng failed"); return E_FAIL; }
		HRESULT hr = PngToBitmap(png, phbmp);
		Log("done hr=0x%08X png=%zu", hr, png.size());
		if (SUCCEEDED(hr) && alpha) *alpha = WTSAT_ARGB;
		return hr;
	}
};

class Factory : public IClassFactory {
	long refs_ = 1;
public:
	IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
		static const QITAB qit[] = { QITABENT(Factory, IClassFactory), { nullptr, 0 } };
		return QISearch(this, qit, riid, ppv);
	}
	IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&refs_); }
	IFACEMETHODIMP_(ULONG) Release() {
		long r = InterlockedDecrement(&refs_);
		if (!r) delete this;
		return r;
	}
	IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) {
		*ppv = nullptr;
		if (outer) return CLASS_E_NOAGGREGATION;
		ThumbProvider* p = new (std::nothrow) ThumbProvider();
		if (!p) return E_OUTOFMEMORY;
		HRESULT hr = p->QueryInterface(riid, ppv);
		p->Release();
		return hr;
	}
	IFACEMETHODIMP LockServer(BOOL lock) {
		lock ? InterlockedIncrement(&g_refs) : InterlockedDecrement(&g_refs);
		return S_OK;
	}
};

// ---------------------------------------------------------------------------
// Экспорт DLL
// ---------------------------------------------------------------------------
BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
	if (reason == DLL_PROCESS_ATTACH) {
		g_module = module;
		DisableThreadLibraryCalls(module);
	}
	return TRUE;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
	*ppv = nullptr;
	Log("DllGetClassObject");
	if (clsid != CLSID_ModelViewThumbs) return CLASS_E_CLASSNOTAVAILABLE;
	Factory* f = new (std::nothrow) Factory();
	if (!f) return E_OUTOFMEMORY;
	HRESULT hr = f->QueryInterface(riid, ppv);
	f->Release();
	return hr;
}

STDAPI DllCanUnloadNow() { return g_refs == 0 ? S_OK : S_FALSE; }
