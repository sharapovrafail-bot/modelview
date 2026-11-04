import CryptoKit
import Darwin
import Foundation
import SwiftUI

/// Участник сети RafChat — тот же протокол, что у ПК и Android:
///  UDP 47800 — маяк «я здесь» {"d": json, "s": HMAC}, TCP 47801 — POST /msg, GET /file?fid=, GET /ping.
///  Каждый запрос подписан: X-Auth: <время>:<HMAC-SHA256(ключ, "время:метод:путь:" + sha256hex(тело))>.
/// iPhone работает, пока приложение открыто; недоставленное ждёт у отправителей и приходит при открытии.
final class Node: ObservableObject {
    static let shared = Node()
    static let udpPort: UInt16 = 47800
    static let tcpPort: UInt16 = 47801
    static let all = "all"
    static let onlineSec = 15.0
    static let autoDownload: Int64 = 50 * 1024 * 1024

    @Published var peers: [Peer] = []
    @Published var messages: [Msg] = []
    @Published var progress: [String: (Int64, Int64)] = [:]
    @Published var running = false
    @Published var tick = 0
    var visibleChat: String?

    private let store = Store()
    private var outbox: [OutItem] = []
    private var files: [String: String] = [:]           // fid → путь к своему файлу
    private var key = SymmetricKey(size: .bits256)
    private var udpFd: Int32 = -1
    private var tcpFd: Int32 = -1
    private var gen = 0
    private var downloading = Set<String>()
    let id = Profile.id

    private init() {
        peers = store.load("peers.json", [Peer].self) ?? []
        messages = store.load("messages.json", [Msg].self) ?? []
        outbox = store.load("outbox.json", [OutItem].self) ?? []
        files = store.load("files.json", [String: String].self) ?? [:]
    }

    // MARK: запуск / остановка (iOS усыпляет свёрнутое приложение — перезапускаемся при открытии)

    func start() {
        guard Profile.isSetUp, !running else { return }
        key = SymmetricKey(data: SHA256.hash(data: Data(("RafChat:" + Profile.org.trimmingCharacters(in: .whitespaces)).utf8)))
        udpFd = Sock.udp(port: Node.udpPort)
        tcpFd = Sock.tcpServer(port: Node.tcpPort)
        guard udpFd >= 0, tcpFd >= 0 else { stopSockets(); return }
        running = true
        gen += 1
        let g = gen
        let u = udpFd, t = tcpFd
        Thread.detachNewThread { [weak self] in self?.udpLoop(u, g) }
        Thread.detachNewThread { [weak self] in self?.acceptLoop(t, g) }
        Thread.detachNewThread { [weak self] in self?.beaconLoop(g) }
        Thread.detachNewThread { [weak self] in self?.outboxLoop(g) }
        Thread.detachNewThread { [weak self] in self?.pingLoop(g) }
    }

    func stop() {
        guard running else { return }
        beacon(bye: true)
        running = false
        gen += 1
        stopSockets()
    }

    private func stopSockets() {
        if udpFd >= 0 { close(udpFd); udpFd = -1 }
        if tcpFd >= 0 { shutdown(tcpFd, SHUT_RDWR); close(tcpFd); tcpFd = -1 }
    }

    func restart() { stop(); start() }

    // MARK: подписи

    private static func hex(_ d: some Sequence<UInt8>) -> String { d.map { String(format: "%02x", $0) }.joined() }

    func sign(_ data: Data) -> String { Node.hex(HMAC<SHA256>.authenticationCode(for: data, using: key)) }

    private func authData(_ ts: String, _ method: String, _ path: String, _ body: Data) -> Data {
        Data("\(ts):\(method):\(path):".utf8) + Data(Node.hex(SHA256.hash(data: body)).utf8)
    }

    func authHeader(_ method: String, _ path: String, _ body: Data = Data()) -> String {
        let ts = String(Int(Date().timeIntervalSince1970))
        return ts + ":" + sign(authData(ts, method, path, body))
    }

