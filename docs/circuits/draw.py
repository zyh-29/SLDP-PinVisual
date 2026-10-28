"""PinVisual circuit diagrams (SVG). Pin assignments follow firmware/pinvisual-esp32/config.h and firmware/README.md."""
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

C = dict(ink="#1b1830", muted="#5f5a7a", line="#cfcae3", panel="#f7f6fc", accent="#6a3bd2",
         v5="#d7261e", gnd="#1b1b1f", v33="#c2185b", sda="#1f6fd6", scl="#d49a00", pwm="#f07d10",
         brown="#7a4a22", pca="#1d7a46", esp="#22202b", teal="#0f8a8a")
FONT = "Inter, 'DejaVu Sans', Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Menlo, monospace"

class SVG:
    def __init__(s, w, h):
        s.w, s.h, s.el = w, h, []
    def add(s, x): s.el.append(x)
    def text(s, x, y, t, size=16, fill=None, weight=400, anchor="start", font=FONT, italic=False):
        s.add(f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill or C["ink"]}" text-anchor="{anchor}"{" font-style=\"italic\"" if italic else ""}>{t}</text>')
    def rect(s, x, y, w, h, fill="#fff", stroke=None, sw=2, r=10, dash=None):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke or C["ink"]}" stroke-width="{sw}"{f" stroke-dasharray=\"{dash}\"" if dash else ""}/>')
    def wire(s, pts, color, w=3.5, dash=None):
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        s.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"{f" stroke-dasharray=\"{dash}\"" if dash else ""}/>')
    def dot(s, x, y, color, r=6):
        s.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"/>')
    def pin(s, x, y, label, side="right", color=None, size=15):
        # small square pad + label inside the block
        s.add(f'<rect x="{x-6}" y="{y-6}" width="12" height="12" fill="#fff" stroke="{C["ink"]}" stroke-width="2"/>')
        if color: s.add(f'<rect x="{x-3}" y="{y-3}" width="6" height="6" fill="{color}"/>')
        if side == "right":
            s.text(x - 14, y + 5, label, size, anchor="end", font=MONO)
        else:
            s.text(x + 14, y + 5, label, size, anchor="start", font=MONO)
    def label_on_wire(s, x, y, t, color, size=13):
        tw = len(t) * size * 0.6 + 12
        s.add(f'<rect x="{x - tw/2}" y="{y - size}" width="{tw}" height="{size + 9}" rx="4" fill="#fff" stroke="{color}" stroke-width="1.5"/>')
        s.text(x, y + 3, t, size, fill=color, weight=600, anchor="middle")
    def save(s, name):
        body = "\n".join(s.el)
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{s.w}" height="{s.h}" viewBox="0 0 {s.w} {s.h}"><rect width="100%" height="100%" fill="#ffffff"/>\n{body}\n</svg>'
        open(os.path.join(OUT, name), "w").write(svg)

def capacitor(s, x, y1, y2, label=""):
    """Polarised capacitor between rail y1 (+) and rail y2 (-)."""
    ym = (y1 + y2) / 2
    s.wire([(x, y1), (x, ym - 5)], C["ink"], 2.5)
    s.wire([(x - 14, ym - 5), (x + 14, ym - 5)], C["ink"], 3)
    s.add(f'<path d="M{x-14},{ym+7} Q{x},{ym+1} {x+14},{ym+7}" fill="none" stroke="{C["ink"]}" stroke-width="3"/>')
    s.wire([(x, ym + 4), (x, y2)], C["ink"], 2.5)
    s.text(x + 18, ym - 8, "+", 14, weight=700)
    s.dot(x, y1, C["v5"], 5); s.dot(x, y2, C["gnd"], 5)
    if label: s.text(x + 22, ym + 14, label, 13, fill=C["muted"])

def ground_symbol(s, x, y):
    s.wire([(x, y), (x, y + 12)], C["gnd"], 3)
    for i, w in enumerate((18, 12, 6)):
        s.wire([(x - w, y + 12 + i * 5), (x + w, y + 12 + i * 5)], C["gnd"], 2.5)

