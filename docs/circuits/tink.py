"""Tinkercad-Circuits-style wiring illustrations for PinVisual (SVG)."""
import os, math
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
FONT = "Inter, 'DejaVu Sans', Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Menlo, monospace"
WC = dict(red="#e0201b", black="#2b2b2b", orange="#f08a00", brown="#7b4a1e", blue="#1f6fd6", yellow="#e8b400",
          purple="#8e44ad", green="#2e9e47", white="#f2f2f2")

def darker(hexc, f=0.62):
    h = hexc.lstrip("#"); r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return "#%02x%02x%02x" % (int(r*f), int(g*f), int(b*f))

class S:
    def __init__(s, w, h):
        s.w, s.h, s.el, s.top = w, h, [], []
    def a(s, x): s.el.append(x)
    def t(s, x, y, txt, size=14, fill="#333", weight=400, anchor="start", font=FONT, rot=None, layer=None):
        tr = f' transform="rotate({rot} {x} {y})"' if rot is not None else ""
        e = f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{tr}>{txt}</text>'
        (layer if layer is not None else s.el).append(e)
    def wire(s, d, color, w=7):
        """Tinkercad-like wire: dark outline + colour + soft highlight, round caps."""
        s.top.append(f'<path d="{d}" fill="none" stroke="{darker(color, 0.55)}" stroke-width="{w+3}" stroke-linecap="round" stroke-linejoin="round"/>')
        s.top.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
        s.top.append(f'<path d="{d}" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="{max(1.5, w*0.28)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(-0.8,-1.2)"/>')
    def ends(s, pts, color):
        for x, y in pts:
            s.top.append(f'<circle cx="{x}" cy="{y}" r="5.5" fill="{color}" stroke="{darker(color, 0.5)}" stroke-width="2"/>')
    def save(s, name):
        defs = '''<defs>
<filter id="sh" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#000" flood-opacity=".22"/></filter>
<linearGradient id="servoG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f74d0"/><stop offset=".55" stop-color="#3d86e6"/><stop offset="1" stop-color="#2a66bb"/></linearGradient>
<linearGradient id="modG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e5ea"/><stop offset="1" stop-color="#b8bcc5"/></linearGradient>
<linearGradient id="capG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c2f6e"/><stop offset=".5" stop-color="#2e4aa8"/><stop offset="1" stop-color="#1a2a62"/></linearGradient>
<linearGradient id="psuG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6070"/><stop offset="1" stop-color="#3b3f4b"/></linearGradient>
</defs>'''
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{s.w}" height="{s.h}" viewBox="0 0 {s.w} {s.h}">{defs}'
               f'<rect width="100%" height="100%" fill="#ffffff"/>' + "\n".join(s.el) + "\n".join(s.top) + "</svg>")
        open(os.path.join(OUT, name), "w").write(svg)

def rnd(pts, r=18):
    """Polyline with rounded corners -> path d."""
    d = f"M{pts[0][0]},{pts[0][1]}"
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i-1], pts[i], pts[i+1]
        l1 = math.hypot(x1-x0, y1-y0); l2 = math.hypot(x2-x1, y2-y1)
        rr = min(r, l1/2, l2/2)
        ax, ay = x1 - (x1-x0)/l1*rr, y1 - (y1-y0)/l1*rr
        bx, by = x1 + (x2-x1)/l2*rr, y1 + (y2-y1)/l2*rr
        d += f" L{ax:.1f},{ay:.1f} Q{x1},{y1} {bx:.1f},{by:.1f}"
    d += f" L{pts[-1][0]},{pts[-1][1]}"
    return d

def curve(p0, p1, bend=0.5, vertical=True):
    (x0, y0), (x1, y1) = p0, p1
    if vertical:
        my = y0 + (y1 - y0) * bend
        return f"M{x0},{y0} C{x0},{my} {x1},{my} {x1},{y1}"
    mx = x0 + (x1 - x0) * bend
    return f"M{x0},{y0} C{mx},{y0} {mx},{y1} {x1},{y1}"

# ---------------------------------------------------------------- components
ESP_L = ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"]
ESP_R = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2", "D4", "D2", "D15", "GND", "3V3"]

