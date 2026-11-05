import CryptoKit
import Foundation

/// Встроено в установщик (как rafchat/defaults.json у ПК и Android).
enum Defaults {
    static let server = "89.127.218.28:47888"
    static let company = "ООО «СпецТехЗаказ»"
}

/// Участник сети (ПК, Android, Mac или iPhone).
struct Peer: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var dept: String
    var ip: String
    var port: Int
    var plat: String
    var lastSeen: Double
    var relaySeen: Double = 0

    /// в одной сети (напрямую)
    var lan: Bool { !ip.isEmpty && Date().timeIntervalSince1970 - lastSeen < Node.onlineSec }
    /// на связи через сервер (интернет)
    var relay: Bool { Date().timeIntervalSince1970 - relaySeen < Node.relayOnlineSec }
    var online: Bool { lan || relay }
    var title: String { dept.isEmpty ? name : "\(name) · \(dept)" }

    init(id: String, name: String, dept: String, ip: String, port: Int, plat: String, lastSeen: Double, relaySeen: Double = 0) {
        self.id = id; self.name = name; self.dept = dept; self.ip = ip; self.port = port; self.plat = plat
        self.lastSeen = lastSeen; self.relaySeen = relaySeen
    }

    init(from dec: Decoder) throws {
        let c = try dec.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "?"
        dept = try c.decodeIfPresent(String.self, forKey: .dept) ?? ""
        ip = try c.decodeIfPresent(String.self, forKey: .ip) ?? ""
        port = try c.decodeIfPresent(Int.self, forKey: .port) ?? Int(Node.tcpPort)
        plat = try c.decodeIfPresent(String.self, forKey: .plat) ?? ""
        lastSeen = try c.decodeIfPresent(Double.self, forKey: .lastSeen) ?? 0
        relaySeen = try c.decodeIfPresent(Double.self, forKey: .relaySeen) ?? 0
    }
}

/// Человек — имя + отдел/должность; все его устройства (ПК, телефон, Mac, iPhone) — один чат, как в WhatsApp.
struct Account: Identifiable {
    var id: String
    var name: String
    var dept: String
    var devices: [Peer]
    /// код внешнего контакта (не из организации); пусто — сотрудник
    var code: String = ""
    var ext: Bool { !code.isEmpty }
    var lan: Bool { devices.contains { $0.lan } }
    var relay: Bool { devices.contains { $0.relay } }
    var online: Bool { lan || relay }
    var title: String { dept.isEmpty ? name : "\(name) · \(dept)" }
    var plats: [String] {
        let names = ["android": "телефон", "ios": "iPhone", "pc": "ПК"]
        return Array(Set(devices.filter { $0.online }.map { names[$0.plat] ?? $0.plat })).sorted()
    }
}

func uidOf(_ name: String, _ dept: String) -> String {
    let k = name.trimmingCharacters(in: .whitespaces).lowercased() + "|" + dept.trimmingCharacters(in: .whitespaces).lowercased()
    let h = Insecure.SHA1.hash(data: Data(k.utf8)).map { String(format: "%02x", $0) }.joined()
    return "u" + String(h.prefix(15))
}

func isUid(_ chat: String) -> Bool { chat != Node.all && chat.count == 16 && chat.hasPrefix("u") }

/// Чат с внешним контактом: «x» + его личный код.
func isExt(_ chat: String) -> Bool { chat.count > 4 && chat.hasPrefix("x") }
func normCode(_ c: String) -> String { String(c.uppercased().filter { $0.isLetter || $0.isNumber }) }
func fmtCode(_ c: String) -> String {
    let s = Array(normCode(c))
    return stride(from: 0, to: s.count, by: 4).map { String(s[$0..<min($0 + 4, s.count)]) }.joined(separator: "-")
}

struct FileMeta: Codable, Equatable {
    var fid: String
    var name: String
    var size: Int64
    /// копия файла лежит на сервере (можно скачать, даже если отправитель не в нашей сети)
    var relay: Bool = false
    /// файл от внешнего контакта лежит в «почтовом ящике» с этим кодом
    var xorg: String = ""

    var dict: [String: Any] {
        var d: [String: Any] = ["fid": fid, "name": name, "size": size]
        if relay { d["relay"] = true }
        if !xorg.isEmpty { d["xorg"] = xorg }
        return d
    }

    init(fid: String, name: String, size: Int64, relay: Bool = false, xorg: String = "") {
        self.fid = fid; self.name = name; self.size = size; self.relay = relay; self.xorg = xorg
    }

