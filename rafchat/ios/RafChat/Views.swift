import PhotosUI
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct RafChatApp: App {
    @StateObject private var node = Node.shared
    @Environment(\.scenePhase) private var phase
    @State private var setUp = Profile.isSetUp

    var body: some Scene {
        WindowGroup {
            Group {
                if setUp {
                    ChatListView()
                } else {
                    SetupView(first: true) { setUp = true; node.start() }
                }
            }
            .environmentObject(node)
            .tint(Color(red: 0, green: 0.478, blue: 1))
        }
        .onChange(of: phase) { p in
            // iOS усыпляет свёрнутое приложение: при открытии — снова в сеть, при сворачивании — прощаемся
            if p == .active { node.start(); node.beacon(ask: true, scan: true) }
            if p == .background { node.stop() }
        }
    }
}

// MARK: общее

let corpOrange = Color(red: 1, green: 0.54, blue: 0)
let corpOrangeText = Color(red: 0.85, green: 0.44, blue: 0)

let avatarColors: [Color] = [.orange, .green, .purple, .pink, .cyan, .red, .indigo, .teal]

func avatarColor(_ key: String) -> Color {
    let h = key.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
    return avatarColors[Int(h % UInt32(avatarColors.count))]
}

func initials(_ name: String) -> String {
    let parts = name.replacingOccurrences(of: ".", with: " ").split(separator: " ").prefix(2)
    let s = parts.compactMap { $0.first }.map(String.init).joined().uppercased()
    return s.isEmpty ? "?" : s
}

struct Avatar: View {
    let name: String
    let key: String
    var size: CGFloat = 48
    var online = false
    var group = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if group {                           // «Общий чат»: логотип организации на белом круге с оранжевой каймой
                Circle().fill(Color.white).frame(width: size, height: size)
                    .overlay(Image("corp_logo").resizable().scaledToFit().padding(size * 0.12))
                    .overlay(Circle().stroke(corpOrange, lineWidth: 1.5))
            } else {
            Circle().fill(avatarColor(key))
                .frame(width: size, height: size)
                .overlay(
                    Group {
                        if group { Image(systemName: "person.2.fill").font(.system(size: size * 0.38)) }
                        else { Text(initials(name)).font(.system(size: size * 0.38, weight: .semibold)) }
                    }.foregroundColor(.white)
                )
            }
            if online {
                Circle().fill(Color.green).frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
            }
        }
    }
}

func fileColor(_ name: String) -> Color {
    switch (name as NSString).pathExtension.lowercased() {
    case "step", "stp", "igs", "iges", "f3d", "sldprt": return .purple
    case "stl", "3mf", "obj": return .orange
    case "nc", "tap", "cnc", "ngc", "gcode", "mpf": return .green
    case "dxf", "dwg": return .teal
    case "jpg", "jpeg", "png", "heic", "webp", "gif": return .cyan
    case "pdf": return .red
    default: return .gray
    }
}

func human(_ n: Int64) -> String {
    var v = Double(n)
    for u in ["Б", "КБ", "МБ", "ГБ"] {
        if v < 1024 || u == "ГБ" {
            return (u == "Б" || v >= 100 ? String(format: "%.0f", v) : String(format: "%.1f", v))
                .replacingOccurrences(of: ".", with: ",") + " " + u
        }
        v /= 1024
    }
    return "\(n)"
}

func timeText(_ ms: Int64) -> String {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
}

func shortWhen(_ ms: Int64) -> String {
    let d = Date(timeIntervalSince1970: Double(ms) / 1000)
    if Calendar.current.isDateInToday(d) { return timeText(ms) }
    let f = DateFormatter()
    f.dateFormat = "dd.MM"
    return f.string(from: d)
}

func dayText(_ ms: Int64) -> String {
    let d = Date(timeIntervalSince1970: Double(ms) / 1000)
    if Calendar.current.isDateInToday(d) { return "Сегодня" }
    if Calendar.current.isDateInYesterday(d) { return "Вчера" }
    let f = DateFormatter()
    f.locale = Locale(identifier: "ru_RU")
    f.dateFormat = "d MMMM yyyy"
    return f.string(from: d)
}

