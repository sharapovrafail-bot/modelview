import Darwin
import Foundation

/// Небольшие обёртки над BSD-сокетами. Широковещание на iPhone без особого разрешения Apple запрещено,
/// поэтому маяки шлём адресно (unicast) — каждому адресу своей подсети и известным участникам.
enum Sock {
    static func addr(_ ip: String, _ port: UInt16) -> sockaddr_in? {
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = port.bigEndian
        guard inet_pton(AF_INET, ip, &a.sin_addr) == 1 else { return nil }
        return a
    }

    static func ipString(_ a: in_addr) -> String {
        var a = a
        var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        inet_ntop(AF_INET, &a, &buf, socklen_t(INET_ADDRSTRLEN))
        return String(cString: buf)
    }

    private static func reuse(_ fd: Int32) {
        var yes: Int32 = 1
        let sz = socklen_t(MemoryLayout<Int32>.size)
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sz)
        setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &yes, sz)
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sz)
    }

    private static func bindAny(_ fd: Int32, _ port: UInt16) -> Bool {
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = port.bigEndian
        a.sin_addr.s_addr = INADDR_ANY
        let r = withUnsafePointer(to: &a) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return r == 0
    }

    static func udp(port: UInt16) -> Int32 {
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        if fd < 0 { return -1 }
        reuse(fd)
        if !bindAny(fd, port) { close(fd); return -1 }
        return fd
    }

    static func sendTo(_ fd: Int32, _ data: Data, _ ip: String, _ port: UInt16) {
        guard var a = addr(ip, port) else { return }
        data.withUnsafeBytes { buf in
            _ = withUnsafePointer(to: &a) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    sendto(fd, buf.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
    }

    /// Ждёт датаграмму. nil — сокет закрыт.
    static func receive(_ fd: Int32) -> (Data, String, UInt16)? {
        var buf = [UInt8](repeating: 0, count: 65535)
        var from = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let n = withUnsafeMutablePointer(to: &from) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &len) }
        }
        if n <= 0 { return n == 0 ? (Data(), "", 0) : nil }
        return (Data(buf[0..<n]), ipString(from.sin_addr), UInt16(bigEndian: from.sin_port))
    }

    static func tcpServer(port: UInt16) -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        if fd < 0 { return -1 }
        reuse(fd)
        if !bindAny(fd, port) || listen(fd, 16) != 0 { close(fd); return -1 }
        return fd
    }

    /// Свой адрес в Wi-Fi и маска подсети.
    static func wifiAddress() -> (ip: String, mask: String)? {
        var ifap: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifap) == 0, let first = ifap else { return nil }
        defer { freeifaddrs(ifap) }
        var best: (String, String)?
        var p: UnsafeMutablePointer<ifaddrs>? = first
        while let cur = p {
            let i = cur.pointee
            if let sa = i.ifa_addr, sa.pointee.sa_family == sa_family_t(AF_INET), let nm = i.ifa_netmask {
                let name = String(cString: i.ifa_name)
                let ip = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { ipString($0.pointee.sin_addr) }
                let mask = nm.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { ipString($0.pointee.sin_addr) }
                if !ip.hasPrefix("127.") && !ip.hasPrefix("169.254.") {
                    if name == "en0" { return (ip, mask) }
                    if best == nil && (name.hasPrefix("en") || name.hasPrefix("bridge")) { best = (ip, mask) }
                }
            }
            p = i.ifa_next
        }
        return best
    }

    /// Адреса соседей для поиска: своя подсеть, но не больше /24 вокруг своего адреса.
    static func neighbours() -> [String] {
        guard let (ip, mask) = wifiAddress() else { return [] }
        let toInt: (String) -> UInt32 = { s in
            s.split(separator: ".").compactMap { UInt32($0) }.reduce(0) { ($0 << 8) | $1 }
        }
        let me = toInt(ip)
        var m = toInt(mask)
        if m < 0xFFFF_FF00 { m = 0xFFFF_FF00 }
        let net = me & m
        let bcast = net | ~m
        var out: [String] = []
        var a = net + 1
        while a < bcast {
            if a != me { out.append("\(a >> 24 & 255).\(a >> 16 & 255).\(a >> 8 & 255).\(a & 255)") }
            a += 1
        }
        return out
    }
}

/// Чтение HTTP-запроса из сокета с буфером.
final class SockReader {
    let fd: Int32
    private var buf = [UInt8]()
    init(_ fd: Int32) { self.fd = fd }

    private func fill() -> Bool {
        var tmp = [UInt8](repeating: 0, count: 65536)
        let n = recv(fd, &tmp, tmp.count, 0)
        if n <= 0 { return false }
        buf.append(contentsOf: tmp[0..<n])
        return true
    }

    func line() -> String? {
        while true {
            if let i = buf.firstIndex(of: 10) {
                var l = Array(buf[0..<i])
                buf.removeSubrange(0...i)
                if l.last == 13 { l.removeLast() }
                return String(decoding: l, as: UTF8.self)
            }
            if buf.count > 16384 || !fill() { return nil }
        }
    }

    func exact(_ n: Int) -> Data? {
        while buf.count < n { if !fill() { return nil } }
        let d = Data(buf[0..<n])
        buf.removeSubrange(0..<n)
        return d
    }

    func write(_ d: Data) -> Bool {
        var off = 0
        while off < d.count {
            let n = d.withUnsafeBytes { p in send(fd, p.baseAddress! + off, d.count - off, 0) }
            if n <= 0 { return false }
            off += n
        }
        return true
    }
}