def esp32(s, x, y, label="ESP32 DevKit V1"):
    """Vertical DevKit (antenna up, USB down). Returns pin coords {('L'|'R', name): (x,y)}."""
    w, h, pitch = 230, 720, 30
    s.a(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#1d1d22"/></g>')
    # module
    s.a(f'<rect x="{x+45}" y="{y+14}" width="{w-90}" height="150" rx="4" fill="url(#modG)" stroke="#8d929c"/>')
    s.a(f'<rect x="{x+45}" y="{y+14}" width="{w-90}" height="38" fill="#1d1d22"/>')
    s.a(f'<path d="M{x+60},{y+40} h20 v-16 h12 v16 h12 v-16 h12 v16 h12 v-16 h12 v16 h20" fill="none" stroke="#c9a54a" stroke-width="3"/>')
    s.t(x + w/2, y + 100, "ESP-WROOM-32", 13, "#4a4e58", 700, "middle")
    s.t(x + w/2, y + 120, "Wi-Fi · BT", 11, "#6a6e78", 400, "middle")
    pins = {}
    for i in range(15):
        py = y + 190 + i * pitch
        for side, px, names in (("L", x + 16, ESP_L), ("R", x + w - 16, ESP_R)):
            s.a(f'<circle cx="{px}" cy="{py}" r="8" fill="#d8b04c" stroke="#8a6d20" stroke-width="1.5"/><circle cx="{px}" cy="{py}" r="3.5" fill="#1d1d22"/>')
            s.t(px + (16 if side == "L" else -16), py + 4, names[i], 11, "#e9e9ee", 600, "start" if side == "L" else "end", MONO)
            pins[(side, names[i])] = (px, py)
    # buttons, LED, usb, chip
    s.a(f'<rect x="{x+18}" y="{y+h-62}" width="34" height="26" rx="3" fill="#cfd2d8"/><circle cx="{x+35}" cy="{y+h-49}" r="7" fill="#33343a"/>')
    s.a(f'<rect x="{x+w-52}" y="{y+h-62}" width="34" height="26" rx="3" fill="#cfd2d8"/><circle cx="{x+w-35}" cy="{y+h-49}" r="7" fill="#33343a"/>')
    s.t(x + 35, y + h - 70, "EN", 9, "#bbb", 600, "middle"); s.t(x + w - 35, y + h - 70, "BOOT", 9, "#bbb", 600, "middle")
    s.a(f'<rect x="{x+w/2-30}" y="{y+h-22}" width="60" height="30" rx="4" fill="#c4c8cf" stroke="#8d929c"/>')
    s.a(f'<rect x="{x+w/2-14}" y="{y+h-120}" width="28" height="28" rx="2" fill="#0d0d10"/>')
    s.a(f'<circle cx="{x+w/2+40}" cy="{y+h-100}" r="5" fill="#ff4b3a"/>')
    s.t(x + w/2 + 30, y + h + 34, label, 15, "#333", 700, "start")
    return pins

def servo(s, x, y, label=None, scale=1.0, lead=70, below=False, up=False):
    """Top-down Tinkercad-style micro servo. Leads exit downward (or upward when up=True). Returns connector pin coords."""
    k = scale
    bw, bh = 64*k, 120*k
    s.a(f'<g filter="url(#sh)">'
        f'<rect x="{x-10*k}" y="{y+22*k}" width="{bw+20*k}" height="{14*k}" rx="{4*k}" fill="#2a66bb"/>'
        f'<rect x="{x-10*k}" y="{y+bh-36*k}" width="{bw+20*k}" height="{14*k}" rx="{4*k}" fill="#2a66bb"/>'
        f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="{6*k}" fill="url(#servoG)" stroke="#1d4f95" stroke-width="1.5"/></g>')
    cx = x + bw/2
    cy = (y + bh - 30*k) if up else (y + 30*k)
    sgn = 1 if up else -1
    s.a(f'<circle cx="{cx}" cy="{cy}" r="{20*k}" fill="#4a90ea" stroke="#1d4f95" stroke-width="1.5"/>')
    s.a(f'<path d="M{cx-6*k},{cy} L{cx-3*k},{cy+sgn*40*k} L{cx+3*k},{cy+sgn*40*k} L{cx+6*k},{cy} Z" fill="#f5f5f5" stroke="#b9b9b9" stroke-linejoin="round"/>')
    s.a(f'<circle cx="{cx}" cy="{cy}" r="{8*k}" fill="#f5f5f5" stroke="#b9b9b9"/><circle cx="{cx}" cy="{cy}" r="{2.5*k}" fill="#999"/>')
    s.t(cx, (y + 40*k) if up else (y + 92*k), "SG90", 11*k, "#dce9ff", 700, "middle")
    pts = {}
    y_edge = y if up else y + bh
    y_conn = y_edge - lead*k if up else y_edge + lead*k
    for i, col in enumerate((WC["brown"], WC["red"], WC["orange"])):
        lx = cx - 8*k + i*8*k
        s.a(f'<path d="M{lx},{y_edge} L{lx},{y_conn}" stroke="{col}" stroke-width="{5*k}" stroke-linecap="round"/>')
    s.a(f'<rect x="{cx-15*k}" y="{y_conn - (16*k if up else 0)}" width="{30*k}" height="{16*k}" rx="{2*k}" fill="#1b1b1b"/>')
    for i, n in enumerate(("GND", "V+", "SIG")):
        pts[n] = (cx - 8*k + i*8*k, y_conn - 16*k if up else y_conn + 16*k)
    if label:
        if up: ly = y + bh + 40*k
        elif below: ly = y + bh + lead*k + 44*k
        else: ly = y - 52*k
        s.t(cx, ly, label, 13*k, "#333", 700, "middle")
    return pts

def capacitor(s, x, y, label="470 µF"):
    """Electrolytic, standing; legs down to (x-8,y+60) (+) and (x+8,y+60) (−)."""
    s.a(f'<g filter="url(#sh)"><rect x="{x-18}" y="{y-10}" width="36" height="52" rx="7" fill="url(#capG)"/></g>')
    s.a(f'<rect x="{x+6}" y="{y-10}" width="8" height="52" fill="#9aa6c9" opacity=".85"/>')
    s.t(x + 10, y + 22, "−", 12, "#1c2f6e", 800, "middle")
    s.a(f'<path d="M{x-8},{y+42} V{y+62} M{x+8},{y+42} V{y+62}" stroke="#a9a9a9" stroke-width="3"/>')
    s.t(x, y - 18, label, 12, "#333", 600, "middle")
    return (x - 8, y + 62), (x + 8, y + 62)

def breadboard(s, x, y, cols=30):
    """Half-size breadboard with top/bottom power rails. Returns helper to get hole coords."""
    pitch = 20
    w = cols * pitch + 60; h = 300
    s.a(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#f3f1ec" stroke="#d9d5cc"/></g>')
    rails = {}
    for ri, (ry, lab) in enumerate(((y + 22, "+"), (y + 42, "−"), (y + h - 42, "+"), (y + h - 22, "−"))):
        col = WC["red"] if lab == "+" else "#2f6fd6"
        s.a(f'<line x1="{x+20}" y1="{ry + (-10 if ri in (0,2) else 10)}" x2="{x+w-20}" y2="{ry + (-10 if ri in (0,2) else 10)}" stroke="{col}" stroke-width="2"/>')
        for c in range(cols):
            if c % 6 == 5: continue
            hx = x + 30 + c*pitch
            s.a(f'<rect x="{hx-3.5}" y="{ry-3.5}" width="7" height="7" rx="1" fill="#55524c"/>')
        rails[ri] = ry
    s.a(f'<rect x="{x+10}" y="{y+h/2-6}" width="{w-20}" height="12" fill="#e4e0d6"/>')
    for r in range(10):
        ry = y + 76 + r*pitch + (12 if r >= 5 else 0)
        for c in range(cols):
            hx = x + 30 + c*pitch
            s.a(f'<rect x="{hx-3.5}" y="{ry-3.5}" width="7" height="7" rx="1" fill="#55524c"/>')
    def rail(i, c): return (x + 30 + c*pitch, rails[i])
    def hole(r, c): return (x + 30 + c*pitch, y + 76 + r*pitch + (12 if r >= 5 else 0))
    return rail, hole

def psu(s, x, y, volts="5.00", amps="6.0"):
    w, h = 300, 190
    s.a(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="url(#psuG)"/></g>')
    s.a(f'<rect x="{x+20}" y="{y+20}" width="{w-40}" height="62" rx="6" fill="#0d1a0f"/>')
    s.t(x + 40, y + 64, f"{volts} V", 30, "#5dff7a", 700, "start", MONO)
    s.t(x + w - 40, y + 64, f"{amps} A", 20, "#5dff7a", 600, "end", MONO)
    for i, dx in enumerate((80, 150)):
        s.a(f'<circle cx="{x+dx}" cy="{y+120}" r="14" fill="#2b2e36" stroke="#1a1c22" stroke-width="2"/>')
    s.t(x + 80, y + 152, "VOLTAGE", 9, "#c7c9d1", 600, "middle"); s.t(x + 150, y + 152, "CURRENT", 9, "#c7c9d1", 600, "middle")
    pr, pb = (x + 220, y + 130), (x + 262, y + 130)
    s.a(f'<circle cx="{pr[0]}" cy="{pr[1]}" r="13" fill="#e0201b" stroke="#7a0d0a" stroke-width="2"/><circle cx="{pr[0]}" cy="{pr[1]}" r="4" fill="#5a0a08"/>')
    s.a(f'<circle cx="{pb[0]}" cy="{pb[1]}" r="13" fill="#2b2b2b" stroke="#000" stroke-width="2"/><circle cx="{pb[0]}" cy="{pb[1]}" r="4" fill="#666"/>')
    s.t(pr[0], y + 168, "+", 16, "#fff", 800, "middle"); s.t(pb[0], y + 168, "−", 16, "#fff", 800, "middle")
    s.t(x + w/2, y + h + 28, "5 V power supply", 15, "#333", 700, "middle")
    return pr, pb

PCA_SIDE = ["GND", "OE", "SCL", "SDA", "VCC", "V+"]

def pca9685(s, x, y, title, addr, flip=False):
    """Horizontal PCA9685 board (~62×25 mm). Channel headers along one long edge (top, or bottom when flip)."""
    w, h = 640, 270
    Y = (lambda d: y + h - d) if flip else (lambda d: y + d)
    s.a(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#1f4aa6"/></g>')
    s.a(f'<rect x="{x+6}" y="{y+6}" width="{w-12}" height="{h-12}" rx="8" fill="none" stroke="#3d67c4" stroke-width="1.5"/>')
    left, right, ch = {}, {}, {}
    for i, n in enumerate(PCA_SIDE):
        py = (y + 60 + i * 30) if not flip else (y + 60 + i * 30 + 20)
        for side, px, d in (("L", x + 22, left), ("R", x + w - 22, right)):
            s.a(f'<rect x="{px-10}" y="{py-10}" width="20" height="20" fill="#151515"/><rect x="{px-3}" y="{py-3}" width="6" height="6" fill="#d7b24e"/>')
            s.t(px + (18 if side == "L" else -18), py + 4, n, 11, "#e9eefc", 600, "start" if side == "L" else "end", MONO)
            d[n] = (px, py)
    x0 = x + 150
    for c in range(16):
        px = x0 + c * 22 + (c // 4) * 12
        for r, col in enumerate(("#f2c230", "#d63a2e", "#1a1a1a")):  # PWM (edge), V+, GND
            py = Y(26 + r * 22)
            s.a(f'<rect x="{px-9}" y="{py-9}" width="18" height="18" fill="{col}"/><rect x="{px-3}" y="{py-3}" width="6" height="6" fill="#d7b24e"/>')
        s.t(px, Y(104) + (0 if not flip else 8), str(c), 10, "#e9eefc", 600, "middle", MONO)
        ch[c] = (px, Y(26), Y(48), Y(70))
    for r, (lab, col) in enumerate((("PWM", "#f2c230"), ("V+", "#ff8b80"), ("GND", "#cfd6ea"))):
        s.t(x0 - 30, Y(26 + r * 22) + 4, lab, 9, col, 700, "end")
    cy = y + 128 if not flip else y + 62
    s.a(f'<rect x="{x+w/2-40}" y="{cy}" width="80" height="80" rx="3" fill="#0f0f12"/>')
    s.t(x + w/2, cy + 44, "PCA9685", 11, "#bbbbbb", 700, "middle")
    tx, ty = x + w/2 + 120, (y + h - 70) if not flip else (y + 70)
    s.a(f'<rect x="{tx-50}" y="{ty-24}" width="100" height="58" rx="5" fill="#2a8be0" stroke="#145b9c" stroke-width="2"/>')
    term = {}
    for i, n in enumerate(("V+", "GND")):
        sx = tx - 24 + i*48
        s.a(f'<circle cx="{sx}" cy="{ty}" r="12" fill="#d5d8de" stroke="#7b818c" stroke-width="2"/><path d="M{sx-8},{ty} H{sx+8}" stroke="#555" stroke-width="3"/>')
        s.t(sx, ty + 28, n, 11, "#ffffff", 800, "middle")
        term[n] = (sx, ty)
    s.t(x + 24, (y + h - 26) if not flip else (y + 34), f"{title} · {addr}", 15, "#ffffff", 800)
    return left, right, ch, term

# ---------------------------------------------------------------- 1) single servo
def single():
    s = S(1900, 1200)
    s.t(60, 66, "PinVisual — single-servo test wiring", 30, "#222", 800)
    s.t(60, 98, "ESP32 drives one SG90 directly from D18 (GPIO 18). Firmware: PV_SERVO_BOARDS 0 · PV_DIRECT_GPIO 18", 16, "#666")
    pins = esp32(s, 160, 180)
    rail, hole = breadboard(s, 640, 520, 32)
    sv = servo(s, 1420, 190, "SG90 · pin 0 (row 1, col 1)", 1.35, 80)
    c_plus, c_minus = capacitor(s, rail(0, 22)[0] + 8, 460, "470 µF (optional)")
    # cap legs into rails: + to top + rail (row 0), − to top − rail (row 1)
    a = rail(0, 22); b = rail(1, 23)
    s.a(f'<path d="M{c_plus[0]},{c_plus[1]} L{a[0]},{a[1]}" stroke="#a9a9a9" stroke-width="3"/>')
    s.a(f'<path d="M{c_minus[0]},{c_minus[1]} L{b[0]},{b[1]}" stroke="#a9a9a9" stroke-width="3"/>')
    # ESP32 VIN -> + rail ; GND -> − rail
    vin, gnd, d18 = pins[("L", "VIN")], pins[("L", "GND")], pins[("R", "D18")]
    r_plus = rail(0, 2); r_minus = rail(1, 3)
    s.wire(rnd([vin, (110, vin[1]), (110, 1040), (600, 1040), (600, 420), (r_plus[0], 420), r_plus]), WC["red"])
    s.wire(rnd([gnd, (130, gnd[1]), (130, 1020), (620, 1020), (620, 440), (r_minus[0] , 440), r_minus]), WC["black"])
    s.ends([vin, r_plus], WC["red"]); s.ends([gnd, r_minus], WC["black"])
    # servo connector: SIG <- D18 ; V+ <- + rail ; GND <- − rail
    sp_v = rail(0, 28); sp_g = rail(1, 29)
    s.wire(rnd([sv["V+"], (sv["V+"][0], 470), (sp_v[0], 470), sp_v], 14), WC["red"])
    s.wire(rnd([sv["GND"], (sv["GND"][0], 455), (sp_g[0] + 2, 455), (sp_g[0], 480), sp_g], 10), WC["black"])
    s.wire(rnd([d18, (520, d18[1]), (520, 130), (sv["SIG"][0] + 120, 130), (sv["SIG"][0] + 120, 490), (sv["SIG"][0], 490), sv["SIG"]]), WC["orange"])
    s.ends([sv["V+"], sp_v], WC["red"]); s.ends([sv["GND"], sp_g], WC["black"]); s.ends([d18, sv["SIG"]], WC["orange"])
    # USB cable
    s.wire(rnd([(275, 900 + 8), (275, 1100), (380, 1100)]), "#9a9da5", 9)
    s.t(392, 1106, "USB to laptop / 5 V adapter", 14, "#555", 600)
    # labels near wires
    s.t(540, d18[1] - 10, "signal → D18", 13, "#b86500", 700)
    s.t(150, 1068, "VIN (5 V) → + rail", 13, "#b31612", 700)
    s.t(150, 1010, "GND → − rail", 13, "#222", 700)
    # notes card
    nx, ny = 1250, 880
    s.a(f'<rect x="{nx}" y="{ny}" width="600" height="200" rx="12" fill="#f6f6f8" stroke="#e2e2e8"/>')
    for i, t_ in enumerate(["Servo wires: brown = GND, red = +5 V, orange = signal.",
                            "VIN carries the USB 5 V: fine for one SG90.",
                            "If the ESP32 resets when the servo moves, feed the rails",
                            "from a separate 5 V supply and keep its − on the − rail.",
                            "Never power the servo from the 3V3 pin."]):
        s.t(nx + 24, ny + 40 + i * 32, ("•  " if i != 3 else "    ") + t_, 15, "#333")
    s.save("PinVisual_tinkercad_single_servo.svg")

# ---------------------------------------------------------------- 2) 30 servos
def full():
    s = S(3000, 2160)
    s.t(60, 66, "PinVisual — 30-servo wiring (5 × 6 display)", 32, "#222", 800)
    s.t(60, 100, "ESP32 → 2 × PCA9685 over I²C (SDA D21, SCL D22). Servos powered from each board's V+ screw terminal. Firmware: PV_SERVO_BOARDS 1", 16, "#666")
    pins = esp32(s, 140, 520)
    L1, R1, CH1, T1 = pca9685(s, 1000, 560, "PCA9685 #1", "0x40")
    L2, R2, CH2, T2 = pca9685(s, 1000, 1230, "PCA9685 #2", "0x41 (A0 bridged)", flip=True)
    k = 0.78
    sv_top, sv_bot = {}, {}
    for i in range(16):
        r, c = divmod(i, 6)
        sv_top[i] = servo(s, 170 + i * 135, 200, f"P{i} · R{r+1}C{c+1}", k, 60)
    for j in range(14):
        i = 16 + j; r, c = divmod(i, 6)
        sv_bot[j] = servo(s, 400 + j * 135, 1790, f"P{i} · R{r+1}C{c+1}", k, 60, up=True)
    # ribbons
    for c in range(16):
        px, ypwm, yv, yg = CH1[c]; sp = sv_top[c]
        for n, col, yy in (("SIG", WC["orange"], ypwm), ("V+", WC["red"], yv), ("GND", WC["brown"], yg)):
            s.wire(curve(sp[n], (px, yy), 0.55), col, 3.2)
    for j in range(14):
        px, ypwm, yv, yg = CH2[j]; sp = sv_bot[j]
        # servo connector is at the bottom of each servo: come up from below the servo body's side
        for n, col, yy in (("SIG", WC["orange"], ypwm), ("V+", WC["red"], yv), ("GND", WC["brown"], yg)):
            x1, y1 = sp[n]
            s.wire(curve((px, yy), (x1, y1), 0.5), col, 3.2)
    # I2C + logic
    E = {"GND": pins[("R", "GND")], "SCL": pins[("R", "D22")], "SDA": pins[("R", "D21")], "VCC": pins[("R", "3V3")]}
    cols = {"GND": WC["black"], "SCL": WC["yellow"], "SDA": WC["blue"], "VCC": WC["purple"]}
    for idx, n in enumerate(("GND", "SCL", "SDA", "VCC")):
        ex, ey = E[n]; bx, by = L1[n]
        xm = 520 + idx * 26
        s.wire(rnd([(ex, ey), (xm, ey), (xm, by), (bx, by)]), cols[n], 6)
        s.ends([(ex, ey), (bx, by)], cols[n])
        rx, ry = R1[n]; lx, ly = L2[n]
        xr = 1700 + idx * 26; yy = 1110 - idx * 18
        s.wire(rnd([(rx, ry), (xr, ry), (xr, yy), (930 - idx * 26, yy), (930 - idx * 26, ly), (lx, ly)]), cols[n], 6)
        s.ends([(rx, ry), (lx, ly)], cols[n])
    for n, lab in (("GND", "GND"), ("SCL", "SCL → D22"), ("SDA", "SDA → D21"), ("VCC", "VCC → 3V3")):
        s.t(400, E[n][1] - 10, lab, 12, darker(cols[n], 0.8), 700)
    s.t(1000, 1150, "same 4 logic wires continue to board #2", 13, "#555", 600)
    # power
    pr, pb = psu(s, 120, 1380)
    v1, g1 = T1["V+"], T1["GND"]; v2, g2 = T2["V+"], T2["GND"]
    XR, XB, YR, YB = 2240, 2270, 2070, 2095
    s.wire(rnd([pr, (pr[0], 1610), (pr[0] + 0.01, YR), (XR, YR), (XR, 860), (v1[0], 860), v1], 22), WC["red"], 9)
    s.wire(rnd([pb, (pb[0], YB), (XB, YB), (XB, 880), (g1[0], 880), g1], 22), WC["black"], 9)
    s.wire(rnd([(XR, 1200), (v2[0] + 0.01, 1200), v2], 18), WC["red"], 9)
    s.wire(rnd([(XB, 1186), (g2[0] + 0.01, 1186), g2], 18), WC["black"], 9)
    s.top.append(f'<circle cx="{XR}" cy="1200" r="9" fill="{WC["red"]}" stroke="#7a0d0a" stroke-width="2"/>')
    s.top.append(f'<circle cx="{XB}" cy="1186" r="9" fill="#2b2b2b" stroke="#000" stroke-width="2"/>')
    s.ends([pr, v1, v2], WC["red"]); s.ends([pb, g1, g2], WC["black"])
    s.t(2300, 1030, "5 V → each board's", 14, "#b31612", 700); s.t(2300, 1050, "V+ / GND screw terminal", 14, "#b31612", 700)
    s.t(2300, 1070, "(separate pair per board)", 13, "#b31612", 500)
    def cap_body(cx, top, label, label_y):
        s.a(f'<g filter="url(#sh)"><rect x="{cx-16}" y="{top}" width="32" height="48" rx="7" fill="url(#capG)"/></g>')
        s.a(f'<rect x="{cx+5}" y="{top}" width="7" height="48" fill="#9aa6c9" opacity=".85"/>')
        s.t(cx, label_y, label, 12, "#333", 600, "middle")
    cx1 = v1[0] - 110
    cap_body(cx1, 870, "1000 µF", 940)
    s.top.append(f'<path d="M{cx1-7},{870} Q{cx1-7},{800} {v1[0]-4},{v1[1]+8}" fill="none" stroke="#a9a9a9" stroke-width="3"/>')
    s.top.append(f'<path d="M{cx1+7},{870} Q{cx1+30},{790} {g1[0]-4},{g1[1]+10}" fill="none" stroke="#a9a9a9" stroke-width="3"/>')
    cx2 = v2[0] - 110
    cap_body(cx2, 1160, "1000 µF", 1150)
    s.top.append(f'<path d="M{cx2-7},{1208} Q{cx2-7},{1270} {v2[0]-4},{v2[1]-8}" fill="none" stroke="#a9a9a9" stroke-width="3"/>')
    s.top.append(f'<path d="M{cx2+7},{1208} Q{cx2+30},{1290} {g2[0]-4},{g2[1]-10}" fill="none" stroke="#a9a9a9" stroke-width="3"/>')
    # USB
    s.wire(rnd([(255, 1240 + 8), (255, 1300), (90, 1300)]), "#9a9da5", 9)
    s.t(60, 1330, "USB 5 V", 13, "#555", 600)
    # legend
    lx, ly = 2300, 560
    s.a(f'<rect x="{lx}" y="{ly}" width="640" height="420" rx="12" fill="#f6f6f8" stroke="#e2e2e8"/>')
    s.t(lx + 24, ly + 40, "Wires", 17, "#222", 800)
    for i, (col, t_) in enumerate([(WC["red"], "+5 V servo power"), (WC["black"], "GND (all grounds joined)"), (WC["purple"], "3.3 V logic → VCC"),
                                   (WC["blue"], "I²C SDA (D21)"), (WC["yellow"], "I²C SCL (D22)"), (WC["orange"], "Servo signal (PWM)"), (WC["brown"], "Servo GND (brown lead)")]):
        yy = ly + 74 + i * 34
        s.a(f'<path d="M{lx+24},{yy} H{lx+84}" stroke="{darker(col,.55)}" stroke-width="10" stroke-linecap="round"/><path d="M{lx+24},{yy} H{lx+84}" stroke="{col}" stroke-width="7" stroke-linecap="round"/>')
        s.t(lx + 100, yy + 5, t_, 15, "#333")
    s.t(lx + 24, ly + 340, "Board #1 (0x40): P0–P15", 14, "#555", 700)
    s.t(lx + 24, ly + 362, "Board #2 (0x41): P16–P29 · channels 14–15 spare", 14, "#555", 700)
    s.t(lx + 24, ly + 390, "P = pin number, R/C = row/column seen from the user's side", 13, "#777")
    s.save("PinVisual_tinkercad_30_servos.svg")

if __name__ == "__main__":
    single(); full(); print("ok")
