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
    static let relayOnlineSec = 75.0
    static let relayFileMax: Int64 = 50 * 1024 * 1024
    /// шифрованные порты сервера (мобильный интернет режет незашифрованный HTTP к зарубежным серверам)
    static let tlsPorts = [2053, 993, 465, 2083, 2087, 9443]

    @Published var peers: [Peer] = []
    @Published var messages: [Msg] = []
    @Published var progress: [String: (Int64, Int64)] = [:]
    @Published var running = false
    @Published var tick = 0
    /// nil — сервер не задан, true/false — есть ли с ним связь
    @Published var relayOk: Bool?
    var visibleChat: String?

    private let store = Store()
    private var outbox: [OutItem] = []
    private var files: [String: String] = [:]           // fid → путь к своему файлу
    private var key = SymmetricKey(size: .bits256)
    private var udpFd: Int32 = -1
    private var tcpFd: Int32 = -1
    private var gen = 0
    private var downloading = Set<String>()
    private var ekey = SymmetricKey(size: .bits256)
    private var orgId = ""
    private var altPort: Int? = nil
    private var altTLS = false
    private var probeAt = Date.distantPast
    private var relayUploaded = Set<String>()
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
        let org = Profile.org.trimmingCharacters(in: .whitespaces)
        key = SymmetricKey(data: SHA256.hash(data: Data(("RafChat:" + org).utf8)))
        ekey = SymmetricKey(data: SHA256.hash(data: Data(("RafChat-e2e:" + org).utf8)))
        orgId = String(Node.hex(SHA256.hash(data: Data(("RafChat-org:" + org).utf8))).prefix(32))
        if Profile.relayAltPort > 0 { altPort = Profile.relayAltPort; altTLS = Profile.relayAltTLS }
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
        Thread.detachNewThread { [weak self] in self?.relayLoop(g) }
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
                                "port": Int(Node.tcpPort), "plat": "ios", "ask": ask, "bye": bye,
                                "srv": Profile.server, "srvt": Profile.serverT]
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
        ["app": "RafChat", "id": id, "name": Profile.name, "dept": Profile.dept, "port": Int(Node.tcpPort), "plat": "ios",
         "srv": Profile.server, "srvt": Profile.serverT]
    }

    /// Запомнить участника (маяк, сообщение или ответ на /ping). Вызывать на главном потоке.
    /// Возвращает true, если он только что появился в сети.
    @discardableResult
    private func upsert(_ d: [String: Any], _ pid: String, _ ip: String) -> Bool {
        adoptServer(d)
        let prev = peers.first { $0.id == pid }
        let wasOnline = prev?.lan ?? false
        let name = (d["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? prev?.name ?? "?"
        let dept = (d["dept"] as? String) ?? prev?.dept ?? ""
        let plat = (d["plat"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? prev?.plat ?? ""
        let p = Peer(id: pid, name: name, dept: dept, ip: ip, port: (d["port"] as? Int) ?? Int(Node.tcpPort),
                     plat: plat, lastSeen: Date().timeIntervalSince1970, relaySeen: prev?.relaySeen ?? 0)
        if let i = peers.firstIndex(where: { $0.id == pid }) { peers[i] = p } else { peers.append(p) }
        if prev == nil { mergeDupes(pid); catchUp(pid) }
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
            var payload: [String: Any] = ["id": m.id, "from": id, "name": Profile.name, "to": Node.all, "ts": m.ts,
                                          "text": m.text, "file": m.file?.dict ?? NSNull(), "port": Int(Node.tcpPort)]
            if let r = m.replyObj { payload["reply"] = r }
            if let t = m.taskObj { payload["task"] = t }
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

    @discardableResult
    func send(chat: String, text: String, file: URL? = nil, fileName: String? = nil,
              reply: [String: Any]? = nil, task task0: [String: Any]? = nil) -> String {
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
        var task = task0
        if task != nil {
            if (task?["status"] as? String ?? "").isEmpty { task?["status"] = TaskStatus.new }
            task?["by"] = Profile.name; task?["at"] = ts
        }
        messages.append(Msg(id: mid, chat: chat, sender: id, senderName: Profile.name, ts: ts, text: text, file: meta,
                            mine: true, status: status, local: file?.path, unread: false,
                            reply: Msg.json(reply), task: Msg.json(task)))
        var payload: [String: Any] = ["id": mid, "from": id, "name": Profile.name, "to": chat, "ts": ts, "text": text,
                                      "file": meta?.dict ?? NSNull(), "port": Int(Node.tcpPort)]
        if let r = reply { payload["reply"] = r }
        if let t = task { payload["task"] = t }
        if let pd = try? JSONSerialization.data(withJSONObject: payload), let ps = String(data: pd, encoding: .utf8) {
            for t in targets { outbox.append(OutItem(peer: t, msgId: mid, payload: ps)) }
        }
        persist()
        kick()
        return mid
    }

    private let wake = NSCondition()
    func kick() { wake.lock(); wake.signal(); wake.unlock() }

    private func outboxLoop(_ g: Int) {
        while gen == g {
            wake.lock(); _ = wake.wait(until: Date().addingTimeInterval(3)); wake.unlock()
            if gen != g { break }
            let (items, online) = DispatchQueue.main.sync {
                (outbox, Dictionary(peers.filter { $0.lan }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }))
            }
            let relay = serverAddr() != nil
            for it in items {
                guard let p = online[it.peer], let url = URL(string: "http://\(p.ip):\(p.port)/msg") else {
                    if relay && relayDeliver(it.peer, it.payload) {          // иначе — через сервер
                        DispatchQueue.main.async {
                            self.outbox.removeAll { $0.peer == it.peer && $0.msgId == it.msgId }
                            self.viaRelay(it.msgId)
                        }
                    }
                    continue
                }
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
            } else if from != self.id {
                self.upsertRelay(["id": from, "name": m["name"] as? String ?? ""], Date().timeIntervalSince1970)
            }
            if m["type"] as? String == "task" {                 // коллега сменил статус задания
                let tid = m["task_id"] as? String ?? ""
                if let i = self.messages.firstIndex(where: { $0.id == tid }), var t = self.messages[i].taskObj {
                    let ts = (m["ts"] as? NSNumber)?.int64Value ?? 0
                    if ts >= ((t["at"] as? NSNumber)?.int64Value ?? 0) {
                        t["status"] = m["status"] as? String ?? t["status"]; t["by"] = m["name"] as? String ?? "?"; t["at"] = ts
                        self.messages[i].task = Msg.json(t)
                        self.persist()
                    }
                }
                return
            }
            if self.messages.contains(where: { $0.id == mid }) { return }
            let chat = to == Node.all ? Node.all : from
            let msg = Msg(id: mid, chat: chat, sender: from, senderName: m["name"] as? String ?? "?",
                          ts: (m["ts"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000),
                          text: m["text"] as? String ?? "", file: meta, mine: false, status: "received", local: nil,
                          unread: self.visibleChat != chat,
                          reply: Msg.json(m["reply"] as? [String: Any]), task: Msg.json(m["task"] as? [String: Any]))
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
                if (p == nil || !p!.lan) && f.relay && self.serverAddr() != nil,
                   let enc = try? self.relayCall("GET", "/r/file?fid=" + f.fid, nil, timeout: 300),
                   let data = self.dec(enc) {
                    let dest = self.uniqueDest(f.name)
                    try? data.write(to: dest)
                    await MainActor.run {
                        if let i = self.messages.firstIndex(where: { $0.id == mid }) { self.messages[i].local = dest.path }
                        self.persist()
                    }
                    return
                }
                if let p = p, p.lan {
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

// MARK: - работа через интернет (сервер-ретранслятор), задания, поиск

/// Сертификат сервера свой (самоподписанный) — принимаем его: переписка всё равно зашифрована ключом организации.
final class TrustAllDelegate: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

extension Node {
    static let relaySession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 600
        return URLSession(configuration: c, delegate: TrustAllDelegate(), delegateQueue: nil)
    }()

    // ---------- шифрование для сервера (AES-256-GCM: nonce 12 байт + шифротекст + тег — как у ПК и Android)
    func enc(_ data: Data) -> Data? { try? AES.GCM.seal(data, using: ekey).combined }

    func dec(_ blob: Data) -> Data? {
        guard let box = try? AES.GCM.SealedBox(combined: blob) else { return nil }
        return try? AES.GCM.open(box, using: ekey)
    }

    func serverAddr() -> (String, Int)? {
        let s = Profile.server.replacingOccurrences(of: "http://", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard !s.isEmpty else { return nil }
        let parts = s.split(separator: ":")
        let host = String(parts[0])
        let port = parts.count > 1 ? Int(parts[1]) ?? 47888 : 47888
        return (host, altPort ?? port)
    }

    /// Синхронный запрос к серверу (вызывать не с главного потока).
    func relayCall(_ method: String, _ path: String, _ body: Data?, json: Bool = true, timeout: Double = 15) throws -> Data {
        guard let (host, port) = serverAddr() else { throw URLError(.badURL) }
        let scheme = (altTLS && altPort != nil) ? "https" : "http"
        guard let url = URL(string: "\(scheme)://\(host):\(port)\(path)") else { throw URLError(.badURL) }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue(orgId, forHTTPHeaderField: "X-Org")
        req.setValue(id, forHTTPHeaderField: "X-Node")
        if let b = body {
            req.httpBody = b
            req.setValue(json ? "application/json" : "application/octet-stream", forHTTPHeaderField: "Content-Type")
        }
        return try Node.syncData(req)
    }

    static func syncData(_ req: URLRequest) throws -> Data {
        let sem = DispatchSemaphore(value: 0)
        var out: Data?
        var err: Error?
        relaySession.dataTask(with: req) { d, resp, e in
            if let e = e { err = e }
            else if (resp as? HTTPURLResponse)?.statusCode != 200 { err = URLError(.badServerResponse) }
            else { out = d ?? Data() }
            sem.signal()
        }.resume()
        sem.wait()
        if let e = err { throw e }
        return out ?? Data()
    }

    func relayJSON(_ method: String, _ path: String, _ body: [String: Any]? = nil, timeout: Double = 15) throws -> [String: Any] {
        let b = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let d = try relayCall(method, path, b, timeout: timeout)
        return (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
    }

    func relaySend(_ to: String, _ m: [String: Any]) -> Bool {
        guard let raw = try? JSONSerialization.data(withJSONObject: m), let blob = enc(raw) else { return false }
        return (try? relayJSON("POST", "/r/send", ["to": to, "blob": blob.base64EncodedString()])) != nil
    }

    /// Отправить через сервер (файл до 50 МБ — тоже, зашифрованным).
    func relayDeliver(_ to: String, _ payload: String) -> Bool {
        guard var m = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return true }
        if var f = m["file"] as? [String: Any], f["relay"] as? Bool != true,
           let fid = f["fid"] as? String, ((f["size"] as? NSNumber)?.int64Value ?? 0) <= Node.relayFileMax {
            let path = DispatchQueue.main.sync { files[fid] }
            if !relayUploaded.contains(fid), let path = path, let data = FileManager.default.contents(atPath: path),
               let blob = enc(data) {
                guard (try? relayCall("PUT", "/r/file?fid=" + fid, blob, json: false, timeout: 300)) != nil else { return false }
                relayUploaded.insert(fid)
            }
            if relayUploaded.contains(fid) { f["relay"] = true; m["file"] = f }
        }
        return relaySend(to, m)
    }

    /// Основной порт сервера не отвечает (мобильный интернет режет нестандартные порты) — пробуем
    /// шифрованные и «веб-порты», запоминаем первый рабочий.
    func probePorts() {
        guard Date().timeIntervalSince(probeAt) > 30 else { return }
        probeAt = Date()
        let s = Profile.server.replacingOccurrences(of: "http://", with: "")
        let parts = s.split(separator: ":")
        guard let hostPart = parts.first else { return }
        let host = String(hostPart)
        let main = parts.count > 1 ? Int(parts[1]) ?? 47888 : 47888
        let cand = [(main, false)] + Node.tlsPorts.map { ($0, true) } + [(80, false), (8080, false)]
        for (p, tls) in cand {
            guard let url = URL(string: "\(tls ? "https" : "http")://\(host):\(p)/") else { continue }
            let req = URLRequest(url: url, timeoutInterval: 6)
            if let d = try? Node.syncData(req), String(decoding: d, as: UTF8.self).contains("RafChat Relay") {
                altPort = p == main ? nil : p
                altTLS = tls && p != main
                Profile.setRelayAlt(altPort ?? 0, altTLS)       // после перезапуска — сразу через рабочий порт
                return
            }
        }
    }

    func relayLoop(_ g: Int) {
        var lastHello = Date.distantPast
        while gen == g {
            if serverAddr() == nil {
                DispatchQueue.main.async { self.relayOk = nil }
                Thread.sleep(forTimeInterval: 3); continue
            }
            do {
                if Date().timeIntervalSince(lastHello) > 20 {
                    try relayHello()
                    lastHello = Date()
                    DispatchQueue.main.async { if self.relayOk != true { self.relayOk = true } }
                    kick()
                }
                let r = try relayJSON("GET", "/r/poll?wait=25", nil, timeout: 40)
                DispatchQueue.main.async { if self.relayOk != true { self.relayOk = true } }
                var acks: [String] = []
                for it in r["items"] as? [[String: Any]] ?? [] {
                    if let q = it["qid"] as? String { acks.append(q) }
                    guard let b = it["blob"] as? String, let raw = Data(base64Encoded: b), let d = dec(raw),
                          let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
                    relayItem(m)
                }
                if !acks.isEmpty { _ = try? relayJSON("POST", "/r/ack", ["qids": acks]) }
            } catch {
                DispatchQueue.main.async { if self.relayOk != false { self.relayOk = false } }
                probePorts()
                if gen == g { Thread.sleep(forTimeInterval: 5) }
            }
        }
    }

    func relayHello() throws {
        guard let raw = try? JSONSerialization.data(withJSONObject: profile), let blob = enc(raw) else { return }
        let r = try relayJSON("POST", "/r/hello", ["profile": blob.base64EncodedString()])
        let now = (r["now"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970
        for p in r["peers"] as? [[String: Any]] ?? [] {
            guard let pid = p["id"] as? String, pid != id, let b = p["profile"] as? String,
                  let pr = Data(base64Encoded: b), let d = dec(pr),
                  let prof = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                  prof["id"] as? String == pid else { continue }
            let seen = Date().timeIntervalSince1970 - (now - ((p["last"] as? NSNumber)?.doubleValue ?? 0))
            DispatchQueue.main.async { self.upsertRelay(prof, seen) }
        }
    }

    func relayItem(_ m: [String: Any]) {
        if m["type"] as? String == "ack" {                    // получатель подтвердил — ✓✓
            let mid = m["id"] as? String ?? ""
            DispatchQueue.main.async {
                if let i = self.messages.firstIndex(where: { $0.id == mid }), self.messages[i].mine, self.messages[i].chat != Node.all {
                    self.messages[i].status = "delivered"; self.persist()
                }
            }
            return
        }
        guard let from = m["from"] as? String, from != id, m["id"] as? String != nil else { return }
        receive(m, "")
        _ = relaySend(from, ["type": "ack", "id": m["id"] as? String ?? "", "from": id])
    }

    /// Участник на связи через сервер (вызывать на главном потоке).
    func upsertRelay(_ d: [String: Any], _ seen: Double) {
        adoptServer(d)
        guard let pid = d["id"] as? String, pid != id else { return }
        let now = Date().timeIntervalSince1970
        let nowOnline = now - seen < Node.relayOnlineSec
        if let i = peers.firstIndex(where: { $0.id == pid }) {
            if let n = d["name"] as? String, !n.isEmpty { peers[i].name = n }
            if let dp = d["dept"] as? String { peers[i].dept = dp }
            let was = peers[i].online
            peers[i].relaySeen = max(peers[i].relaySeen, seen)
            if !was && nowOnline { kick() }
            return
        }
        // сервер помнит устройства 60 дней: старые установки и удалённые чаты не показываем, пока не выйдут на связь
        let name = d["name"] as? String ?? "", dept = d["dept"] as? String ?? ""
        if !nowOnline {
            if Profile.hidden.contains(pid) || now - seen > 3 * 86400 { return }
            if name.lowercased() == Profile.name.lowercased() && dept.lowercased() == Profile.dept.lowercased() { return }
        } else {
            var h = Profile.hidden; h.remove(pid); Profile.hidden = h
        }
        peers.append(Peer(id: pid, name: name.isEmpty ? "?" : name, dept: dept, ip: "", port: Int(Node.tcpPort),
                          plat: d["plat"] as? String ?? "", lastSeen: 0, relaySeen: seen))
        if nowOnline { mergeDupes(pid) }
        catchUp(pid)
        store.save("peers.json", peers)
        kick()
    }

    /// Адрес сервера расходится сам: берём более новый (сервер сменили) или любой, если у нас пусто.
    func adoptServer(_ d: [String: Any]) {
        guard let srv = (d["srv"] as? String)?.trimmingCharacters(in: .whitespaces), !srv.isEmpty else { return }
        let t = (d["srvt"] as? NSNumber)?.doubleValue ?? 0
        if srv != Profile.server && t > Profile.serverT {
            Profile.adoptServer(srv, t)
            altPort = nil; altTLS = false
        }
    }

    /// Тот же человек с нового устройства: старая запись с тем же именем и отделом, которая не в сети, склеивается.
    func mergeDupes(_ pid: String) {
        guard let me = peers.first(where: { $0.id == pid }), !me.name.isEmpty, me.name != "?" else { return }
        for p in peers where p.id != pid && !p.online
            && p.name.lowercased() == me.name.lowercased() && p.dept.lowercased() == me.dept.lowercased() {
            for i in messages.indices where messages[i].chat == p.id { messages[i].chat = pid }
            outbox.removeAll { $0.peer == p.id }
            peers.removeAll { $0.id == p.id }
            var h = Profile.hidden; h.insert(p.id); Profile.hidden = h
        }
        persist()
    }

    func viaRelay(_ mid: String) {
        guard let i = messages.firstIndex(where: { $0.id == mid }) else { return }
        if messages[i].chat == Node.all { delivered(mid); return }
        if messages[i].status != "delivered" { messages[i].status = "relay"; persist() }
    }

    /// Сменить статус задания — у себя и у всех, кому оно было отправлено.
    func taskUpdate(_ mid: String, _ st: String) {
        guard let i = messages.firstIndex(where: { $0.id == mid }), var t = messages[i].taskObj else { return }
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        t["status"] = st; t["by"] = Profile.name; t["at"] = ts
        messages[i].task = Msg.json(t)
        let chat = messages[i].chat
        let uid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let upd: [String: Any] = ["id": uid, "from": id, "name": Profile.name, "to": chat, "ts": ts, "type": "task",
                                  "task_id": mid, "status": st, "port": Int(Node.tcpPort), "file": NSNull(),
                                  "text": "📋 «\(t["title"] as? String ?? "")» — \(st)"]
        if let pd = try? JSONSerialization.data(withJSONObject: upd), let ps = String(data: pd, encoding: .utf8) {
            for p in (chat == Node.all ? peers.map { $0.id } : [chat]) { outbox.append(OutItem(peer: p, msgId: uid, payload: ps)) }
        }
        persist()
        kick()
    }

    /// Удалить чат: переписку и очередь; личный — вместе с участником (вернётся, если выйдет на связь).
    func deleteChat(_ key: String) {
        messages.removeAll { $0.chat == key }
        if key != Node.all {
            outbox.removeAll { $0.peer == key }
            peers.removeAll { $0.id == key }
            var h = Profile.hidden; h.insert(key); Profile.hidden = h
            store.save("peers.json", peers)
        }
        persist()
    }

    func search(_ q: String) -> [Msg] {
        let k = q.lowercased()
        return messages.filter {
            ($0.text + " " + ($0.file?.name ?? "") + " " + ($0.task ?? "") + " " + $0.senderName).lowercased().contains(k)
        }.sorted { $0.ts > $1.ts }.prefix(100).map { $0 }
    }

    var tasks: [Msg] {
        messages.filter { $0.task != nil }.sorted {
            let a = TaskStatus.order[$0.taskObj?["status"] as? String ?? ""] ?? 9
            let b = TaskStatus.order[$1.taskObj?["status"] as? String ?? ""] ?? 9
            return a != b ? a < b : $0.ts > $1.ts
        }
    }
}
