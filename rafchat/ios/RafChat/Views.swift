import PhotosUI
import QuickLook
import SwiftUI
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
            Circle().fill(group ? Color.accentColor : avatarColor(key))
                .frame(width: size, height: size)
                .overlay(
                    Group {
                        if group { Image(systemName: "person.2.fill").font(.system(size: size * 0.38)) }
                        else { Text(initials(name)).font(.system(size: size * 0.38, weight: .semibold)) }
                    }.foregroundColor(.white)
                )
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

struct ChatListView: View {
    @EnvironmentObject var node: Node
    @State private var showSettings = false

    private var sortedPeers: [Peer] {
        node.peers.sorted { ($0.online ? 0 : 1, $0.name.lowercased()) < ($1.online ? 0 : 1, $1.name.lowercased()) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink(value: Node.all) {
                        row(key: Node.all, title: "Общий чат", online: true, group: true)
                    }
                    ForEach(sortedPeers) { p in
                        NavigationLink(value: p.id) { row(key: p.id, title: p.title, online: p.online, group: false) }
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        let on = node.peers.filter { $0.online }.count
                        Text("В сети: \(on) из \(node.peers.count)" + (node.queued > 0 ? " · в очереди: \(node.queued)" : ""))
                        Text("iPhone получает сообщения, пока RafChat открыт. Недоставленное ждёт у коллег и придёт сразу после открытия.")
                        Text("RafChat · Автор: Рафаил Шарапов · rafail@sharapov-cnc.ru").padding(.top, 8)
                    }.font(.footnote)
                }
            }
            .navigationTitle("Чаты")
            .navigationDestination(for: String.self) { ChatView(chat: $0) }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showSettings) { SetupView(first: false) { showSettings = false; node.restart() } }
            .refreshable { node.beacon(ask: true, scan: true) }
        }
    }

    private func row(key: String, title: String, online: Bool, group: Bool) -> some View {
        let last = node.last(key)
        let unread = node.unread(key)
        let preview: String = {
            guard let m = last else { return group ? "Сообщения для всех" : (online ? "в сети" : "не в сети") }
            let who = m.mine ? "Вы: " : (key == Node.all ? "\(m.senderName): " : "")
            return who + ((m.file != nil && m.text.isEmpty) ? "📎 \(m.file!.name)" : m.text)
        }()
        return HStack(spacing: 12) {
            Avatar(name: title, key: key, size: 48, online: online && !group, group: group)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(title).font(.headline).lineLimit(1)
                    Spacer()
                    if let m = last { Text(shortWhen(m.ts)).font(.footnote).foregroundColor(.secondary) }
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

// MARK: переписка

struct ChatView: View {
    let chat: String
    @EnvironmentObject var node: Node
    @State private var text = ""
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var preview: URL?

    private var title: String {
        chat == Node.all ? "Общий чат" : (node.peers.first { $0.id == chat }?.title ?? "?")
    }

    private var subtitle: String {
        if chat == Node.all {
            return "Участников: \(node.peers.count + 1), в сети: \(node.peers.filter { $0.online }.count + 1)"
        }
        return node.peers.first { $0.id == chat }?.online == true ? "в сети" : "не в сети — сообщение дойдёт, когда появится"
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
                            Bubble(m: m, showName: chat == Node.all, preview: $preview).id(m.id)
                        }
                    }.padding(.horizontal, 12).padding(.vertical, 8)
                }
                .background(Color(.systemGroupedBackground))
                .onAppear { if let l = msgs.last { sv.scrollTo(l.id, anchor: .bottom) } }
                .onChange(of: msgs.count) { _ in
                    if let l = msgs.last { withAnimation { sv.scrollTo(l.id, anchor: .bottom) } }
                }
            }
            Divider()
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { importing = true } label: { Label("Файл", systemImage: "doc") }
                    PhotosPicker(selection: $photo, matching: .any(of: [.images, .videos])) {
                        Label("Фото или видео", systemImage: "photo")
                    }
                } label: {
                    Image(systemName: "paperclip").font(.system(size: 22)).frame(width: 38, height: 38)
                }
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
                    Text(title).font(.headline).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundColor(.secondary).lineLimit(1)
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            if case let .success(urls) = r {
                for u in urls { if let f = node.importFile(u) { node.send(chat: chat, text: "", file: f, fileName: u.lastPathComponent) } }
            }
        }
        .onChange(of: photo) { item in
            guard let item = item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                    let f = DateFormatter()
                    f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
                    let name = "Фото_\(f.string(from: Date())).\(ext)"
                    await MainActor.run {
                        if let u = node.importData(data, name: name) { node.send(chat: chat, text: "", file: u, fileName: name) }
                        photo = nil
                    }
                }
            }
        }
        .quickLookPreview($preview)
        .onAppear { node.visibleChat = chat; node.markRead(chat) }
        .onDisappear { node.visibleChat = nil }
        .onChange(of: msgs.count) { _ in node.markRead(chat) }
    }

    private func sendText() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        text = ""
        node.send(chat: chat, text: t)
    }
}