    private func checkAuth(_ h: String?, _ method: String, _ path: String, _ body: Data) -> Bool {
        guard let h = h, let i = h.firstIndex(of: ":") else { return false }
        let ts = String(h[..<i])
        guard let t = Double(ts), abs(Date().timeIntervalSince1970 - t) < 86400 else { return false }
        return String(h[h.index(after: i)...]) == sign(authData(ts, method, path, body))
    }

    // MARK: маяк

    private func beaconData(ask: Bool, bye: Bool) -> Data? {
        let d: [String: Any] = ["app": "RafChat", "v": 1, "id": id, "name": Profile.name, "dept": Profile.dept,
                                "port": Int(Node.tcpPort), "plat": "ios", "ask": ask, "bye": bye]
        guard let rawData = try? JSONSerialization.data(withJSONObject: d),
              let raw = String(data: rawData, encoding: .utf8) else { return nil }
        let env: [String: Any] = ["d": raw, "s": sign(Data(raw.utf8))]
        return try? JSONSerialization.data(withJSONObject: env)
    }

    private func knownTargets() -> [(String, UInt16)] {
        var out: [(String, UInt16)] = []
        for part in Profile.extra.split(whereSeparator: { ",; ".contains($0) }) {
            let a = String(part)
            let host = String(a.split(separator: ":").first ?? "")
            let port = a.split(separator: ":").count > 1 ? UInt16(a.split(separator: ":")[1]) ?? Node.udpPort : Node.udpPort
            if !host.isEmpty { out.append((host, port)) }
        }
        let ips = Thread.isMainThread ? peers.map { $0.ip } : DispatchQueue.main.sync { peers.map { $0.ip } }
        for ip in ips where !ip.isEmpty { out.append((ip, Node.udpPort)) }
        return out
    }

    func beacon(ask: Bool = false, bye: Bool = false, to: (String, UInt16)? = nil, scan: Bool = false) {
        guard udpFd >= 0, let data = beaconData(ask: ask, bye: bye) else { return }
        if let to = to { Sock.sendTo(udpFd, data, to.0, to.1); return }
        var targets = knownTargets()
        if scan { targets += Sock.neighbours().map { ($0, Node.udpPort) } }
        for (ip, port) in targets { Sock.sendTo(udpFd, data, ip, port) }
    }

    private func beaconLoop(_ g: Int) {
        var n = 0
        beacon(ask: true, scan: true)
        while gen == g {
            Thread.sleep(forTimeInterval: 4)
            if gen != g { break }
            n += 1
            beacon(ask: n % 5 == 0, scan: n % 5 == 0)        // раз в 20 с — обход своей подсети
            DispatchQueue.main.async { self.tick += 1 }       // обновить «в сети»
        }
    }

    private func udpLoop(_ fd: Int32, _ g: Int) {
        while gen == g {
            guard let (data, ip, port) = Sock.receive(fd) else { break }
            guard !data.isEmpty,
                  let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let raw = env["d"] as? String, let s = env["s"] as? String, s == sign(Data(raw.utf8)),
                  let d = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
                  d["app"] as? String == "RafChat", let pid = d["id"] as? String, pid != id else { continue }
            seen(d, pid, ip, port)
        }
    }

    var profile: [String: Any] {
        ["app": "RafChat", "id": id, "name": Profile.name, "dept": Profile.dept, "port": Int(Node.tcpPort), "plat": "ios"]
    }

