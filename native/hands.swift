// Milo's native hands: one small process that stays running, so clicks, keys and typing are instant
// instead of starting a new osascript every time. Talks JSON lines over stdin/stdout.
//
// Build: swiftc -O native/hands.swift -o dist/milo-hands   (npm run build:hands does this)
// Permission: runs as a child of Milo, so it uses the same Accessibility switch (Terminal in dev).
//
// Requests:  {"id":1,"cmd":"click","x":100,"y":200,"count":1,"button":"left"}
// Replies:   {"id":1,"ok":true}  or  {"id":1,"ok":false,"error":"..."}

import AppKit
import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func reply(_ id: Any?, _ obj: [String: Any]) {
    var o = obj
    o["id"] = id ?? NSNull()
    guard let d = try? JSONSerialization.data(withJSONObject: o),
          let s = String(data: d, encoding: .utf8) else { return }
    print(s)
    fflush(stdout)
}

let source = CGEventSource(stateID: .hidSystemState)

// ---- mouse -----------------------------------------------------------------------------

func click(x: Double, y: Double, count: Int, right: Bool) {
    let p = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(25_000)
    let downType: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let upType: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = right ? .right : .left
    for i in 1...max(1, count) {
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: p, mouseButton: button)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        down?.post(tap: .cghidEventTap)
        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: p, mouseButton: button)
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        up?.post(tap: .cghidEventTap)
        usleep(30_000)
    }
}

func move(x: Double, y: Double) {
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
        .post(tap: .cghidEventTap)
}

// ---- keyboard --------------------------------------------------------------------------

// US layout virtual key codes.
let KEYS: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
    "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
    ".": 47, "`": 50,
    "enter": 36, "return": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "pageup": 116, "pagedown": 121, "home": 115,
    "end": 119, "forwarddelete": 117,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101,
    "f10": 109, "f11": 103, "f12": 111,
]

let MODS: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand, "ctrl": .maskControl, "control": .maskControl,
    "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate, "shift": .maskShift,
]

func pressCombo(_ combo: String) -> String? {
    let parts = combo.lowercased().replacingOccurrences(of: " ", with: "").split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var key: String? = nil
    for p in parts where !p.isEmpty {
        if let m = MODS[p] { flags.insert(m) } else { key = p }
    }
    guard let k = key, let code = KEYS[k] else { return "Unknown key: \(combo)" }
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
    return nil
}

/// Types any text (emoji, accents, math symbols) one character at a time, so it visibly appears.
func typeText(_ text: String, delayMs: Int) {
    for ch in text {
        if ch == "\n" || ch == "\r\n" {
            _ = pressCombo("return")
        } else if ch == "\t" {
            _ = pressCombo("tab")
        } else {
            let units = Array(String(ch).utf16)
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            down?.flags = []
            down?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            down?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            up?.flags = []
            up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            up?.post(tap: .cghidEventTap)
        }
        if delayMs > 0 { usleep(useconds_t(delayMs * 1000)) }
    }
}

// ---- reading the screen through Accessibility -------------------------------------------

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

func frameOf(_ e: AXUIElement) -> CGRect? {
    guard let pv = attr(e, kAXPositionAttribute), let sv = attr(e, kAXSizeAttribute) else { return nil }
    var p = CGPoint.zero
    var s = CGSize.zero
    guard CFGetTypeID(pv) == AXValueGetTypeID(), CFGetTypeID(sv) == AXValueGetTypeID() else { return nil }
    AXValueGetValue(pv as! AXValue, .cgPoint, &p)
    AXValueGetValue(sv as! AXValue, .cgSize, &s)
    return CGRect(origin: p, size: s)
}

let USEFUL_ROLES: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXLink", "AXCheckBox", "AXRadioButton", "AXPopUpButton",
    "AXComboBox", "AXMenuItem", "AXMenuButton", "AXTab", "AXSlider", "AXStaticText", "AXHeading", "AXCell",
]

func short(_ v: AnyObject?) -> String {
    guard let s = v as? String else { return "" }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.count > 120 ? String(t.prefix(120)) : t
}