struct Bubble: View {
    let m: Msg
    let showName: Bool
    @Binding var preview: URL?
    @EnvironmentObject var node: Node

    private var statusText: String {
        guard m.mine else { return "" }
        if m.status == "queued" { return " 🕓" }
        if m.status == "delivered" { return " ✓✓" }
        let p = m.status.split(separator: "/")
        if p.count == 2 { return p[0] == p[1] && p[1] != "0" ? " ✓✓" : " ✓ \(p[0])/\(p[1])" }
        return ""
    }

    var body: some View {
        HStack {
            if m.mine { Spacer(minLength: 50) }
            VStack(alignment: .leading, spacing: 4) {
                if showName && !m.mine {
                    Text(m.senderName).font(.footnote.bold()).foregroundColor(avatarColor(m.sender))
                }
                if let f = m.file { fileRow(f) }
                if !m.text.isEmpty {
                    Text(m.text).foregroundColor(m.mine ? .white : .primary).textSelection(.enabled)
                }
                Text(timeText(m.ts) + statusText).font(.caption2)
                    .foregroundColor(m.mine ? .white.opacity(0.75) : .secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 18).fill(m.mine ? Color.accentColor : Color(.systemBackground)))
            .fixedSize(horizontal: false, vertical: true)
            if !m.mine { Spacer(minLength: 50) }
        }
    }

    @ViewBuilder private func fileRow(_ f: FileMeta) -> some View {
        let fg: Color = m.mine ? .white : .primary
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8).fill(fileColor(f.name)).frame(width: 36, height: 42)
                .overlay(Text((f.name as NSString).pathExtension.uppercased().prefix(4)).font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(.subheadline.bold()).foregroundColor(fg)
                if let p = node.progress[m.id], m.local == nil {
                    ProgressView(value: Double(p.0), total: Double(max(p.1, 1)))
                    Text("\(human(p.0)) из \(human(p.1))").font(.caption).foregroundColor(m.mine ? .white.opacity(0.8) : .secondary)
                } else {
                    Text(human(f.size)).font(.caption).foregroundColor(m.mine ? .white.opacity(0.8) : .secondary)
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

// MARK: профиль

struct SetupView: View {
    let first: Bool
    let done: () -> Void
    @State private var name = Profile.name
    @State private var dept = Profile.dept
    @State private var org = Profile.org
    @State private var extra = Profile.extra
    @State private var err = ""

    var body: some View {
        NavigationStack {
            Form {
                if first {
                    Section {
                        VStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 52)).foregroundColor(.accentColor)
                            Text("RafChat").font(.largeTitle.bold())
                            Text("Чат и файлы по локальной сети организации — без сервера и интернета.")
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
        done()
    }
}