    /// Запомнить участника (маяк, сообщение или ответ на /ping). Вызывать на главном потоке.
    /// Возвращает true, если он только что появился в сети.
    @discardableResult
    private func upsert(_ d: [String: Any], _ pid: String, _ ip: String) -> Bool {
        let prev = peers.first { $0.id == pid }
        let wasOnline = prev?.online ?? false
        let name = (d["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? prev?.name ?? "?"
        let dept = (d["dept"] as? String) ?? prev?.dept ?? ""
        let plat = (d["plat"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? prev?.plat ?? ""
        let p = Peer(id: pid, name: name, dept: dept, ip: ip, port: (d["port"] as? Int) ?? Int(Node.tcpPort),
                     plat: plat, lastSeen: Date().timeIntervalSince1970)
        if let i = peers.firstIndex(where: { $0.id == pid }) { peers[i] = p } else { peers.append(p) }
        if prev == nil { catchUp(pid) }
        if !wasOnline {
            store.save("peers.json", peers)
            kick()
        }
        return !wasOnline
    }

    /// Новый участник: дослать ему мои сообщения «Общего чата» за последние сутки.
    private func catchUp(_ pid: String) {
        let since = Int64(Date().timeIntervalSince1970 * 1000) - 86_400_000
        for i in messages.indices where messages[i].mine && messages[i].chat == Node.all && messages[i].ts > since {
            let m = messages[i]
            let payload: [String: Any] = ["id": m.id, "from": id, "name": Profile.name, "to": Node.all, "ts": m.ts,
                                          "text": m.text, "file": m.file?.dict ?? NSNull(), "port": Int(Node.tcpPort)]
            if let pd = try? JSONSerialization.data(withJSONObject: payload), let ps = String(data: pd, encoding: .utf8),
               !outbox.contains(where: { $0.peer == pid && $0.msgId == m.id }) {
                outbox.append(OutItem(peer: pid, msgId: m.id, payload: ps))
                let parts = m.status.split(separator: "/")
                if parts.count == 2, let b = Int(parts[1]) { messages[i].status = "\(parts[0])/\(b + 1)" }
            }
        }
        persist()
    }

    private func seen(_ d: [String: Any], _ pid: String, _ ip: String, _ port: UInt16) {
        DispatchQueue.main.async {
            if d["bye"] as? Bool == true {
                if let i = self.peers.firstIndex(where: { $0.id == pid }) { self.peers[i].lastSeen = 0 }
                return
            }
            let came = self.upsert(d, pid, ip)
            if came || d["ask"] as? Bool == true {
                DispatchQueue.global().async { self.beacon(to: (ip, port)) }
            }
        }
    }

    /// Запасной путь, если маяки (UDP) где-то режутся: спрашиваем известные адреса по TCP «ты тут?».
    private func pingLoop(_ g: Int) {
        while gen == g {
            Thread.sleep(forTimeInterval: 6)
            if gen != g { break }
            var targets: [(String, Int)] = DispatchQueue.main.sync {
                peers.filter { !$0.ip.isEmpty && Date().timeIntervalSince1970 - $0.lastSeen > 8 }.map { ($0.ip, $0.port) }
            }
            for part in Profile.extra.split(whereSeparator: { ",; ".contains($0) }) {
                let a = part.split(separator: ":")
                if let host = a.first {
                    targets.append((String(host), a.count > 1 ? (Int(a[1]) ?? 47800) + 1 : Int(Node.tcpPort)))
                }
            }
            for (ip, port) in targets { ping(ip, port) }
        }
    }

    private func ping(_ ip: String, _ port: Int) {
        guard let url = URL(string: "http://\(ip):\(port)/ping") else { return }
        var req = URLRequest(url: url, timeoutInterval: 3)
        req.setValue(authHeader("GET", "/ping"), forHTTPHeaderField: "X-Auth")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            guard (resp as? HTTPURLResponse)?.statusCode == 200, let data = data,
                  let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = d["id"] as? String, pid != self.id else { return }
            DispatchQueue.main.async { self.upsert(d, pid, ip) }
        }.resume()
    }

    // MARK: HTTP-сервер

    private func acceptLoop(_ fd: Int32, _ g: Int) {
        while gen == g {
            let c = accept(fd, nil, nil)
            if c < 0 { break }
            Thread.detachNewThread { [weak self] in self?.handle(c); close(c) }
        }
    }

    private func reply(_ r: SockReader, _ code: Int, _ obj: [String: Any]) {
        let body = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        let text = [200: "OK", 401: "Unauthorized", 404: "Not Found"][code] ?? "Error"
        _ = r.write(Data("HTTP/1.1 \(code) \(text)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8) + body)
    }

    private static func remoteIP(_ fd: Int32) -> String {
        var a = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let r = withUnsafeMutablePointer(to: &a) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getpeername(fd, $0, &len) }
        }
        return r == 0 ? Sock.ipString(a.sin_addr) : ""
    }

    private func handle(_ fd: Int32) {
        let remote = Node.remoteIP(fd)
        var tv = timeval(tv_sec: 60, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        let r = SockReader(fd)
        guard let first = r.line() else { return }
        let parts = first.split(separator: " ")
        guard parts.count >= 2 else { return }
        let method = String(parts[0]), target = String(parts[1])
        var h: [String: String] = [:]
        while let l = r.line(), !l.isEmpty {
            if let i = l.firstIndex(of: ":") {
                h[l[..<i].trimmingCharacters(in: .whitespaces).lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
            }
        }
        let len = Int(h["content-length"] ?? "0") ?? 0
        guard len <= 2_000_000, let body = len > 0 ? r.exact(len) : Data() else { return }
        guard checkAuth(h["x-auth"], method, target, body) else { return reply(r, 401, ["error": "auth"]) }
        let path = String(target.split(separator: "?").first ?? "")
        let query = URLComponents(string: target)?.queryItems ?? []
        switch (method, path) {
        case ("GET", "/ping"):
            reply(r, 200, profile)
        case ("POST", "/msg"):
            if let m = try? JSONSerialization.jsonObject(with: body) as? [String: Any] { receive(m, remote) }
            reply(r, 200, ["ok": true])
        case ("GET", "/file"):
            let fid = query.first { $0.name == "fid" }?.value ?? ""
            sendFile(r, fid, h["range"])
        default:
            reply(r, 404, ["error": "not_found"])
        }
    }

    private func sendFile(_ r: SockReader, _ fid: String, _ range: String?) {
        let path = DispatchQueue.main.sync { files[fid] }
        guard let path = path, let fh = FileHandle(forReadingAtPath: path),
              let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.int64Value
        else { return reply(r, 404, ["error": "not_found"]) }
        defer { try? fh.close() }
        var start: Int64 = 0
        if let range = range, range.hasPrefix("bytes="),
           let s = Int64(range.dropFirst(6).split(separator: "-").first ?? "") { start = s }
        if start > 0 && start < size {
            _ = r.write(Data("HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: \(size - start)\r\nContent-Range: bytes \(start)-\(size - 1)/\(size)\r\nConnection: close\r\n\r\n".utf8))
            try? fh.seek(toOffset: UInt64(start))
        } else {
            _ = r.write(Data("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: \(size)\r\nConnection: close\r\n\r\n".utf8))
        }
        while true {
            let chunk = fh.readData(ofLength: 256 * 1024)
            if chunk.isEmpty || !r.write(chunk) { break }
        }
    }

    // MARK: отправка

    func send(chat: String, text: String, file: URL? = nil, fileName: String? = nil) {
        let mid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        var meta: FileMeta?
        if let file = file {
            let fid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            files[fid] = file.path
            store.save("files.json", files)
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
            meta = FileMeta(fid: fid, name: fileName ?? file.lastPathComponent, size: size)
        }
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        let targets = chat == Node.all ? peers.map { $0.id } : [chat]
        let status = chat == Node.all ? "0/\(targets.count)" : "queued"
        messages.append(Msg(id: mid, chat: chat, sender: id, senderName: Profile.name, ts: ts, text: text, file: meta,
                            mine: true, status: status, local: file?.path, unread: false))
        let payload: [String: Any] = ["id": mid, "from": id, "name": Profile.name, "to": chat, "ts": ts, "text": text,
                                      "file": meta?.dict ?? NSNull(), "port": Int(Node.tcpPort)]
        if let pd = try? JSONSerialization.data(withJSONObject: payload), let ps = String(data: pd, encoding: .utf8) {
            for t in targets { outbox.append(OutItem(peer: t, msgId: mid, payload: ps)) }
        }
        persist()
        kick()
    }

    private let wake = NSCondition()
    func kick() { wake.lock(); wake.signal(); wake.unlock() }

    private func outboxLoop(_ g: Int) {
        while gen == g {
            wake.lock(); _ = wake.wait(until: Date().addingTimeInterval(3)); wake.unlock()
            if gen != g { break }
            let (items, online) = DispatchQueue.main.sync {
                (outbox, Dictionary(uniqueKeysWithValues: peers.filter { $0.online }.map { ($0.id, $0) }))
            }
            for it in items {
                guard let p = online[it.peer], let url = URL(string: "http://\(p.ip):\(p.port)/msg") else { continue }
                let body = Data(it.payload.utf8)
                var req = URLRequest(url: url, timeoutInterval: 10)
                req.httpMethod = "POST"
                req.httpBody = body
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue(authHeader("POST", "/msg", body), forHTTPHeaderField: "X-Auth")
                if Node.syncStatus(req) == 200 {
                    DispatchQueue.main.async {
                        self.outbox.removeAll { $0.peer == it.peer && $0.msgId == it.msgId }
                        self.delivered(it.msgId)
                    }
                }
            }
        }
    }

    private static func syncStatus(_ req: URLRequest) -> Int {
        let sem = DispatchSemaphore(value: 0)
        var code = 0
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            sem.signal()
        }.resume()
        sem.wait()
        return code
    }

    private func delivered(_ mid: String) {
        guard let i = messages.firstIndex(where: { $0.id == mid }) else { return }
        let st = messages[i].status
        if messages[i].chat == Node.all, st.contains("/") {
            let a = Int(st.split(separator: "/")[0]) ?? 0
            messages[i].status = "\(a + 1)/\(st.split(separator: "/")[1])"
        } else {
            messages[i].status = "delivered"
        }
        persist()
    }

    private func persist() {
        store.save("messages.json", messages)
        store.save("outbox.json", outbox)
    }

    // MARK: приём

    private func receive(_ m: [String: Any], _ ip: String) {
        guard let mid = m["id"] as? String, let from = m["from"] as? String else { return }
        let to = m["to"] as? String ?? ""
        let meta = FileMeta.from(m["file"])
        DispatchQueue.main.async {
            if from != self.id && !ip.isEmpty {
                // пришло сообщение — значит, отправитель в сети (даже если его маяки до нас не доходят)
                self.upsert(["name": m["name"] as? String ?? "", "port": m["port"] as? Int ?? Int(Node.tcpPort)], from, ip)
            }
            if self.messages.contains(where: { $0.id == mid }) { return }
            let chat = to == Node.all ? Node.all : from
            let msg = Msg(id: mid, chat: chat, sender: from, senderName: m["name"] as? String ?? "?",
                          ts: (m["ts"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000),
                          text: m["text"] as? String ?? "", file: meta, mine: false, status: "received", local: nil,
                          unread: self.visibleChat != chat)
            self.messages.append(msg)
            self.persist()
            if let meta = meta, meta.size <= Node.autoDownload { self.download(mid) }
        }
    }

    func download(_ mid: String) {
        guard !downloading.contains(mid), let m = messages.first(where: { $0.id == mid }), let f = m.file, m.local == nil
        else { return }
        downloading.insert(mid)
        let part = store.partDir.appendingPathComponent(mid + ".part")
        Task.detached { [weak self] in
            guard let self = self else { return }
            defer { DispatchQueue.main.async { self.downloading.remove(mid); self.progress[mid] = nil } }
            for _ in 0..<40 {
                let p = await MainActor.run { self.peers.first { $0.id == m.sender } }
                if let p = p, p.online {
                    let have = ((try? FileManager.default.attributesOfItem(atPath: part.path)[.size]) as? NSNumber)?.int64Value ?? 0
                    let path = "/file?fid=" + f.fid
                    if let url = URL(string: "http://\(p.ip):\(p.port)\(path)") {
                        var req = URLRequest(url: url, timeoutInterval: 20)
                        req.setValue(self.authHeader("GET", path), forHTTPHeaderField: "X-Auth")
                        if have > 0 { req.setValue("bytes=\(have)-", forHTTPHeaderField: "Range") }
                        do {
                            let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                            if code == 404 {
                                await MainActor.run {
                                    if let i = self.messages.firstIndex(where: { $0.id == mid }) { self.messages[i].status = "gone" }
                                }
                                return
                            }
                            if code == 200 || code == 206 {
                                if code == 200 || !FileManager.default.fileExists(atPath: part.path) {
                                    FileManager.default.createFile(atPath: part.path, contents: nil)
                                }
                                let fh = try FileHandle(forWritingTo: part)
                                try fh.seekToEnd()
                                var got = code == 206 ? have : 0
                                var buf = Data()
                                var last = Date()
                                for try await b in bytes {
                                    buf.append(b)
                                    if buf.count >= 256 * 1024 {
                                        try fh.write(contentsOf: buf); got += Int64(buf.count); buf.removeAll(keepingCapacity: true)
                                        if Date().timeIntervalSince(last) > 0.3 {
                                            last = Date()
                                            let g = got
                                            await MainActor.run { self.progress[mid] = (g, f.size) }
                                        }
                                    }
                                }
                                try fh.write(contentsOf: buf)
                                try fh.close()
                            }
                        } catch {}
                    }
                    let now = ((try? FileManager.default.attributesOfItem(atPath: part.path)[.size]) as? NSNumber)?.int64Value ?? 0
                    if now >= f.size {
                        let dest = self.uniqueDest(f.name)
                        try? FileManager.default.moveItem(at: part, to: dest)
                        await MainActor.run {
                            if let i = self.messages.firstIndex(where: { $0.id == mid }) { self.messages[i].local = dest.path }
                            self.persist()
                        }
                        return
                    }
                }
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
    }

    private func uniqueDest(_ name: String) -> URL {
        let safe = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        var u = store.downloads.appendingPathComponent(safe)
        var i = 2
        let base = (safe as NSString).deletingPathExtension, ext = (safe as NSString).pathExtension
        while FileManager.default.fileExists(atPath: u.path) {
            u = store.downloads.appendingPathComponent(ext.isEmpty ? "\(base) (\(i))" : "\(base) (\(i)).\(ext)")
            i += 1
        }
        return u
    }

    /// Скопировать выбранный файл в память приложения, чтобы раздавать его получателям.
    func importFile(_ url: URL) -> URL? {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let dest = store.sentDir.appendingPathComponent(String(UUID().uuidString.prefix(8)) + "_" + url.lastPathComponent)
        do { try FileManager.default.copyItem(at: url, to: dest); return dest } catch { return nil }
    }

    func importData(_ data: Data, name: String) -> URL? {
        let dest = store.sentDir.appendingPathComponent(String(UUID().uuidString.prefix(8)) + "_" + name)
        return (try? data.write(to: dest)) != nil ? dest : nil
    }

    // MARK: для интерфейса

    func history(_ chat: String) -> [Msg] { messages.filter { $0.chat == chat }.sorted { $0.ts < $1.ts } }
    func last(_ chat: String) -> Msg? { messages.filter { $0.chat == chat }.max { $0.ts < $1.ts } }
    func unread(_ chat: String) -> Int { messages.filter { $0.chat == chat && $0.unread }.count }
    func markRead(_ chat: String) {
        var changed = false
        for i in messages.indices where messages[i].chat == chat && messages[i].unread { messages[i].unread = false; changed = true }
        if changed { persist() }
    }
    var queued: Int { outbox.count }
}