    init(from dec: Decoder) throws {
        let c = try dec.container(keyedBy: CodingKeys.self)
        fid = try c.decode(String.self, forKey: .fid)
        name = try c.decode(String.self, forKey: .name)
        size = try c.decodeIfPresent(Int64.self, forKey: .size) ?? 0
        relay = try c.decodeIfPresent(Bool.self, forKey: .relay) ?? false
        xorg = try c.decodeIfPresent(String.self, forKey: .xorg) ?? ""
    }

    static func from(_ any: Any?) -> FileMeta? {
        guard let d = any as? [String: Any], let fid = d["fid"] as? String, let name = d["name"] as? String
        else { return nil }
        let size = (d["size"] as? NSNumber)?.int64Value ?? 0
        return FileMeta(fid: fid, name: name, size: size, relay: d["relay"] as? Bool ?? false, xorg: d["xorg"] as? String ?? "")
    }
}

struct Msg: Codable, Identifiable, Equatable {
    var id: String
    var chat: String
    var sender: String
    var senderName: String
    var ts: Int64
    var text: String
    var file: FileMeta?
    var mine: Bool
    var status: String
    var local: String?
    var unread: Bool
    /// ответ на сообщение {"id","name","text"} — JSON
    var reply: String? = nil
    /// карточка задания — JSON
    var task: String? = nil
    /// переслано от (имя); когда прочитано получателем (мс)
    var fwd: String? = nil
    var readAt: Int64 = 0

    var replyObj: [String: Any]? { Msg.obj(reply) }
    var taskObj: [String: Any]? { Msg.obj(task) }

    static func obj(_ s: String?) -> [String: Any]? {
        guard let s = s, let d = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    static func json(_ o: [String: Any]?) -> String? {
        guard let o = o, let d = try? JSONSerialization.data(withJSONObject: o) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    init(id: String, chat: String, sender: String, senderName: String, ts: Int64, text: String, file: FileMeta?,
         mine: Bool, status: String, local: String?, unread: Bool, reply: String? = nil, task: String? = nil,
         fwd: String? = nil) {
        self.id = id; self.chat = chat; self.sender = sender; self.senderName = senderName; self.ts = ts
        self.text = text; self.file = file; self.mine = mine; self.status = status; self.local = local
        self.unread = unread; self.reply = reply; self.task = task; self.fwd = fwd
    }

    init(from dec: Decoder) throws {
        let c = try dec.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        chat = try c.decode(String.self, forKey: .chat)
        sender = try c.decode(String.self, forKey: .sender)
        senderName = try c.decodeIfPresent(String.self, forKey: .senderName) ?? "?"
        ts = try c.decodeIfPresent(Int64.self, forKey: .ts) ?? 0
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        file = try c.decodeIfPresent(FileMeta.self, forKey: .file)
        mine = try c.decodeIfPresent(Bool.self, forKey: .mine) ?? false
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        local = try c.decodeIfPresent(String.self, forKey: .local)
        unread = try c.decodeIfPresent(Bool.self, forKey: .unread) ?? false
        reply = try c.decodeIfPresent(String.self, forKey: .reply)
        task = try c.decodeIfPresent(String.self, forKey: .task)
        fwd = try c.decodeIfPresent(String.self, forKey: .fwd)
        readAt = try c.decodeIfPresent(Int64.self, forKey: .readAt) ?? 0
    }
}

struct OutItem: Codable, Equatable {
    var peer: String
    var msgId: String
    var payload: String
}

/// Профиль: имя, отдел, код организации, запасные адреса, сервер.
enum Profile {
    private static let d = UserDefaults.standard
    static var id: String {
        if let s = d.string(forKey: "id") { return s }
        let s = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        d.set(s, forKey: "id")
        return s
    }
    static var name: String { get { d.string(forKey: "name") ?? "" } set { d.set(newValue, forKey: "name") } }
    static var dept: String { get { d.string(forKey: "dept") ?? "" } set { d.set(newValue, forKey: "dept") } }
    static var org: String { get { d.string(forKey: "org") ?? "" } set { d.set(newValue, forKey: "org") } }
    static var extra: String { get { d.string(forKey: "extra") ?? "" } set { d.set(newValue, forKey: "extra") } }
    static var isSetUp: Bool { name.count >= 2 && org.count >= 4 }

    /// Сервер для работы через интернет; если не задан — встроенный.
    static var server: String {
        let s = (d.string(forKey: "server") ?? "").trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? Defaults.server : s
    }
    /// Время ручной смены адреса сервера (новее — расходится по всем устройствам).
    static var serverT: Double { d.double(forKey: "srvt") }

    static func setServer(_ v: String) {
        let v = v.trimmingCharacters(in: .whitespaces)
        if v == server { return }
        d.set(v, forKey: "server")
        d.set(Date().timeIntervalSince1970, forKey: "srvt")
        setRelayAlt(0, false)
    }

    static func adoptServer(_ v: String, _ t: Double) {
        d.set(v.trimmingCharacters(in: .whitespaces), forKey: "server")
        d.set(t, forKey: "srvt")
        setRelayAlt(0, false)
    }

    /// Запомненный рабочий порт сервера (0 — основной) и шифрованный ли он.
    static var relayAltPort: Int { d.integer(forKey: "relay_alt_port") }
    static var relayAltTLS: Bool { d.bool(forKey: "relay_alt_tls") }
    static func setRelayAlt(_ p: Int, _ tls: Bool) {
        d.set(p, forKey: "relay_alt_port"); d.set(tls, forKey: "relay_alt_tls")
    }

    /// Внешние контакты: код → {name, dept}.
    static var contacts: [String: [String: String]] {
        get {
            guard let s = d.string(forKey: "xcontacts"), let data = s.data(using: .utf8) else { return [:] }
            return (try? JSONDecoder().decode([String: [String: String]].self, from: data)) ?? [:]
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) { d.set(String(data: data, encoding: .utf8), forKey: "xcontacts") }
        }
    }
    /// Чаты, открытые через «Новый чат» (видны, даже пока переписки нет).
    static var opened: Set<String> {
        get { Set(d.stringArray(forKey: "opened") ?? []) }
        set { d.set(Array(newValue), forKey: "opened") }
    }

    /// Удалённые чаты: не возвращать их из списка сервера, пока устройство само не выйдет на связь.
    static var hidden: Set<String> {
        get { Set(d.stringArray(forKey: "hidden") ?? []) }
        set { d.set(Array(newValue), forKey: "hidden") }
    }
}

/// Простое хранилище в JSON-файлах (для 10–50 человек этого достаточно).
final class Store {
    private let dir: URL
    init() {
        dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RafChat", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func load<T: Decodable>(_ name: String, _ type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    func save<T: Encodable>(_ name: String, _ value: T) {
        if let data = try? JSONEncoder().encode(value) {
            try? data.write(to: dir.appendingPathComponent(name), options: .atomic)
        }
    }