// MARK: список чатов

/// Куда открыть чат: сам чат и (из поиска) сообщение, к которому прокрутить.
struct Route: Hashable {
    var chat: String
    var focus: String? = nil
}

struct ChatListView: View {
    @EnvironmentObject var node: Node
    @State private var showSettings = false
    @State private var query = ""
    @State private var showTasks = false
    @State private var path: [Route] = []

    private var sortedPeers: [Peer] {
        node.peers.sorted { ($0.online ? 0 : 1, $0.name.lowercased()) < ($1.online ? 0 : 1, $1.name.lowercased()) }
    }

    private func chatTitle(_ chat: String) -> String {
        chat == Node.all ? "Общий чат" : (node.peers.first { $0.id == chat }?.name ?? "?")
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    let found = node.search(query.trimmingCharacters(in: .whitespaces))
                    Section("Найдено: \(found.count)") {
                        ForEach(found) { m in
                            NavigationLink(value: Route(chat: m.chat, focus: m.id)) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(chatTitle(m.chat)) · \(m.mine ? "Вы" : m.senderName) · \(shortWhen(m.ts))")
                                        .font(.caption).foregroundColor(.secondary)
                                    Text(snippet(m, 90)).lineLimit(2)
                                }
                            }
                        }
                    }
                } else if showTasks {
                    Section {
                        if node.tasks.isEmpty {
                            Text("Заданий пока нет — создайте кнопкой 📋 в чате.").foregroundColor(.secondary)
                        }
                        ForEach(node.tasks) { m in
                            NavigationLink(value: Route(chat: m.chat, focus: m.id)) { taskRow(m) }
                        }
                    } header: { Text("Все задания") }
                } else {
                    Section {
                        NavigationLink(value: Route(chat: Node.all)) {
                            row(key: Node.all, title: "Общий чат", online: true, group: true)
                        }
                        .listRowBackground(RoundedRectangle(cornerRadius: 12).fill(Color(red: 1, green: 0.945, blue: 0.878))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(red: 1, green: 0.82, blue: 0.6))))
                        ForEach(sortedPeers) { p in
                            NavigationLink(value: Route(chat: p.id)) { row(key: p.id, title: p.title, online: p.online, group: false) }
                                .swipeActions {
                                    Button(role: .destructive) { node.deleteChat(p.id) } label: { Label("Удалить", systemImage: "trash") }
                                }
                        }
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            let on = node.peers.filter { $0.online }.count
                            Text("В сети: \(on) из \(node.peers.count)" + (node.queued > 0 ? " · в очереди: \(node.queued)" : ""))
                            if let ok = node.relayOk { Text(ok ? "Сервер: на связи ✓" : "Сервер: нет связи") }
                            Text("iPhone получает сообщения, пока RafChat открыт. Недоставленное ждёт у коллег и придёт сразу после открытия.")
                            Text("RafChat · Автор: Рафаил Шарапов · rafail@sharapov-cnc.ru").padding(.top, 8)
                        }.font(.footnote)
                    }
                }
            }
            .searchable(text: $query, prompt: "Поиск по переписке")
            .navigationTitle(showTasks ? "Задания" : "Чаты")
            .navigationDestination(for: Route.self) { ChatView(chat: $0.chat, focus: $0.focus) }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { showTasks.toggle() } label: { Text(showTasks ? "Чаты" : "📋") }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showSettings) { SetupView(first: false) { showSettings = false; node.restart() } }
            .refreshable { node.beacon(ask: true, scan: true) }
        }
    }

    private func taskRow(_ m: Msg) -> some View {
        let t = m.taskObj ?? [:]
        let st = t["status"] as? String ?? TaskStatus.new
        let due = (t["due"] as? String).flatMap { $0.isEmpty || st == TaskStatus.done || st == TaskStatus.ok ? nil : $0 }
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("📋 " + (t["title"] as? String ?? "")).font(.headline).lineLimit(1)
                Spacer()
                Text(st).font(.caption.bold()).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Capsule().fill(taskColor(st)))
            }
            Text(chatTitle(m.chat) + (due.map { " · " + dueInfo($0).0 } ?? ""))
                .font(.subheadline).foregroundColor(due.map { dueInfo($0).1 } == true ? .red : .secondary)
        }
    }

    private func row(key: String, title: String, online: Bool, group: Bool) -> some View {
        let last = node.last(key)
        let unread = node.unread(key)
        let preview: String = {
            guard let m = last else { return group ? "Сообщения для всех" : (online ? "в сети" : "не в сети") }
            let who = m.mine ? "Вы: " : (key == Node.all ? "\(m.senderName): " : "")
            return who + snippet(m)
        }()
        return HStack(spacing: 12) {
            Avatar(name: title, key: key, size: 48, online: online && !group, group: group)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(title).font(.headline).lineLimit(1).foregroundColor(group ? corpOrangeText : .primary)
                    Spacer()
                    if let m = last { Text(shortWhen(m.ts)).font(.footnote).foregroundColor(.secondary) }
                }
                if group {
                    Text("Корпоративный · " + Defaults.company).font(.caption.bold()).foregroundColor(corpOrangeText).lineLimit(1)
                }
                HStack {
                    Text(preview).font(.subheadline).foregroundColor(.secondary).lineLimit(1)
                    Spacer()
                    if unread > 0 {
                        Text("\(unread)").font(.caption.bold()).foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(Color.accentColor))
                    }
                }
            }
        }.padding(.vertical, 4)
    }
}