def legend(s, x, y, items):
    s.text(x, y, "Wire colours", 14, weight=700, fill=C["muted"])
    for i, (col, t, dash) in enumerate(items):
        yy = y + 24 + i * 24
        s.wire([(x, yy), (x + 42, yy)], col, 4, dash)
        s.text(x + 54, yy + 5, t, 14)

def notes(s, x, y, w, title, lines):
    h = 44 + 26 * len(lines)
    s.rect(x, y, w, h, fill=C["panel"], stroke=C["line"], sw=1.5)
    s.text(x + 20, y + 30, title, 16, weight=700)
    for i, t in enumerate(lines):
        s.text(x + 20, y + 58 + i * 26, "•  " + t, 14.5)

def esp32_block(s, x, y, w, h, pins_right, usb=True, title="ESP32 DevKit V1"):
    s.rect(x, y, w, h, fill="#2a2733", stroke=C["esp"], sw=2, r=12)
    s.rect(x + 20, y + 18, w * 0.5, 64, fill="#c9ccd3", stroke="#9aa0aa", sw=1.5, r=4)
    s.text(x + 20 + w * 0.25, y + 56, "ESP-WROOM-32", 13, fill="#2a2733", weight=600, anchor="middle")
    s.text(x + 20, y + 112, title, 19, fill="#ffffff", weight=700)
    s.text(x + 20, y + 136, "Bluetooth LE ↔ PinVisual app", 13, fill="#c9c3e6")
    # pins on the right edge (white area strip)
    s.rect(x + w - 150, y + 150, 150, 60 + 46 * len(pins_right), fill="#ffffff", stroke=C["esp"], sw=0, r=0)
    out = {}
    for i, (name, col) in enumerate(pins_right):
        py = y + 180 + i * 46
        s.pin(x + w, py, name, "right", col)
        out[name] = (x + w, py)
    if usb:
        s.rect(x + w / 2 - 34, y + h - 4, 68, 26, fill="#c9ccd3", stroke="#7d828c", sw=2, r=4)
        s.text(x + w / 2 + 50, y + h + 46, "Micro-USB: power + programming", 13, fill=C["muted"], anchor="start")
    return out

def servo(s, x, y, w=320, h=220, title="SG90 servo", sub=""):
    s.rect(x, y, w, h, fill="#2f6fe0", stroke="#1c4ea8", sw=2, r=10)
    s.add(f'<circle cx="{x + w - 60}" cy="{y + 50}" r="30" fill="#5e8ff0" stroke="#1c4ea8" stroke-width="2"/>')
    s.add(f'<rect x="{x + w - 64}" y="{y + 8}" width="8" height="44" rx="3" fill="#ffffff"/>')
    s.text(x + 18, y + 40, title, 19, fill="#ffffff", weight=700)
    if sub: s.text(x + 18, y + 64, sub, 13, fill="#dfe8ff")
    return {"sig": (x, y + 95), "v": (x, y + 141), "g": (x, y + 187)}

