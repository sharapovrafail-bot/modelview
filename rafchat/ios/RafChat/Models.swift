import Foundation

/// Участник сети (ПК, Android или iPhone).
struct Peer: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var dept: String
    var ip: String
    var port: Int
    var plat: String
    var lastSeen: Double

    var online: Bool { Date().timeIntervalSince1970 - lastSeen < Node.onlineSec }
    var title: String { dept.isEmpty ? name : "\(name) · \(dept)" }
}

struct FileMeta: Codable, Equatable {
    var fid: String
    var name: String
    var size: Int64

    var dict: [String: Any] { ["fid": fid, "name": name, "size": size] }

    static func from(_ any: Any?) -> FileMeta? {
        guard let d = any as? [String: Any], let fid = d["fid"] as? String, let name = d["name"] as? String
        else { return nil }
        let size = (d["size"] as? NSNumber)?.int64Value ?? 0
        return FileMeta(fid: fid, name: name, size: size)
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
}

struct OutItem: Codable, Equatable {
    var peer: String
    var msgId: String
    var payload: String
}

/// Профиль: имя, отдел, код организации, запасные адреса.
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
}

/// Простое хранилище в JSON-файлах (для 10 человек этого достаточно).
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