func taskColor(_ st: String) -> Color {
    switch st {
    case TaskStatus.work: return .orange
    case TaskStatus.done: return .blue
    case TaskStatus.ok: return .green
    case TaskStatus.rework: return .red
    default: return .gray
    }
}

// MARK: переписка

struct ChatView: View {
    let chat: String
    var focus: String? = nil
    @EnvironmentObject var node: Node
    @State private var text = ""
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var preview: URL?
    @State private var replyTo: [String: Any]? = nil
    @State private var replyLabel = ""
    @State private var newTask = false
    @State private var flash: String?
    /// файлы, которые прикрепляют к заданию (ответом на карточку)
    @State private var attachTo: [String: Any]? = nil

    private var title: String {
        chat == Node.all ? "Общий чат" : (node.peers.first { $0.id == chat }?.title ?? "?")
    }

    private var subtitle: String {
        if chat == Node.all {
            return "\(Defaults.company) · участников: \(node.peers.count + 1), в сети: \(node.peers.filter { $0.online }.count + 1)"
        }
        guard let p = node.peers.first(where: { $0.id == chat }) else { return "" }
        return p.lan ? "в сети" : (p.relay ? "в сети через интернет" : "не в сети — сообщение дойдёт, когда появится")
    }

    var body: some View {
        let msgs = node.history(chat)
        VStack(spacing: 0) {
            ScrollViewReader { sv in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(Array(msgs.enumerated()), id: \.element.id) { i, m in
                            if i == 0 || dayText(msgs[i - 1].ts) != dayText(m.ts) {
                                Text(dayText(m.ts)).font(.caption.bold()).foregroundColor(.secondary)
                                    .padding(.horizontal, 10).padding(.vertical, 3)
                                    .background(Capsule().fill(Color(.systemGray5))).padding(.top, 8)
                            }
                            Bubble(m: m, showName: chat == Node.all, preview: $preview,
                                   onReply: { startReply(m) },
                                   onJump: { id in withAnimation { sv.scrollTo(id, anchor: .center) }; blink(id) },
                                   onAttach: { attachTo = ["id": m.id, "name": m.senderName,
                                                           "text": "📋 " + (m.taskObj?["title"] as? String ?? "")]; importing = true })
                                .id(m.id)
                                .overlay(RoundedRectangle(cornerRadius: 18).fill(Color.yellow.opacity(flash == m.id ? 0.35 : 0)).allowsHitTesting(false))
                        }
                    }.padding(.horizontal, 12).padding(.vertical, 8)
                }
                .background(
                    Image(chat == Node.all ? "corp_pattern" : "chat_pattern").resizable(resizingMode: .tile)
                        .background(Color(red: 0.925, green: 0.933, blue: 0.949))
                )
                .onAppear {
                    if let f = focus {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { sv.scrollTo(f, anchor: .center); blink(f) }
                    } else if let l = msgs.last { sv.scrollTo(l.id, anchor: .bottom) }
                }
                .onChange(of: msgs.count) { _ in
                    if let l = msgs.last { withAnimation { sv.scrollTo(l.id, anchor: .bottom) } }
                }
            }
            Divider()
            if replyTo != nil {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Ответ: " + (replyTo?["name"] as? String ?? "")).font(.caption.bold()).foregroundColor(.accentColor)
                        Text(replyLabel).font(.subheadline).foregroundColor(.secondary).lineLimit(1)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .overlay(Rectangle().fill(Color.accentColor).frame(width: 3), alignment: .leading)
                    Spacer()
                    Button { replyTo = nil } label: { Image(systemName: "xmark").foregroundColor(.secondary) }
                }.padding(.horizontal, 12).padding(.top, 6).background(Color(.systemBackground))
            }
            HStack(alignment: .bottom, spacing: 6) {
                Menu {
                    Button { attachTo = nil; importing = true } label: { Label("Файл", systemImage: "doc") }
                    PhotosPicker(selection: $photo, matching: .any(of: [.images, .videos])) {
                        Label("Фото или видео", systemImage: "photo")
                    }
                } label: {
                    Image(systemName: "paperclip").font(.system(size: 22)).frame(width: 36, height: 38)
                }
                Button { newTask = true } label: { Text("📋").font(.system(size: 21)).frame(width: 32, height: 38) }
                TextField("Сообщение", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 20).fill(Color(.systemGray6)))
                Button(action: sendText) {
                    Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                        .frame(width: 38, height: 38).background(Circle().fill(Color.accentColor))
                }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(title).font(.headline).lineLimit(1).foregroundColor(chat == Node.all ? corpOrangeText : .primary)
                    Text(subtitle).font(.caption).foregroundColor(.secondary).lineLimit(1)
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            if case let .success(urls) = r {
                var rp = attachTo ?? takeReply()
                for u in urls {
                    if let f = node.importFile(u) { node.send(chat: chat, text: "", file: f, fileName: u.lastPathComponent, reply: rp) }
                    if attachTo == nil { rp = nil }
                }
                attachTo = nil
            }
        }
        .onChange(of: photo) { item in
            guard let item = item else { return }
            let rp = takeReply()
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                    let f = DateFormatter()
                    f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
                    let name = "Фото_\(f.string(from: Date())).\(ext)"
                    await MainActor.run {
                        if let u = node.importData(data, name: name) { node.send(chat: chat, text: "", file: u, fileName: name, reply: rp) }
                        photo = nil
                    }
                }
            }
        }
        .sheet(isPresented: $newTask) {
            TaskSheet(names: node.peers.map { $0.name }) { t, files in
                newTask = false
                let tid = node.send(chat: chat, text: taskFallback(t), reply: takeReply(), task: t)
                let rp: [String: Any] = ["id": tid, "name": Profile.name, "text": "📋 " + (t["title"] as? String ?? "")]
                for (u, n) in files { node.send(chat: chat, text: "", file: u, fileName: n, reply: rp) }
            }.environmentObject(node)
        }
        .quickLookPreview($preview)
        .onAppear { node.visibleChat = chat; node.markRead(chat) }
        .onDisappear { node.visibleChat = nil }
        .onChange(of: msgs.count) { _ in node.markRead(chat) }
    }

    private func blink(_ id: String) {
        flash = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { if flash == id { flash = nil } }
    }

    private func startReply(_ m: Msg) {
        replyTo = ["id": m.id, "name": m.senderName, "text": snippet(m)]
        replyLabel = snippet(m)
    }

    private func takeReply() -> [String: Any]? {
        let r = replyTo
        replyTo = nil
        return r
    }

    private func sendText() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        text = ""
        node.send(chat: chat, text: t, reply: takeReply())
    }
}