/// The real buttons, fields and text of the front window, with their screen positions.
func readElements(limit: Int) -> [[String: Any]] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [] }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard let win = attr(axApp, kAXFocusedWindowAttribute) else { return [] }
    var out: [[String: Any]] = []
    var stack: [(AXUIElement, Int)] = [(win as! AXUIElement, 0)]
    var visited = 0
    while let item = stack.popLast(), out.count < limit, visited < 4000 {
        let (el, depth) = item
        visited += 1
        let role = (attr(el, kAXRoleAttribute) as? String) ?? ""
        if USEFUL_ROLES.contains(role), let f = frameOf(el), f.width > 1, f.height > 1 {
            let label = [short(attr(el, kAXTitleAttribute)), short(attr(el, kAXDescriptionAttribute)),
                         short(attr(el, kAXValueAttribute))].first { !$0.isEmpty } ?? ""
            if !label.isEmpty || role == "AXTextField" || role == "AXTextArea" {
                out.append(["role": role, "label": label,
                            "x": Int(f.midX), "y": Int(f.midY), "w": Int(f.width), "h": Int(f.height)])
            }
        }
        if depth < 25, let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
            for k in kids.reversed() { stack.append((k, depth + 1)) }
        }
    }
    return out
}

// ---- requests ----------------------------------------------------------------------------

func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }

func handle(_ m: [String: Any]) {
    let id = m["id"]
    let cmd = (m["cmd"] as? String) ?? ""
    let trusted = AXIsProcessTrusted()
    let needsTrust: Set<String> = ["click", "move", "key", "type", "elements"]
    if needsTrust.contains(cmd) && !trusted {
        return reply(id, ["ok": false, "error": "accessibility"])
    }
    switch cmd {
    case "ping":
        reply(id, ["ok": true, "trusted": trusted, "version": 1])
    case "click":
        guard let x = num(m["x"]), let y = num(m["y"]) else { return reply(id, ["ok": false, "error": "bad args"]) }
        click(x: x, y: y, count: Int(num(m["count"]) ?? 1), right: (m["button"] as? String) == "right")
        reply(id, ["ok": true])
    case "move":
        guard let x = num(m["x"]), let y = num(m["y"]) else { return reply(id, ["ok": false, "error": "bad args"]) }
        move(x: x, y: y)
        reply(id, ["ok": true])
    case "key":
        if let err = pressCombo((m["combo"] as? String) ?? "") { return reply(id, ["ok": false, "error": err]) }
        reply(id, ["ok": true])
    case "type":
        typeText((m["text"] as? String) ?? "", delayMs: Int(num(m["delayMs"]) ?? 12))
        reply(id, ["ok": true])
    case "front":
        let app = NSWorkspace.shared.frontmostApplication
        reply(id, ["ok": true, "name": app?.localizedName ?? "", "bundle": app?.bundleIdentifier ?? ""])
    case "elements":
        reply(id, ["ok": true, "elements": readElements(limit: Int(num(m["limit"]) ?? 250))])
    case "window":
        // The front app's focused window: name, title and where it is on screen (points).
        let app = NSWorkspace.shared.frontmostApplication
        var out: [String: Any] = ["ok": true, "name": app?.localizedName ?? "", "bundle": app?.bundleIdentifier ?? ""]
        if trusted, let pid = app?.processIdentifier {
            let axApp = AXUIElementCreateApplication(pid)
            if let win = attr(axApp, kAXFocusedWindowAttribute) {
                let w = win as! AXUIElement
                out["title"] = short(attr(w, kAXTitleAttribute))
                if let f = frameOf(w) {
                    out["x"] = Int(f.origin.x); out["y"] = Int(f.origin.y)
                    out["w"] = Int(f.width); out["h"] = Int(f.height)
                }
            }
        }
        reply(id, out)
    default:
        reply(id, ["ok": false, "error": "unknown command \(cmd)"])
    }
}

// ---- Chrome native messaging ------------------------------------------------------------
// Chrome starts this binary (with the extension's origin as an argument) when Milo's extension asks
// "where's Milo?". We answer with the port + secret Milo saved at launch, in Chrome's format:
// a 4-byte little-endian length, then JSON. Only extensions listed in Milo's host manifest can ask.
if CommandLine.arguments.dropFirst().contains(where: { $0.hasPrefix("chrome-extension://") }) || CommandLine.arguments.contains("--native-host") {
    let input = FileHandle.standardInput
    let head = input.readData(ofLength: 4)
    if head.count == 4 {
        let n = head.withUnsafeBytes { $0.load(as: UInt32.self) }
        _ = input.readData(ofLength: Int(min(n, 1_000_000)))
    }
    let file = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/Milo/bridge.json")
    let body = (try? Data(contentsOf: URL(fileURLWithPath: file))) ?? Data("{\"error\":\"milo_not_running\"}".utf8)
    var len = UInt32(body.count).littleEndian
    FileHandle.standardOutput.write(Data(bytes: &len, count: 4))
    FileHandle.standardOutput.write(body)
    exit(0)
}

// Read requests on a background thread; do the work on the main thread, whose run loop keeps
// NSWorkspace (front app) up to date.
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
        DispatchQueue.main.async { handle(msg) }
    }
    exit(0) // Milo closed our stdin: he quit, so do we.
}
RunLoop.main.run()