# =====================================================================
# 1) SINGLE SERVO — direct drive from GPIO 18 (PV_SERVO_BOARDS 0)
# =====================================================================
def single():
    s = SVG(1700, 1060)
    s.text(60, 70, "PinVisual — single-servo test circuit", 32, weight=800)
    s.text(60, 104, "One pin, servo driven straight from the ESP32 (no PCA9685).  Firmware: PV_SERVO_BOARDS 0 · PV_DIRECT_PIN 0 · PV_DIRECT_GPIO 18", 16, fill=C["muted"])
    p = esp32_block(s, 120, 190, 430, 470, [("D18 (GPIO 18)", C["pwm"]), ("VIN (5V)", C["v5"]), ("GND", C["gnd"])])
    sv = servo(s, 1180, 275, sub="pin 0 · row 1, column 1")
    # servo leads (inside: labels)
    for k, col, t in (("sig", C["pwm"], "orange — signal"), ("v", C["v5"], "red — +5 V"), ("g", C["brown"], "brown — GND")):
        x, y = sv[k]; s.wire([(x - 40, y), (x, y)], col, 5); s.text(x + 14, y + 5, t, 14, fill="#ffffff", weight=600)
    # D18 -> signal
    x0, y0 = p["D18 (GPIO 18)"]; xs, ys = sv["sig"]
    s.wire([(x0, y0), (760, y0), (760, ys), (xs - 40, ys)], C["pwm"])
    s.label_on_wire(660, y0, "PWM 50 Hz", C["pwm"])
    # VIN -> +5V
    x1, y1 = p["VIN (5V)"]; xv, yv = sv["v"]
    s.wire([(x1, y1), (820, y1), (820, yv), (xv - 40, yv)], C["v5"])
    s.label_on_wire(660, y1, "+5 V from USB", C["v5"])
    # GND -> GND
    x2, y2 = p["GND"]; xg, yg = sv["g"]
    s.wire([(x2, y2), (880, y2), (880, yg), (xg - 40, yg)], C["gnd"])
    s.label_on_wire(660, y2, "GND", C["gnd"])
    # optional bulk cap across servo supply
    cx = 1130
    capacitor(s, cx, yv, yg)
    s.text(cx - 20, yg - 64, "470 µF 10 V (optional)", 13, fill=C["muted"], anchor="end")
    # optional external 5V supply (pins on its top edge, joins the rails from below)
    bx, by = 860, 690
    s.rect(bx, by, 380, 130, fill="#fff8f6", stroke=C["v5"], sw=2, r=10, dash="8 6")
    s.add(f'<rect x="{bx+60-6}" y="{by-6}" width="12" height="12" fill="#fff" stroke="{C["ink"]}" stroke-width="2"/>')
    s.add(f'<rect x="{bx+200-6}" y="{by-6}" width="12" height="12" fill="#fff" stroke="{C["ink"]}" stroke-width="2"/>')
    s.text(bx + 60, by + 30, "−", 16, weight=700, anchor="middle"); s.text(bx + 200, by + 30, "+5 V", 14, weight=700, anchor="middle")
    s.text(bx + 20, by + 68, "Optional: separate 5 V supply", 16, weight=700, fill=C["v5"])
    s.text(bx + 20, by + 92, "Use if the ESP32 resets when the servo moves;", 13, fill=C["muted"])
    s.text(bx + 20, by + 112, "then remove the VIN → red link.", 13, fill=C["muted"])
    s.wire([(bx + 60, by), (bx + 60, yg)], C["gnd"], 3, "9 7"); s.dot(bx + 60, yg, C["gnd"], 5)
    s.wire([(bx + 200, by), (bx + 200, yv)], C["v5"], 3, "9 7"); s.dot(bx + 200, yv, C["v5"], 5)
    # USB source
    s.rect(225, 760, 220, 60, fill=C["panel"], stroke=C["line"], sw=1.5)
    s.text(335, 797, "Laptop / 5 V USB adapter", 14, anchor="middle", weight=600)
    s.wire([(335, 680), (335, 760)], C["ink"], 3)
    legend(s, 1300, 760, [(C["v5"], "+5 V", None), (C["gnd"], "GND (shared)", None), (C["pwm"], "Servo signal (PWM)", None), (C["v5"], "Optional", "9 7")])
    notes(s, 60, 880 - 0, 600, "Rules", [
        "Never power a servo from the ESP32's 3V3 pin.",
        "VIN carries the USB 5 V: fine for one SG90 at a time.",
        "With a separate supply, its − must join the ESP32 GND.",
    ])
    s.text(1640, 1030, "Matches firmware/README.md · Testing with one servo", 13, fill=C["muted"], anchor="end")
    s.save("PinVisual_circuit_single_servo.svg")