struct Bubble: View {
    let m: Msg
    let showName: Bool
    @Binding var preview: URL?
    var onReply: () -> Void = {}
    var onJump: (String) -> Void = { _ in }
    var onAttach: () -> Void = {}
    @EnvironmentObject var node: Node

    private var statusText: String {
        guard m.mine else { return "" }
        if m.status == "queued" { return " 🕓" }
        if m.status == "relay" { return " ✓ на сервере" }
        if m.status == "delivered" { return " ✓✓" }
        let p = m.status.split(separator: "/")
        if p.count == 2 { return p[0] == p[1] && p[1] != "0" ? " ✓✓" : " ✓ \(p[0])/\(p[1])" }
        return ""
    }

    private var fg: Color { m.mine ? .white : .primary }
    private var mu: Color { m.mine ? .white.opacity(0.8) : .secondary }

    var body: some View {
        HStack {
            if m.mine { Spacer(minLength: 50) }
            VStack(alignment: .leading, spacing: 4) {
                if showName && !m.mine {
                    Text(m.senderName).font(.footnote.bold()).foregroundColor(avatarColor(m.sender))
                }
                if let r = m.replyObj {
                    Button { onJump(r["id"] as? String ?? "") } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r["name"] as? String ?? "").font(.caption.bold()).foregroundColor(m.mine ? .white : .accentColor)
                            Text(r["text"] as? String ?? "").font(.subheadline).foregroundColor(mu).lineLimit(2)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 6).fill(m.mine ? Color.white.opacity(0.18) : Color(.systemGray6)))
                        .overlay(Rectangle().fill(m.mine ? Color.white : Color.accentColor).frame(width: 3), alignment: .leading)
                    }.buttonStyle(.plain)
                }
                if let t = m.taskObj { taskCard(t) }
                if let f = m.file { fileRow(f) }
                if !m.text.isEmpty && m.task == nil {
                    Text(m.text).foregroundColor(fg)
                }
                Text(timeText(m.ts) + statusText).font(.caption2).foregroundColor(mu)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 18).fill(m.mine ? Color.accentColor : Color(.systemBackground)))
            .fixedSize(horizontal: false, vertical: true)
            .contextMenu {
                Button { onReply() } label: { Label("Ответить", systemImage: "arrowshape.turn.up.left") }
                if !m.text.isEmpty && m.task == nil {
                    Button { UIPasteboard.general.string = m.text } label: { Label("Копировать текст", systemImage: "doc.on.doc") }
                }
            }
            if !m.mine { Spacer(minLength: 50) }
        }
    }

    @ViewBuilder private func taskCard(_ t: [String: Any]) -> some View {
        let st = t["status"] as? String ?? TaskStatus.new
        VStack(alignment: .leading, spacing: 4) {
            Text("📋 ЗАДАНИЕ").font(.caption.bold()).foregroundColor(mu)
            Text(t["title"] as? String ?? "").font(.title3.bold()).foregroundColor(fg)
            if let d = t["drawing"] as? String, !d.isEmpty { Text("Чертёж / УП: **\(d)**").foregroundColor(fg) }
            let mq = [t["material"].map { "\($0)" } ?? "", t["qty"].map { "\($0) шт" } ?? ""].filter { !$0.isEmpty }
            if !mq.isEmpty { Text("Материал: **\(mq.joined(separator: " · "))**").foregroundColor(fg) }
            if let due = t["due"] as? String, !due.isEmpty {
                let (txt, hot) = dueInfo(due)
                let late = hot && st != TaskStatus.done && st != TaskStatus.ok
                Text("Срок: **\(late ? "⚠ " : "")\(txt)**").foregroundColor(late && !m.mine ? .red : fg)
            }
            if let w = t["who"] as? String, !w.isEmpty { Text("Исполнитель: **\(w)**").foregroundColor(fg) }
            if let n = t["note"] as? String, !n.isEmpty { Text(n).foregroundColor(fg) }
            HStack(spacing: 6) {
                Text(st).font(.caption.bold()).foregroundColor(m.mine ? taskColor(st) : .white)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Capsule().fill(m.mine ? Color.white : taskColor(st)))
                Text("\(t["by"] as? String ?? "") · \(shortWhen((t["at"] as? NSNumber)?.int64Value ?? m.ts))")
                    .font(.caption).foregroundColor(mu)
            }
            HStack(spacing: 6) {
                ForEach(Array((TaskStatus.next[st] ?? []).enumerated()), id: \.offset) { _, pair in
                    Button(pair.0) { node.taskUpdate(m.id, pair.1) }
                        .font(.subheadline.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 10).fill(m.mine ? Color.white : Color(red: 0.9, green: 0.94, blue: 1)))
                        .foregroundColor(.accentColor)
                }
                Button("📎 Файл") { onAttach() }
                    .font(.subheadline.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 10).fill(m.mine ? Color.white : Color(red: 0.9, green: 0.94, blue: 1)))
                    .foregroundColor(.accentColor)
            }.buttonStyle(.plain).padding(.top, 2)
        }.frame(minWidth: 240, alignment: .leading)
    }

    @ViewBuilder private func fileRow(_ f: FileMeta) -> some View {
        let ext = (f.name as NSString).pathExtension.lowercased()
        if let local = m.local, ["jpg", "jpeg", "png", "heic", "webp", "gif"].contains(ext),
           let img = UIImage(contentsOfFile: local) {
            // фото — прямо в переписке, нажатие — открыть крупно
            Image(uiImage: img).resizable().scaledToFit().frame(maxWidth: 240, maxHeight: 300)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onTapGesture { preview = URL(fileURLWithPath: local) }
        } else {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8).fill(fileColor(f.name)).frame(width: 36, height: 42)
                    .overlay(Text((f.name as NSString).pathExtension.uppercased().prefix(4)).font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white))
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.name).font(.subheadline.bold()).foregroundColor(fg)
                    if let p = node.progress[m.id], m.local == nil {
                        ProgressView(value: Double(p.0), total: Double(max(p.1, 1)))
                        Text("\(human(p.0)) из \(human(p.1))").font(.caption).foregroundColor(mu)
                    } else {
                        Text(human(f.size)).font(.caption).foregroundColor(mu)
                    }
                }
            }
            if let local = m.local {
                Button("Открыть") { preview = URL(fileURLWithPath: local) }
                    .font(.subheadline.bold()).foregroundColor(m.mine ? .white : .accentColor)
            } else if m.status == "gone" {
                Text("Файл больше недоступен у отправителя").font(.caption).foregroundColor(.secondary)
            } else if node.progress[m.id] == nil {
                Button("Скачать") { node.download(m.id) }.font(.subheadline.bold()).foregroundColor(.accentColor)
            }
        }
    }
}