    /// Свои отправленные файлы (их раздаём получателям).
    var sentDir: URL {
        let u = dir.appendingPathComponent("sent", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    var partDir: URL {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("parts", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    /// Полученные файлы — в «Файлы → На iPhone → RafChat».
    var downloads: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
}

// MARK: задания для цеха (те же статусы, что на ПК и Android)

enum TaskStatus {
    static let new = "Новое", work = "В работе", done = "Готово", ok = "Принято ОТК", rework = "Доработка"
    static let next: [String: [(String, String)]] = [
        new: [("Взять в работу", work)], work: [("Готово", done)],
        done: [("Принято ОТК", ok), ("Доработка", rework)], rework: [("Взять в работу", work)], ok: [],
    ]
    static let order: [String: Int] = [rework: 0, work: 1, new: 2, done: 3, ok: 4]
}

/// Коротко о сообщении — для цитаты в ответе и результатов поиска.
func snippet(_ m: Msg, _ n: Int = 70) -> String {
    let t: String
    if let task = m.taskObj { t = "📋 " + (task["title"] as? String ?? "задание") }
    else if let f = m.file, m.text.isEmpty { t = "📎 " + f.name }
    else { t = m.text.replacingOccurrences(of: "\n", with: " ") }
    return t.count <= n ? t : String(t.prefix(n - 1)) + "…"
}

/// Текст задания для старых версий (они не умеют показывать карточку).
func taskFallback(_ t: [String: Any]) -> String {
    var parts = ["📋 Задание: \(t["title"] as? String ?? "")"]
    for (k, l) in [("drawing", "Чертёж/УП"), ("material", "Материал"), ("qty", "Кол-во"), ("due", "Срок"),
                   ("who", "Исполнитель"), ("note", "")] {
        if let v = t[k], "\(v)" != "" { parts.append(l.isEmpty ? "\(v)" : "\(l): \(v)") }
    }
    return parts.joined(separator: "\n")
}

/// «10.11.2026» → текст и «горит ли» срок.
func dueInfo(_ due: String) -> (String, Bool) {
    let f = DateFormatter()
    f.dateFormat = "dd.MM.yyyy"
    guard let d = f.date(from: due) else { return (due, false) }
    let left = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()),
                                               to: Calendar.current.startOfDay(for: d)).day ?? 0
    let s = DateFormatter()
    s.dateFormat = "dd.MM"
    let dd = s.string(from: d)
    if left < 0 { return ("до \(dd) — просрочено на \(-left) дн.", true) }
    if left == 0 { return ("до \(dd) — сегодня", true) }
    return ("до \(dd) (осталось \(left) дн.)", false)
}