# =====================================================================
# 2) FULL 30-SERVO CIRCUIT — 2 × PCA9685 on I2C
# =====================================================================
def full():
    W, H = 2700, 2120
    s = SVG(W, H)
    s.text(60, 72, "PinVisual — 30-servo circuit (5 × 6 display)", 34, weight=800)
    s.text(60, 108, "ESP32 drives two PCA9685 16-channel servo boards over I²C; the servos take power from the boards' V+ terminals.  Firmware: PV_SERVO_BOARDS 1 · SDA 21 · SCL 22 · 0x40 / 0x41", 16, fill=C["muted"])
    # ESP32
    p = esp32_block(s, 80, 220, 420, 470, [("3V3", C["v33"]), ("GND", C["gnd"]), ("GPIO21 SDA", C["sda"]), ("GPIO22 SCL", C["scl"])])
    s.rect(140, 780, 300, 60, fill=C["panel"], stroke=C["line"], sw=1.5)
    s.text(290, 816, "USB 5 V (or supply 5 V → VIN)", 14, anchor="middle", weight=600)
    s.wire([(290, 710), (290, 780)], C["ink"], 3)

    def pca(x, y, title, addr, used):
        w, h = 400, 760
        s.rect(x, y, w, h, fill=C["pca"], stroke="#0f5530", sw=2, r=12)
        s.text(x + 24, y + 42, title, 21, fill="#ffffff", weight=800)
        s.text(x + 24, y + 68, addr, 14, fill="#d5f0de")
        s.rect(x + 130, y + 520, 100, 100, fill="#141414", stroke="#000", sw=1, r=4)
        s.text(x + 180, y + 576, "PCA9685", 13, fill="#cfcfcf", anchor="middle", weight=600)
        # logic header (left)
        names = [("GND", C["gnd"]), ("OE", None), ("SCL", C["scl"]), ("SDA", C["sda"]), ("VCC", C["v33"]), ("V+", None)]
        lp = {}
        s.rect(x, y + 120, 110, 6 * 40 + 20, fill="#ffffff", stroke="#0f5530", sw=0, r=0)
        for i, (n, col) in enumerate(names):
            py = y + 145 + i * 40
            s.pin(x, py, n, "left", col, 14)
            lp[n] = (x, py)
        # V+ screw terminal (top)
        s.rect(x + 210, y - 34, 130, 50, fill="#2a7fd8", stroke="#174f8a", sw=2, r=6)
        s.text(x + 245, y - 2, "GND", 15, fill="#fff", weight=700, anchor="middle"); s.text(x + 305, y - 2, "V+", 15, fill="#fff", weight=700, anchor="middle")
        term = {"GND": (x + 245, y - 34), "V+": (x + 305, y - 34)}
        # channel headers (right)
        s.rect(x + w - 150, y + 100, 150, h - 120, fill="#ffffff", stroke="#0f5530", sw=0, r=0)
        ch = {}
        for i in range(16):
            py = y + 122 + i * 38
            col = C["pwm"] if i < used else "#bdbdbd"
            s.pin(x + w, py, f"CH{i:<2}", "right", col, 14)
            ch[i] = (x + w, py)
        return lp, term, ch

    ax, ay = 800, 260
    lp1, t1, ch1 = pca(ax, ay, "PCA9685 #1", "address 0x40 · A0–A5 pads open", 16)
    bx, by = 800, 1180
    lp2, t2, ch2 = pca(bx, by, "PCA9685 #2", "address 0x41 · bridge A0 pad", 14)

    # I2C + logic power from ESP32 to board 1, then chained to board 2
    bus = [("3V3", "VCC", C["v33"], 650), ("GND", "GND", C["gnd"], 670), ("GPIO21 SDA", "SDA", C["sda"], 690), ("GPIO22 SCL", "SCL", C["scl"], 710)]
    for ep, bp, col, xm in bus:
        x0, y0 = p[ep]; x1, y1 = lp1[bp]; x2, y2 = lp2[bp]
        s.wire([(x0, y0), (xm, y0), (xm, y1), (x1, y1)], col)
        s.wire([(xm, y1), (xm, y2), (x2, y2)], col)
        s.dot(xm, y1, col, 5)
    s.label_on_wire(575, p["GPIO21 SDA"][1], "SDA", C["sda"]); s.label_on_wire(575, p["GPIO22 SCL"][1], "SCL", C["scl"])
    s.label_on_wire(575, p["3V3"][1], "3.3 V", C["v33"]); s.label_on_wire(575, p["GND"][1], "GND", C["gnd"])
    for lp in (lp1, lp2):
        s.text(lp["GND"][0] + 20, lp["V+"][1] + 66, "OE and header V+:", 13, fill="#d5f0de")
        s.text(lp["GND"][0] + 20, lp["V+"][1] + 84, "leave unconnected", 13, fill="#d5f0de")

    # Power supply
    px, py0 = 80, 1300
    s.rect(px, py0, 440, 230, fill="#e9ebef", stroke="#7d828c", sw=2, r=12)
    s.text(px + 24, py0 + 44, "5 V servo supply", 21, weight=800)
    s.text(px + 24, py0 + 72, "≥ 5 A (e.g. 5 V 6 A DC adapter)", 15, fill=C["muted"])
    s.text(px + 24, py0 + 96, "SG90 ≈ 0.7 A each while moving;", 13, fill=C["muted"])
    s.text(px + 24, py0 + 116, "firmware moves 6 at a time → ≈ 4.2 A peak", 13, fill=C["muted"])
    s.pin(px + 440, py0 + 160, "+5 V", "right", C["v5"]); s.pin(px + 440, py0 + 200, "−", "right", C["gnd"])
    vp, vm = (px + 440, py0 + 160), (px + 440, py0 + 200)
    # power: down from the supply, along the bottom, up the right side, into each screw terminal (no crossings with logic)
    XV, XG, YB_V, YB_G = 1640, 1610, 2060, 2085
    s.wire([vp, (560, vp[1]), (560, YB_V), (XV, YB_V), (XV, 140), (t1["V+"][0], 140), t1["V+"]], C["v5"], 6)
    s.wire([(XV, 1060), (t2["V+"][0], 1060), t2["V+"]], C["v5"], 6); s.dot(XV, 1060, C["v5"], 7)
    s.wire([vm, (540, vm[1]), (540, YB_G), (XG, YB_G), (XG, 200), (t1["GND"][0], 200), t1["GND"]], C["gnd"], 6)
    s.wire([(XG, 1120), (t2["GND"][0], 1120), t2["GND"]], C["gnd"], 6); s.dot(XG, 1120, C["gnd"], 7)
    s.label_on_wire(1250, 140, "+5 V servo power · 18 AWG", C["v5"]); s.label_on_wire(1250, 1060, "+5 V, separate run", C["v5"])
    s.label_on_wire(1100, YB_V, "+5 V", C["v5"]); s.label_on_wire(1100, YB_G, "GND", C["gnd"])
    capacitor(s, 1500, 140, 200); capacitor(s, 1500, 1060, 1120)
    s.text(1480, 178, "1000 µF 10 V", 13, fill=C["muted"], anchor="end")
    s.text(1480, 1098, "1000 µF 10 V", 13, fill=C["muted"], anchor="end")

    # Servos: each channel -> labelled servo plug
    def servo_row(chs, start, board_addr, y_off):
        for i, (cx, cy) in chs.items():
            pidx = start + i
            if pidx >= 30:
                s.text(cx + 30, cy + 5, "spare", 13, fill="#9a9a9a")
                continue
            r, c = divmod(pidx, 6)
            for k, col in enumerate((C["pwm"], C["v5"], C["brown"])):
                s.wire([(cx, cy - 4 + k * 4), (cx + 170, cy - 4 + k * 4)], col, 2)
            sx = cx + 170
            s.rect(sx, cy - 14, 120, 28, fill="#2f6fe0", stroke="#1c4ea8", sw=1.5, r=5)
            s.text(sx + 60, cy + 5, f"P{pidx} · R{r+1}C{c+1}", 13, fill="#fff", weight=600, anchor="middle")
    servo_row(ch1, 0, 0x40, 0)
    servo_row({i: v for i, v in ch2.items()}, 16, 0x41, 0)
    s.text(1370, 245, "SG90 servos 0–15", 15, weight=700, anchor="middle")
    s.text(1370, 1165, "SG90 servos 16–29", 15, weight=700, anchor="middle")
    s.text(1370, 2010, "Each plug: orange = PWM, red = V+, brown = GND", 13, fill=C["muted"], anchor="middle")

    # Grid map
    gx, gy, cs = 1740, 300, 150
    s.text(gx, gy - 40, "Which servo is which pin (looking at the display from the user's side)", 17, weight=700)
    for r in range(5):
        s.text(gx - 16, gy + r * 110 + 62, f"R{r+1}", 15, weight=700, anchor="end", fill=C["muted"])
        for c in range(6):
            i = r * 6 + c
            brd = 0 if i < 16 else 1
            fill = "#e7ddff" if brd == 0 else "#d6f1ee"
            stroke = C["accent"] if brd == 0 else C["teal"]
            x, y = gx + c * cs, gy + r * 110
            s.rect(x, y, cs - 12, 96, fill=fill, stroke=stroke, sw=2, r=10)
            s.text(x + (cs - 12) / 2, y + 40, f"P{i}", 22, weight=800, anchor="middle")
            s.text(x + (cs - 12) / 2, y + 66, f"0x{0x40+brd:02X} · CH{i % 16}", 14, anchor="middle", font=MONO, fill=C["muted"])
    for c in range(6):
        s.text(gx + c * cs + (cs - 12) / 2, gy - 12, f"C{c+1}", 15, weight=700, anchor="middle", fill=C["muted"])
    s.rect(gx, gy + 560, 24, 24, fill="#e7ddff", stroke=C["accent"], sw=2, r=5); s.text(gx + 34, gy + 578, "Board #1 (0x40): P0–P15", 14)
    s.rect(gx + 330, gy + 560, 24, 24, fill="#d6f1ee", stroke=C["teal"], sw=2, r=5); s.text(gx + 364, gy + 578, "Board #2 (0x41): P16–P29, CH14–15 spare", 14)

    legend(s, 1740, 1020, [(C["v5"], "+5 V servo power", None), (C["gnd"], "GND (common)", None), (C["v33"], "3.3 V logic (VCC)", None),
                          (C["sda"], "I²C SDA (GPIO21)", None), (C["scl"], "I²C SCL (GPIO22)", None), (C["pwm"], "Servo PWM", None)])
    notes(s, 1740, 1230, 900, "Rules", [
        "Servo power goes only into each board's V+ screw terminal, never through the ESP32.",
        "Run separate +5 V / GND wires from the supply to each board (star wiring), 18 AWG.",
        "Every GND is common: supply −, both boards and the ESP32.",
        "VCC (board logic) comes from the ESP32's 3V3 pin, not from the 5 V supply.",
        "Board #2 needs its A0 address pad bridged with solder (0x41).",
        "Pin i → board i ÷ 16, channel i mod 16 (firmware/README.md).",
        "Board #2 takes the same 4 logic wires (I²C daisy-chain).",
        "Wires that cross without a dot are not connected.",
    ])
    s.text(W - 60, H - 30, "Matches firmware/pinvisual-esp32/config.h and firmware/README.md · Planned wiring, not yet built on hardware", 13, fill=C["muted"], anchor="end")
    s.save("PinVisual_circuit_30_servos.svg")

if __name__ == "__main__":
    single(); full(); print("ok")