// MARK: новое задание

struct TaskSheet: View {
    let names: [String]
    let done: ([String: Any], [(URL, String)]) -> Void
    @EnvironmentObject var node: Node
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var drawing = ""
    @State private var material = ""
    @State private var qty = 1
    @State private var hasDue = true
    @State private var due = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var who = ""
    @State private var note = ""
    @State private var files: [(URL, String)] = []
    @State private var importing = false
    @State private var photo: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            Form {
                Section("Деталь / что сделать *") { TextField("например: Вал Ø32 h6", text: $title) }
                Section("Чертёж / номер программы") { TextField("например: ВЛ-032.01, O1025", text: $drawing) }
                Section("Материал и количество") {
                    TextField("40Х, 45, Д16Т…", text: $material)
                    Stepper("Количество: \(qty) шт", value: $qty, in: 1...100000)
                }
                Section("Срок и исполнитель") {
                    Toggle("Срок", isOn: $hasDue)
                    if hasDue { DatePicker("до", selection: $due, displayedComponents: .date) }
                    TextField("Исполнитель", text: $who)
                    if !names.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack { ForEach(Array(Set(names)).sorted(), id: \.self) { n in Button(n) { who = n }.buttonStyle(.bordered) } }
                        }
                    }
                }
                Section("Примечание") { TextField("допуски, квалитет, шероховатость…", text: $note, axis: .vertical).lineLimit(2...5) }
                Section {
                    Button { importing = true } label: { Label("Прикрепить файлы", systemImage: "paperclip") }
                    PhotosPicker(selection: $photo, matching: .images) { Label("Фото чертежа", systemImage: "photo") }
                    if !files.isEmpty { Text("Прикреплено: " + files.map { $0.1 }.joined(separator: ", ")).font(.footnote) }
                } footer: { Text("Модель, УП, чертёж, фото — уйдут вместе с заданием, ответом на карточку.") }
            }
            .navigationTitle("📋 Новое задание")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Отправить") {
                        let f = DateFormatter()
                        f.dateFormat = "dd.MM.yyyy"
                        var t: [String: Any] = ["title": String(title.trimmingCharacters(in: .whitespaces).prefix(120))]
                        if !drawing.isEmpty { t["drawing"] = drawing }
                        if !material.isEmpty { t["material"] = material }
                        t["qty"] = qty
                        if hasDue { t["due"] = f.string(from: due) }
                        if !who.isEmpty { t["who"] = who }
                        if !note.isEmpty { t["note"] = note }
                        done(t, files)
                    }.disabled(title.trimmingCharacters(in: .whitespaces).count < 2)
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
                if case let .success(urls) = r {
                    for u in urls { if let f = node.importFile(u) { files.append((f, u.lastPathComponent)) } }
                }
            }
            .onChange(of: photo) { item in
                guard let item = item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        let f = DateFormatter()
                        f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
                        let name = "Чертёж_\(f.string(from: Date())).jpg"
                        await MainActor.run {
                            if let u = node.importData(data, name: name) { files.append((u, name)) }
                            photo = nil
                        }
                    }
                }
            }
        }
    }
}

