import AVFoundation
import PDFKit
import SwiftUI
import UIKit

/// Голосовые сообщения: запись WAV 16 кГц моно (как на ПК и Android) и прослушивание.
final class Voice: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = Voice()
    @Published var recording = false
    @Published var playingId: String?
    @Published var seconds = 0
    private var rec: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var started = Date()

    func start(_ done: @escaping (Bool) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { ok in
            DispatchQueue.main.async {
                guard ok else { done(false); return }
                do {
                    try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                    try AVAudioSession.sharedInstance().setActive(true)
                    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
                    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                        .appendingPathComponent("RafChat/sent", isDirectory: true)
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let url = dir.appendingPathComponent("Голосовое_\(f.string(from: Date())).wav")
                    let r = try AVAudioRecorder(url: url, settings: [
                        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                        AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
                    guard r.record() else { done(false); return }
                    self.rec = r
                    self.recording = true
                    self.started = Date()
                    self.seconds = 0
                    self.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                        self.seconds = Int(Date().timeIntervalSince(self.started))
                    }
                    done(true)
                } catch { done(false) }
            }
        }
    }

    /// Остановить запись: keep=false — отменить. Возвращает файл и длительность.
    func stop(keep: Bool) -> (URL, Int)? {
        timer?.invalidate(); timer = nil
        guard let r = rec else { return nil }
        let secs = Int(Date().timeIntervalSince(started).rounded())
        r.stop()
        rec = nil
        recording = false
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        if !keep || secs < 1 { try? FileManager.default.removeItem(at: r.url); return nil }
        return (r.url, secs)
    }

    func toggle(_ mid: String, _ path: String) {
        if playingId == mid { stopPlay(); return }
        stopPlay()
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        guard let p = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: path)) else { return }
        p.delegate = self
        p.play()
        player = p
        playingId = mid
    }

    func stopPlay() { player?.stop(); player = nil; playingId = nil }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { self.playingId = nil }
    }
}

/// Миниатюры чертежей в переписке: PDF (первая страница), DXF (контуры); у STEP — деталь и программа.
enum Previews {
    private static var cache: [String: UIImage] = [:]

    static func thumb(_ fid: String, _ path: String, _ name: String) -> UIImage? {
        if let c = cache[fid] { return c }
        let ext = (name as NSString).pathExtension.lowercased()
        var img: UIImage?
        if ext == "pdf", let doc = PDFDocument(url: URL(fileURLWithPath: path)), let page = doc.page(at: 0) {
            img = page.thumbnail(of: CGSize(width: 480, height: 480), for: .mediaBox)
        } else if ext == "dxf" {
            img = dxf(path, 480)
        }
        if let i = img { cache[fid] = i }
        return img
    }

