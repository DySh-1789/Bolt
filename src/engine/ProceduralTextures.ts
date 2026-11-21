import * as THREE from 'three';

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context for procedural texture');
  }
  return [canvas, ctx];
}

export class ProceduralTextures {
  private cache = new Map<string, THREE.CanvasTexture>();

  private register(key: string, canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    this.cache.set(key, tex);
    return tex;
  }

  getFloorTile(accentColor = '#ff003c', repeatX = 10, repeatY = 12): THREE.CanvasTexture {
    const key = `floor_${accentColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    ctx.fillStyle = '#192033';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle brushed corporate marble veins
    for (let i = 0; i < 65; i++) {
      ctx.strokeStyle = `rgba(165, 195, 240, ${0.05 + (i % 4) * 0.02})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      const x = (i * 73) % 512;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 40, 170, x - 35, 340, (x + 25) % 512, 512);
      ctx.stroke();
    }

    // Tile bevels
    ctx.strokeStyle = '#313d59';
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 2, 508, 508);
    ctx.strokeStyle = '#252f47';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.stroke();

    // Accent corner node
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(248, 248, 16, 16);
    ctx.globalAlpha = 1;

    return this.register(key, canvas, repeatX, repeatY);
  }

  getWallPanel(stripeColor = '#ff003c', repeatX = 6, repeatY = 2): THREE.CanvasTexture {
    const key = `wall_${stripeColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#20283d');
    grad.addColorStop(0.5, '#2b3650');
    grad.addColorStop(1, '#182032');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Metallic armor seams
    ctx.strokeStyle = '#435275';
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, 488, 488);
    ctx.strokeStyle = '#121826';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, 500);
    ctx.moveTo(12, 370);
    ctx.lineTo(500, 370);
    ctx.stroke();

    // Glowing architectural stripe near bottom
    ctx.fillStyle = stripeColor;
    ctx.fillRect(16, 420, 480, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(16, 420, 480, 4);

    // Micro-bolts
    ctx.fillStyle = '#5a6c96';
    for (const bx of [28, 240, 272, 484]) {
      for (const by of [28, 354, 484]) {
        ctx.fillRect(bx - 3, by - 3, 6, 6);
      }
    }

    return this.register(key, canvas, repeatX, repeatY);
  }

  getServerRack(): THREE.CanvasTexture {
    const key = 'server_rack';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(256, 512);
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, 256, 512);

    ctx.strokeStyle = '#252f45';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 504);

    for (let row = 0; row < 16; row++) {
      const y = 18 + row * 30;
      ctx.fillStyle = '#121826';
      ctx.fillRect(16, y, 224, 22);
      // Vent slits
      ctx.fillStyle = '#070910';
      for (let v = 0; v < 8; v++) {
        ctx.fillRect(24 + v * 16, y + 6, 10, 10);
      }
      // Glowing telemetry LEDs
      for (let led = 0; led < 4; led++) {
        const hash = (row * 13 + led * 7) % 11;
        if (hash < 4) ctx.fillStyle = '#00f0ff';
        else if (hash < 7) ctx.fillStyle = '#ff003c';
        else if (hash === 7) ctx.fillStyle = '#fcee0a';
        else ctx.fillStyle = '#1e283b';
        ctx.fillRect(168 + led * 16, y + 7, 9, 8);
      }
    }

    return this.register(key, canvas, 1, 1);
  }

  getNeonSign(
    title: string,
    subtitle: string,
    primaryColor = '#ff003c',
    secondaryColor = '#00f0ff',
    bg = '#070810',
  ): THREE.CanvasTexture {
    const key = `sign_${title}_${subtitle}_${primaryColor}_${secondaryColor}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 256);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 256);

    // Scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 256; y += 6) {
      ctx.fillRect(0, y, 1024, 2);
    }

    // Angled cyberpunk frame
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(28, 16);
    ctx.lineTo(1008, 16);
    ctx.lineTo(1008, 212);
    ctx.lineTo(976, 240);
    ctx.lineTo(16, 240);
    ctx.lineTo(16, 44);
    ctx.closePath();
    ctx.stroke();

    // Accent bar
    ctx.fillStyle = primaryColor;
    ctx.fillRect(42, 42, 14, 170);

    // Main title
    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 72px "Segoe UI", Impact, "Arial Black", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 82, 106);
    ctx.restore();

    // Subtitle
    ctx.save();
    ctx.shadowColor = secondaryColor;
    ctx.shadowBlur = 14;
    ctx.fillStyle = secondaryColor;
    ctx.font = '700 32px "Consolas", "Courier New", monospace';
    ctx.fillText(subtitle, 84, 184);
    ctx.restore();

    // Tech barcode block on right
    ctx.fillStyle = primaryColor;
    for (let i = 0; i < 12; i++) {
      const w = i % 3 === 0 ? 8 : 4;
      ctx.fillRect(880 + i * 9, 44, w, 46);
    }

    return this.register(key, canvas, 1, 1);
  }

  getCitySkyline(): THREE.CanvasTexture {
    const key = 'city_skyline';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 512);
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#040610');
    sky.addColorStop(0.55, '#120821');
    sky.addColorStop(0.85, '#2b0922');
    sky.addColorStop(1, '#4a0c26');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    // Distant megastructures
    const buildings = [
      { x: 20, w: 90, h: 310, color: '#090b16', neon: '#ff003c' },
      { x: 120, w: 70, h: 250, color: '#0b0e1c', neon: '#00f0ff' },
      { x: 200, w: 125, h: 390, color: '#070912', neon: '#fcee0a' },
      { x: 340, w: 85, h: 290, color: '#0a0d1a', neon: '#ff003c' },
      { x: 440, w: 150, h: 430, color: '#060811', neon: '#00f0ff' },
      { x: 605, w: 100, h: 320, color: '#090c17', neon: '#ff003c' },
      { x: 720, w: 130, h: 380, color: '#080b14', neon: '#fcee0a' },
      { x: 865, w: 135, h: 350, color: '#070a13', neon: '#00f0ff' },
    ];

    for (const b of buildings) {
      const y = 512 - b.h;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, y, b.w, b.h);

      // Vertical neon strip
      ctx.fillStyle = b.neon;
      ctx.fillRect(b.x + 6, y + 12, 4, b.h - 40);
      ctx.fillRect(b.x + b.w - 10, y + 12, 4, 55);

      // Lit windows
      for (let wy = y + 26; wy < 490; wy += 16) {
        for (let wx = b.x + 18; wx < b.x + b.w - 18; wx += 14) {
          const hash = (wx * 17 + wy * 31) % 19;
          if (hash < 4) {
            ctx.fillStyle = hash === 0 ? b.neon : 'rgba(200, 230, 255, 0.45)';
            ctx.fillRect(wx, wy, 7, 6);
          }
        }
      }
    }

    // Horizon red haze
    const haze = ctx.createLinearGradient(0, 360, 0, 512);
    haze.addColorStop(0, 'rgba(255,0,60,0)');
    haze.addColorStop(1, 'rgba(255,0,60,0.35)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 360, 1024, 152);

    return this.register(key, canvas, 1, 1);
  }

  getMedicalMonitor(mode: 'ecg' | 'soulkiller'): THREE.CanvasTexture {
    const key = `monitor_${mode}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 256);
    ctx.fillStyle = '#040a10';
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = mode === 'ecg' ? '#00f0ff' : '#ff003c';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    // Grid
    ctx.strokeStyle = mode === 'ecg' ? 'rgba(0, 240, 255, 0.14)' : 'rgba(255, 0, 60, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 24; x < 512; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, 248);
      ctx.stroke();
    }
    for (let y = 24; y < 256; y += 24) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(504, y);
      ctx.stroke();
    }

    if (mode === 'ecg') {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 22px monospace';
      ctx.fillText('SUBJECT: SAMIR // TRAUMA LEVEL: CRITICAL', 20, 36);
      ctx.fillStyle = '#ff003c';
      ctx.fillText('HR: 48 BPM   NEURAL SYNC: LOCKED', 20, 232);

      // Heartbeat trace
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(20, 140);
      ctx.lineTo(130, 140);
      ctx.lineTo(148, 120);
      ctx.lineTo(164, 155);
      ctx.lineTo(182, 58);
      ctx.lineTo(198, 195);
      ctx.lineTo(216, 140);
      ctx.lineTo(350, 140);
      ctx.lineTo(368, 120);
      ctx.lineTo(384, 155);
      ctx.lineTo(402, 58);
      ctx.lineTo(418, 195);
      ctx.lineTo(436, 140);
      ctx.lineTo(492, 140);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ff003c';
      ctx.font = '900 32px monospace';
      ctx.fillText('SOULKILLER v4.2', 24, 48);
      ctx.fillStyle = '#fcee0a';
      ctx.font = '700 20px monospace';
      ctx.fillText('OPERATOR: RODION // MARAKULIN CORP', 24, 84);
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 18px monospace';
      ctx.fillText('TARGET ENGRAM: SAMIR', 24, 122);
      ctx.fillText('PROTOCOL: FULL CONSCIOUSNESS EXTRACTION', 24, 152);
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(24, 182, 464, 28);
      ctx.fillStyle = '#040a10';
      ctx.font = '900 18px monospace';
      ctx.fillText('>>> READY TO INITIATE NEURAL RIP <<<', 52, 202);
    }

    return this.register(key, canvas, 1, 1);
  }

  dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
  }
}