// MARK: профиль

struct SetupView: View {
    let first: Bool
    let done: () -> Void
    @State private var name = Profile.name
    @State private var dept = Profile.dept
    @State private var org = Profile.org
    @State private var extra = Profile.extra
    @State private var server = Profile.server
    @State private var err = ""

    var body: some View {
        NavigationStack {
            Form {
                if first {
                    Section {
                        VStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 52)).foregroundColor(.accentColor)
                            Text("RafChat").font(.largeTitle.bold())
                            Text("Корпоративный чат и файлы — в офисе по локальной сети, вне офиса через сервер организации.")
                                .font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                }
                Section("Ваше имя (как вас увидят коллеги)") {
                    TextField("например: Иван Петров", text: $name).textContentType(.name)
                }
                Section("Отдел или участок (необязательно)") { TextField("например: Цех ЧПУ", text: $dept) }
                Section {
                    TextField("узнайте у коллег", text: $org).autocorrectionDisabled().textInputAutocapitalization(.never)
                } header: { Text("Код организации — одинаковый у всех") } footer: {
                    Text("Только устройства с этим кодом видят друг друга и могут писать.")
                }
                Section {
                    TextField("например: 192.168.1.20, 192.168.1.21", text: $extra)
                        .keyboardType(.numbersAndPunctuation).autocorrectionDisabled().textInputAutocapitalization(.never)
                } header: { Text("Адреса ПК, если они не находятся сами") }
                Section {
                    TextField("адрес:порт", text: $server)
                        .keyboardType(.numbersAndPunctuation).autocorrectionDisabled().textInputAutocapitalization(.never)
                } header: { Text("Сервер для работы через интернет") } footer: {
                    Text("Одинаковый у всех. Переписка шифруется кодом организации — сервер её не видит.")
                }
                if !err.isEmpty { Text(err).foregroundColor(.red) }
                Section {
                    Button(first ? "Начать" : "Сохранить", action: save).frame(maxWidth: .infinity).font(.headline)
                }
                Section {
                    Text("RafChat · Автор: Рафаил Шарапов")
                    Link("rafail@sharapov-cnc.ru", destination: URL(string: "mailto:rafail@sharapov-cnc.ru?subject=RafChat")!)
                } footer: { Text("© 2026 Рафаил Шарапов. Все права защищены.") }
            }
            .navigationTitle(first ? "Добро пожаловать" : "Профиль и сеть")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces), o = org.trimmingCharacters(in: .whitespaces)
        if n.count < 2 { err = "Укажите имя."; return }
        if o.count < 4 { err = "Код организации — не короче 4 символов."; return }
        Profile.name = String(n.prefix(60))
        Profile.dept = String(dept.trimmingCharacters(in: .whitespaces).prefix(40))
        Profile.org = o
        Profile.extra = extra.trimmingCharacters(in: .whitespaces)
        Profile.setServer(server)
        done()
    }
}