    static func dxf(_ path: String, _ side: CGFloat) -> UIImage? {
        guard let data = FileManager.default.contents(atPath: path), data.count < 20_000_000 else { return nil }
        let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1251) ?? ""
        let lines = text.components(separatedBy: .newlines)
        var segs: [(CGPoint, CGPoint)] = [], circles: [(CGPoint, CGFloat)] = [], arcs: [(CGPoint, CGFloat, CGFloat, CGFloat)] = []
        var inEnt = false, ent: String? = nil, dataPairs: [(String, String)] = [], poly: [CGPoint] = []
        func flush() {
            guard let e = ent else { return }
            var g: [String: String] = [:], pts: [CGPoint] = [], px: Double? = nil
            for (c, v) in dataPairs {
                if c == "10" { px = Double(v) }
                else if c == "20" { if let x = px, let y = Double(v) { pts.append(CGPoint(x: x, y: y)) }; px = nil }
                else if g[c] == nil { g[c] = v }
            }
            func f(_ k: String) -> CGFloat? { g[k].flatMap { Double($0) }.map { CGFloat($0) } }
            switch e {
            case "LINE": if let p = pts.first, let x = f("11"), let y = f("21") { segs.append((p, CGPoint(x: x, y: y))) }
            case "CIRCLE": if let p = pts.first, let r = f("40") { circles.append((p, r)) }
            case "ARC": if let p = pts.first, let r = f("40"), let a = f("50"), let b = f("51") { arcs.append((p, r, a, b)) }
            case "LWPOLYLINE", "SPLINE":
                if pts.count > 1 { for i in 0..<(pts.count - 1) { segs.append((pts[i], pts[i + 1])) } }
                if e == "LWPOLYLINE", (Int(g["70"] ?? "0") ?? 0) & 1 == 1, pts.count > 2 { segs.append((pts.last!, pts[0])) }
            case "VERTEX": if let p = pts.first { poly.append(p) }
            default: break
            }
        }
        var i = 0
        while i + 1 < lines.count {
            let c = lines[i].trimmingCharacters(in: .whitespaces), v = lines[i + 1].trimmingCharacters(in: .whitespaces)
            i += 2
            if c == "2" && v == "ENTITIES" { inEnt = true; continue }
            if !inEnt { continue }
            if c == "0" {
                flush()
                if v == "SEQEND", poly.count > 1 { for j in 0..<(poly.count - 1) { segs.append((poly[j], poly[j + 1])) }; poly = [] }
                if v == "ENDSEC" { break }
                ent = v; dataPairs = []
            } else { dataPairs.append((c, v)) }
        }
        flush()
        var xs: [CGFloat] = [], ys: [CGFloat] = []
        for (a, b) in segs { xs += [a.x, b.x]; ys += [a.y, b.y] }
        for (p, r) in circles { xs += [p.x - r, p.x + r]; ys += [p.y - r, p.y + r] }
        for (p, r, _, _) in arcs { xs += [p.x - r, p.x + r]; ys += [p.y - r, p.y + r] }
        guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return nil }
        let w = max(x1 - x0, 1e-6), h = max(y1 - y0, 1e-6), k = (side - 20) / max(w, h)
        let size = CGSize(width: w * k + 20, height: h * k + 20)
        func T(_ p: CGPoint) -> CGPoint { CGPoint(x: 10 + (p.x - x0) * k, y: size.height - 10 - (p.y - y0) * k) }
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            let cg = ctx.cgContext
            cg.setStrokeColor(UIColor(red: 0.11, green: 0.24, blue: 0.43, alpha: 1).cgColor); cg.setLineWidth(1.4)
            for (a, b) in segs.prefix(200_000) { cg.move(to: T(a)); cg.addLine(to: T(b)) }
            cg.strokePath()
            for (p, r) in circles { let c = T(p); cg.strokeEllipse(in: CGRect(x: c.x - r * k, y: c.y - r * k, width: 2 * r * k, height: 2 * r * k)) }
            for (p, r, a, b) in arcs {
                let c = T(p)
                cg.addArc(center: c, radius: r * k, startAngle: -a * .pi / 180, endAngle: -b * .pi / 180, clockwise: true)
                cg.strokePath()
            }
        }
    }

    static func stepInfo(_ path: String) -> String {
        guard let fh = FileHandle(forReadingAtPath: path) else { return "STEP" }
        let head = String(decoding: fh.readData(ofLength: 200_000), as: UTF8.self)
        try? fh.close()
        func dec(_ s: String) -> String {
            var out = s
            while let r = out.range(of: #"\\X2\\([0-9A-Fa-f]+)\\X0\\"#, options: .regularExpression) {
                let hex = String(out[r].dropFirst(4).dropLast(4))
                var u = ""
                var idx = hex.startIndex
                while idx < hex.endIndex, let end = hex.index(idx, offsetBy: 4, limitedBy: hex.endIndex) {
                    if let v = UInt32(hex[idx..<end], radix: 16), let sc = Unicode.Scalar(v) { u.append(Character(sc)) }
                    idx = end
                }
                out.replaceSubrange(r, with: u)
            }
            return out
        }
        var parts: [String] = []
        if let r = head.range(of: #"PRODUCT\s*\(\s*'[^']*'"#, options: .regularExpression) {
            let s = head[r]
            if let q = s.firstIndex(of: "'") {
                let name = s[s.index(after: q)...].dropLast().trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { parts.append("деталь «\(dec(name))»") }
            }
        }
        for sys in ["Fusion 360", "SolidWorks", "Inventor", "KOMPAS", "NX", "CATIA", "Creo", "FreeCAD"] where head.contains(sys) {
            parts.append(sys); break
        }
        return "STEP" + (parts.isEmpty ? "" : " · " + parts.joined(separator: " · "))
    }
}
