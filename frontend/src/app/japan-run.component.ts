import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

const CW = 800, CH = 450;
const BASE_SPD = 5;           // km/s both characters
const BOOST_SPD = 6;          // km/s Deku boost
const TOTAL_KM = 1000;
const BOOST_DURATION = 180;   // frames
const BOOST_COOLDOWN = 360;   // frames
const PUNCH_RANGE = 120;      // px gap to allow punch
const BOSS_PUNCHES = 3;

type Phase = 'start' | 'run' | 'boss' | 'win' | 'lose';
type BossState = 'idle' | 'attack' | 'stagger' | 'dead';
type Biome = 'tokyo' | 'fuji' | 'kyoto' | 'countryside' | 'osaka' | 'finish';

const BIOMES: { name: Biome; label: string; km: [number, number]; hillAmp: number }[] = [
  { name: 'tokyo',       label: '🏙️ Tokyo',          km: [0, 180],    hillAmp: 8  },
  { name: 'fuji',        label: '🗻 Mt. Fuji',        km: [180, 380],  hillAmp: 70 },
  { name: 'kyoto',       label: '⛩️ Kyoto',           km: [380, 550],  hillAmp: 25 },
  { name: 'countryside', label: '🌾 Countryside',     km: [550, 720],  hillAmp: 40 },
  { name: 'osaka',       label: '🏯 Osaka',           km: [720, 900],  hillAmp: 12 },
  { name: 'finish',      label: '🎌 Final Showdown',  km: [900, 1000], hillAmp: 5  },
];

interface Particle {
  x: number; y: number; vx: number; vy: number; alpha: number; c: string; r: number; life: number;
}
interface CherryPetal {
  x: number; y: number; vx: number; vy: number; rot: number; rotV: number; alpha: number; size: number;
}

@Component({
  selector: 'app-japan-run',
  standalone: true,
  imports: [],
  templateUrl: './japan-run.component.html',
  styleUrl: './japan-run.component.css'
})
export class JapanRunComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  phase: Phase = 'start';
  km = 0;
  keys = new Set<string>();

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private lastTs = 0;
  private animT = 0;

  // Deku
  private dekuX = 200;
  private dekuY = CH - 120;
  private dekuGY = CH - 120;
  private dekuVy = 0;
  private dekuAir = false;
  private dekuJumpWas = false;
  private dekuJumps = 0;
  private boostFrames = 0;
  private boostCooldown = 0;
  private dekuSpd = BASE_SPD;

  // Shigaraki
  private shigX = 380;
  private shigY = CH - 120;
  private shigGY = CH - 120;
  private shigSpd = BASE_SPD;

  // Boss fight
  bossState: BossState = 'idle';
  bossHits = 0;
  private bossTimer = 0;
  private bossAttackCooldown = 0;
  private playerHP = 3;
  private punchWas = false;
  private playerHitTimer = 0;

  // World
  private worldX = 0;
  private bgOff = 0;
  private mgOff = 0;
  private terrain: { x: number; y: number }[] = [];
  private terrainWX = 0;
  private particles: Particle[] = [];
  private petals: CherryPetal[] = [];
  private touchJump = false;
  private touchPunch = false;
  private touchBoost = false;

  get currentBiome(): typeof BIOMES[0] {
    return BIOMES.find(b => this.km >= b.km[0] && this.km < b.km[1]) ?? BIOMES[BIOMES.length - 1];
  }

  get boosting(): boolean { return this.boostFrames > 0; }
  get boostReady(): boolean { return this.boostCooldown <= 0; }
  get playerHPArr(): number[] { return Array.from({ length: this.playerHP }); }

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space', 'ArrowUp', 'KeyW', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)
      && this.phase === 'run') e.preventDefault();
    if (this.phase === 'start' && ['Space', 'Enter'].includes(e.code)) this.startGame();
    if (this.phase === 'win' && ['Space', 'Enter'].includes(e.code)) this.resetGame();
    if (this.phase === 'lose' && ['Space', 'Enter'].includes(e.code)) this.resetGame();
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.buildTerrain(0);
    this.drawFrame();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  pressJump()  { this.touchJump = true; }
  relJump()    { this.touchJump = false; }
  pressBoost() { this.touchBoost = true; }
  relBoost()   { this.touchBoost = false; }
  pressPunch() { this.touchPunch = true; }
  relPunch()   { this.touchPunch = false; }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.phase = 'run';
    this.km = 0; this.worldX = 0; this.animT = 0; this.bgOff = 0; this.mgOff = 0;
    this.dekuX = 200; this.dekuY = CH - 120; this.dekuVy = 0; this.dekuAir = false;
    this.dekuJumps = 0; this.dekuJumpWas = false;
    this.boostFrames = 0; this.boostCooldown = 0; this.dekuSpd = BASE_SPD;
    this.shigX = 380; this.shigY = CH - 120; this.shigSpd = BASE_SPD;
    this.bossState = 'idle'; this.bossHits = 0; this.bossTimer = 0;
    this.bossAttackCooldown = 120; this.playerHP = 3; this.punchWas = false; this.playerHitTimer = 0;
    this.particles = []; this.petals = [];
    this.terrain = []; this.terrainWX = 0;
    this.buildTerrain(0);
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  resetGame() { this.phase = 'start'; cancelAnimationFrame(this.raf); this.drawFrame(); }

  private buildTerrain(startWX: number) {
    const count = Math.ceil((CW + 300) / 4) + 4;
    for (let i = 0; i < count; i++) {
      const wx = startWX + i * 4;
      this.terrain.push({ x: wx - startWX, y: this.terrainY(wx) });
    }
    this.terrainWX = startWX + (count - 1) * 4;
  }

  private terrainY(wx: number): number {
    const kmX = wx / (1000000 / TOTAL_KM);
    const biome = BIOMES.find(b => kmX >= b.km[0] && kmX < b.km[1]) ?? BIOMES[BIOMES.length - 1];
    const amp = biome.hillAmp;
    return (CH - 90)
      - amp * Math.sin(wx / 800)
      - 15 * Math.sin(wx / 190 + 1.2)
      - 5 * Math.sin(wx / 60 + 0.7);
  }

  private scrollTerrain(spd: number) {
    for (const p of this.terrain) p.x -= spd;
    while (this.terrain.length > 0 && this.terrain[0].x < -50) this.terrain.shift();
    while (this.terrainWX < this.worldX + CW + 300) {
      this.terrainWX += 4;
      this.terrain.push({ x: this.terrainWX - this.worldX, y: this.terrainY(this.terrainWX) });
    }
  }

  private getGroundAt(screenX: number): number {
    const idx = this.terrain.findIndex(p => p.x >= screenX);
    if (idx <= 0) return CH - 100;
    const a = this.terrain[idx - 1], b = this.terrain[idx];
    const t = (screenX - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    if (this.phase === 'run') this.updateRun(dt);
    else if (this.phase === 'boss') this.updateBoss(dt);
    this.drawFrame();
    if (this.phase === 'run' || this.phase === 'boss')
      this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ── Run phase ─────────────────────────────────────────────────────────────

  private updateRun(dt: number) {
    this.animT += dt;

    // Boost activation
    const wantBoost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost;
    if (wantBoost && this.boostCooldown <= 0 && this.boostFrames <= 0) {
      this.boostFrames = BOOST_DURATION;
      this.boostCooldown = BOOST_COOLDOWN;
    }
    if (this.boostFrames > 0) { this.boostFrames -= dt; this.dekuSpd = BOOST_SPD; }
    else { this.dekuSpd = BASE_SPD; }
    if (this.boostCooldown > 0) this.boostCooldown -= dt;

    // Scroll
    const scroll = this.dekuSpd;
    this.scrollTerrain(scroll);
    this.worldX += scroll;
    this.bgOff += scroll * 0.15;
    this.mgOff += scroll * 0.4;

    // Ground
    this.dekuGY = this.getGroundAt(this.dekuX);
    this.shigGY = this.getGroundAt(this.shigX);

    // Deku jump
    const wantJump = this.keys.has('Space') || this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touchJump;
    const justJump = wantJump && !this.dekuJumpWas;
    if (justJump && this.dekuJumps < 2) { this.dekuVy = -13; this.dekuAir = true; this.dekuJumps++; }
    this.dekuJumpWas = wantJump;

    if (this.dekuAir) {
      this.dekuVy += 0.65 * dt;
      this.dekuY += this.dekuVy * dt;
      if (this.dekuY >= this.dekuGY) { this.dekuY = this.dekuGY; this.dekuVy = 0; this.dekuAir = false; this.dekuJumps = 0; }
    } else { this.dekuY = this.dekuGY; }

    // Shigaraki stays ahead — screen position drifts based on speed diff
    const gap = this.shigX - this.dekuX;
    // During boost Deku closes gap; normal = gap maintained at ~180px
    const targetGap = this.boosting ? 80 : 180;
    this.shigX += (targetGap - gap) * 0.02 * dt + (this.shigSpd - this.dekuSpd) * dt * 0.5;
    this.shigX = Math.max(this.dekuX + 40, Math.min(CW - 60, this.shigX));
    this.shigY = this.shigGY;

    // Green sparks while boosting
    if (this.boosting && Math.random() < 0.5) {
      this.particles.push({
        x: this.dekuX + (Math.random() - 0.5) * 30,
        y: this.dekuY - 40 + (Math.random() - 0.5) * 40,
        vx: -3 + (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 4,
        alpha: 1, c: Math.random() > 0.4 ? '#4ade80' : '#86efac', r: 2 + Math.random() * 3, life: 1
      });
    }

    // Punch during boost (Z or Ctrl)
    const wantPunch = this.keys.has('KeyZ') || this.keys.has('ControlLeft') || this.touchPunch;
    const justPunch = wantPunch && !this.punchWas;
    this.punchWas = wantPunch;
    if (justPunch && this.boosting && (this.shigX - this.dekuX) < PUNCH_RANGE) {
      this.spawnPunchEffect(this.shigX - 20, this.shigY - 40);
      this.shigX += 60; // knock back
    }

    // Cherry petals
    if (this.currentBiome.name === 'kyoto' && Math.random() < 0.15) this.spawnPetal();
    for (const p of this.petals) {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV; p.alpha -= 0.004;
      p.vy += 0.03; p.vx += Math.sin(this.animT * 0.05 + p.x) * 0.02;
    }
    this.petals = this.petals.filter(p => p.alpha > 0 && p.y < CH + 20);

    // Particles
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.1 * dt; p.alpha -= 0.03 * dt; p.life -= dt * 0.05;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);

    // Distance
    this.km = Math.min(TOTAL_KM, this.worldX / (1000000 / TOTAL_KM));
    if (this.km >= TOTAL_KM) { this.phase = 'boss'; this.shigX = CW - 120; this.dekuX = 120; }
  }

  // ── Boss phase ────────────────────────────────────────────────────────────

  private updateBoss(dt: number) {
    this.animT += dt;
    if (this.playerHitTimer > 0) this.playerHitTimer -= dt;

    // Punch input
    const wantPunch = this.keys.has('KeyZ') || this.keys.has('ControlLeft') || this.touchPunch;
    const justPunch = wantPunch && !this.punchWas;
    this.punchWas = wantPunch;

    if (this.bossState === 'idle') {
      this.bossAttackCooldown -= dt;
      if (justPunch && Math.abs(this.shigX - this.dekuX - 60) < 120) {
        this.bossHits++;
        this.bossState = 'stagger';
        this.bossTimer = 60;
        this.spawnPunchEffect(this.shigX - 10, this.shigY - 50);
        if (this.bossHits >= BOSS_PUNCHES) { this.bossState = 'dead'; this.phase = 'win'; }
      }
      if (this.bossAttackCooldown <= 0) {
        this.bossState = 'attack';
        this.bossTimer = 40;
        this.bossAttackCooldown = 150 + Math.random() * 100;
      }
    } else if (this.bossState === 'attack') {
      this.bossTimer -= dt;
      if (this.bossTimer <= 20 && this.playerHitTimer <= 0 && Math.abs(this.shigX - this.dekuX - 60) < 130) {
        this.playerHP--;
        this.playerHitTimer = 80;
        this.spawnHitEffect(this.dekuX, this.dekuY - 40);
        if (this.playerHP <= 0) { this.phase = 'lose'; }
      }
      if (this.bossTimer <= 0) this.bossState = 'idle';
    } else if (this.bossState === 'stagger') {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.bossState = 'idle';
    }

    // Boss movement
    const targetX = this.dekuX + 140;
    this.shigX += (targetX - this.shigX) * 0.04 * dt;

    // Particles
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.1 * dt; p.alpha -= 0.03 * dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);
  }

  private spawnPunchEffect(x: number, y: number) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.particles.push({
        x, y, vx: Math.cos(a) * (3 + Math.random() * 4),
        vy: Math.sin(a) * (3 + Math.random() * 4),
        alpha: 1, c: i % 2 === 0 ? '#4ade80' : '#fff', r: 3 + Math.random() * 4, life: 1
      });
    }
  }

  private spawnHitEffect(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 2,
        alpha: 1, c: '#f87171', r: 3 + Math.random() * 3, life: 1
      });
    }
  }

  private spawnPetal() {
    this.petals.push({
      x: Math.random() * CW, y: -10,
      vx: (Math.random() - 0.5) * 1.5 - 0.5,
      vy: 0.5 + Math.random() * 1,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.08,
      alpha: 0.7 + Math.random() * 0.3,
      size: 4 + Math.random() * 5
    });
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private drawFrame() {
    const c = this.ctx;
    const biome = this.currentBiome.name;

    if (this.phase === 'start') { this.drawStart(c); return; }
    if (this.phase === 'win')   { this.drawWin(c);   return; }
    if (this.phase === 'lose')  { this.drawLose(c);  return; }

    this.drawBg(c, biome);
    this.drawTerrain(c, biome);
    this.drawPetals(c);
    this.drawParticles(c);
    this.drawShigaraki(c);
    this.drawDeku(c);
    this.drawHUD(c);
  }

  // ── Background ────────────────────────────────────────────────────────────

  private drawBg(c: CanvasRenderingContext2D, biome: string) {
    // Sky gradient per biome
    const skies: Record<string, [string, string]> = {
      tokyo:       ['#1a1a2e', '#e94560'],
      fuji:        ['#0f3460', '#b2dfdb'],
      kyoto:       ['#fce4ec', '#f48fb1'],
      countryside: ['#87ceeb', '#c8e6c9'],
      osaka:       ['#1a237e', '#e8eaf6'],
      finish:      ['#b71c1c', '#ff5722'],
    };
    const [s1, s2] = skies[biome] ?? ['#87ceeb', '#e0e0e0'];
    const sky = c.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, s1); sky.addColorStop(1, s2);
    c.fillStyle = sky; c.fillRect(0, 0, CW, CH);

    const bx = -(this.bgOff % (CW * 2));
    const mx = -(this.mgOff % (CW * 2));

    if (biome === 'tokyo') {
      this.drawAnimeCity(c, bx, 60, 280, true);
      this.drawAnimeCity(c, mx, 140, 180, false);
      // Neon signs
      this.drawNeon(c, mx);
    } else if (biome === 'fuji') {
      this.drawFuji(c, bx);
      this.drawPineForest(c, mx, 220, 40, 5);
    } else if (biome === 'kyoto') {
      this.drawKyotoSky(c, bx);
      this.drawPagoda(c, mx);
    } else if (biome === 'countryside') {
      this.drawCountryside(c, bx, mx);
    } else if (biome === 'osaka') {
      this.drawAnimeCity(c, bx, 80, 300, true);
      this.drawCastle(c, mx);
    } else if (biome === 'finish') {
      this.drawFinalArena(c, bx);
    }
  }

  private drawAnimeCity(c: CanvasRenderingContext2D, offX: number, minY: number, maxH: number, dark: boolean) {
    let bx = offX % 700;
    while (bx < CW + 150) {
      const w = 30 + Math.abs(Math.sin(bx * 0.3)) * 60;
      const h = maxH * 0.3 + Math.abs(Math.sin(bx * 0.17)) * maxH;
      const gr = dark ? Math.floor(20 + Math.abs(Math.sin(bx * 0.5)) * 40) : Math.floor(140 + Math.abs(Math.sin(bx * 0.5)) * 60);
      c.fillStyle = dark ? `rgb(${gr},${gr},${gr + 20})` : `rgb(${gr + 20},${gr},${gr + 30})`;
      c.fillRect(bx, minY - h, w, h + CH);
      // Windows — anime style (glowing)
      c.fillStyle = dark ? 'rgba(255,220,80,0.3)' : 'rgba(180,220,255,0.4)';
      for (let wy = minY - h + 8; wy < minY - 10; wy += 14)
        for (let wx = bx + 4; wx < bx + w - 4; wx += 10)
          c.fillRect(wx, wy, 6, 8);
      bx += w + 6;
    }
  }

  private drawNeon(c: CanvasRenderingContext2D, offX: number) {
    const signs = ['HERO', 'UA', '勝つ', '平和'];
    const cols = ['#f0f', '#0ff', '#ff0', '#f80'];
    for (let i = 0; i < 4; i++) {
      const sx = ((offX + i * 200) % (CW + 200));
      c.save();
      c.shadowColor = cols[i]; c.shadowBlur = 15;
      c.font = 'bold 14px sans-serif'; c.fillStyle = cols[i]; c.textAlign = 'center';
      c.fillText(signs[i], sx, 120 + i * 20);
      c.restore();
    }
  }

  private drawFuji(c: CanvasRenderingContext2D, offX: number) {
    const cx = (offX % (CW * 3)) + CW * 0.5;
    // Main body
    c.fillStyle = '#37474f';
    c.beginPath(); c.moveTo(cx - 260, CH); c.lineTo(cx, 60); c.lineTo(cx + 260, CH); c.closePath(); c.fill();
    // Snow cap
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(cx - 70, 140); c.lineTo(cx, 60); c.lineTo(cx + 70, 140);
    c.lineTo(cx + 50, 150); c.lineTo(cx - 50, 150); c.closePath(); c.fill();
    // Clouds
    for (let i = 0; i < 3; i++) {
      const ox = ((offX * 0.3 + i * 220) % (CW + 100));
      this.drawAnimeCloud(c, ox, 80 + i * 25);
    }
  }

  private drawAnimeCloud(c: CanvasRenderingContext2D, x: number, y: number) {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath(); c.arc(x, y, 22, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 25, y + 5, 18, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x - 20, y + 5, 16, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 5, y + 12, 20, 0, Math.PI * 2); c.fill();
  }

  private drawPineForest(c: CanvasRenderingContext2D, offX: number, baseY: number, size: number, n: number) {
    for (let i = 0; i < Math.ceil(CW / 50) + 2; i++) {
      const tx = ((offX + i * 50) % (CW + 60));
      c.fillStyle = '#1b5e20';
      c.beginPath(); c.moveTo(tx, baseY); c.lineTo(tx + size / 2, baseY - size * 1.5); c.lineTo(tx + size, baseY); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(tx + 5, baseY - size * 0.8); c.lineTo(tx + size / 2, baseY - size * 2.1); c.lineTo(tx + size - 5, baseY - size * 0.8); c.closePath(); c.fill();
    }
  }

  private drawKyotoSky(c: CanvasRenderingContext2D, offX: number) {
    // Cherry blossom trees silhouette
    for (let i = 0; i < 5; i++) {
      const tx = ((offX + i * 160) % (CW + 180));
      c.fillStyle = '#ad1457';
      c.fillRect(tx + 18, 200, 6, 80);
      c.beginPath(); c.arc(tx + 21, 195, 30, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e91e63';
      c.beginPath(); c.arc(tx + 5, 185, 20, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(tx + 38, 188, 18, 0, Math.PI * 2); c.fill();
    }
  }

  private drawPagoda(c: CanvasRenderingContext2D, offX: number) {
    const px = ((offX * 0.6 + CW * 0.6) % (CW + 120));
    const py = 160;
    // Floors
    const floors = [[60, 12], [50, 12], [40, 12], [30, 12]];
    c.fillStyle = '#b71c1c';
    floors.forEach(([w, h], i) => {
      const fy = py + i * (h + 4);
      c.fillRect(px - w / 2, fy, w, h);
      // Roof
      c.beginPath(); c.moveTo(px - w / 2 - 8, fy); c.lineTo(px, fy - 12); c.lineTo(px + w / 2 + 8, fy); c.closePath(); c.fill();
    });
    c.fillStyle = '#37474f'; c.fillRect(px - 4, py + floors.length * 16, 8, 80);
  }

  private drawCountryside(c: CanvasRenderingContext2D, bx: number, mx: number) {
    c.fillStyle = '#81c784'; c.fillRect(0, 220, CW, CH - 220);
    // Rice paddies
    c.fillStyle = 'rgba(100,180,220,0.35)';
    for (let rx = (mx % 120); rx < CW; rx += 120)
      c.fillRect(rx, 240, 100, 40);
    // Far hills
    c.fillStyle = '#388e3c';
    c.beginPath(); c.moveTo(0, CH);
    for (let x = bx; x < CW + 100; x += 1)
      c.lineTo(x, 230 - 50 * Math.sin((x - bx) / 280));
    c.lineTo(CW, CH); c.fill();
  }

  private drawCastle(c: CanvasRenderingContext2D, offX: number) {
    const cx = ((offX * 0.5 + CW * 0.7) % (CW + 160));
    // Osaka castle silhouette
    c.fillStyle = '#3949ab';
    c.fillRect(cx - 35, 160, 70, 120);
    c.fillRect(cx - 50, 200, 100, 80);
    c.beginPath(); c.moveTo(cx - 60, 200); c.lineTo(cx, 140); c.lineTo(cx + 60, 200); c.closePath(); c.fill();
    c.fillStyle = '#1a237e';
    c.beginPath(); c.moveTo(cx - 45, 160); c.lineTo(cx, 120); c.lineTo(cx + 45, 160); c.closePath(); c.fill();
    c.fillStyle = '#ffd54f';
    c.beginPath(); c.arc(cx, 117, 6, 0, Math.PI * 2); c.fill();
  }

  private drawFinalArena(c: CanvasRenderingContext2D, bx: number) {
    // Dramatic red sky with cracks
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, 0, CW, CH);
    c.strokeStyle = '#ff5722'; c.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const sx = (bx + i * 180) % CW;
      c.beginPath(); c.moveTo(sx, 0);
      c.lineTo(sx + 20, 80); c.lineTo(sx + 10, 160); c.lineTo(sx + 35, 240);
      c.stroke();
    }
  }

  // ── Terrain ───────────────────────────────────────────────────────────────

  private drawTerrain(c: CanvasRenderingContext2D, biome: string) {
    if (this.terrain.length < 2) return;
    const cols: Record<string, [string, string]> = {
      tokyo:       ['#546e7a', '#37474f'],
      fuji:        ['#4caf50', '#388e3c'],
      kyoto:       ['#66bb6a', '#43a047'],
      countryside: ['#81c784', '#66bb6a'],
      osaka:       ['#78909c', '#546e7a'],
      finish:      ['#b71c1c', '#7f0000'],
    };
    const [gc, gc2] = cols[biome] ?? ['#4caf50', '#388e3c'];
    c.fillStyle = gc;
    c.beginPath(); c.moveTo(this.terrain[0].x, CH);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.lineTo(this.terrain[this.terrain.length - 1].x, CH);
    c.closePath(); c.fill();
    c.strokeStyle = gc2; c.lineWidth = 3;
    c.beginPath(); c.moveTo(this.terrain[0].x, this.terrain[0].y);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.stroke();
  }

  private drawPetals(c: CanvasRenderingContext2D) {
    for (const p of this.petals) {
      c.save(); c.globalAlpha = p.alpha;
      c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = '#f48fb1';
      c.beginPath(); c.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      c.save(); c.globalAlpha = Math.max(0, p.alpha);
      c.shadowColor = p.c; c.shadowBlur = 8;
      c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  // ── Characters ────────────────────────────────────────────────────────────

  private drawDeku(c: CanvasRenderingContext2D) {
    const x = this.dekuX, y = this.dekuY;
    const t = this.animT;
    const boosting = this.boosting;
    const bossPhase = this.phase === 'boss';
    const hitFlash = this.playerHitTimer > 0 && Math.floor(this.playerHitTimer / 5) % 2 === 0;

    c.save();
    if (hitFlash) { c.globalAlpha = 0.4; }
    if (boosting || bossPhase) { c.shadowColor = '#4ade80'; c.shadowBlur = 25; }

    const run = Math.sin(t * 0.45);

    // Green lightning aura when boosting
    if (boosting) {
      c.strokeStyle = '#4ade80'; c.lineWidth = 1.5; c.globalAlpha = 0.7;
      for (let i = 0; i < 4; i++) {
        const ax = x + (Math.random() - 0.5) * 50;
        const ay = y - 30 + (Math.random() - 0.5) * 60;
        c.beginPath(); c.moveTo(ax, ay);
        c.lineTo(ax + (Math.random() - 0.5) * 20, ay + (Math.random() - 0.5) * 20);
        c.stroke();
      }
      c.globalAlpha = hitFlash ? 0.4 : 1;
      c.shadowColor = '#4ade80'; c.shadowBlur = 25;
    }

    // Body — Deku green suit
    const bodyX = x, bodyY = y - 55;

    // Legs
    const lleg = run * 14;
    c.strokeStyle = '#1b5e20'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(bodyX, bodyY + 28); c.lineTo(bodyX - 8 + lleg, bodyY + 50); c.lineTo(bodyX - 6 + lleg, bodyY + 68); c.stroke();
    c.beginPath(); c.moveTo(bodyX, bodyY + 28); c.lineTo(bodyX + 8 - lleg, bodyY + 50); c.lineTo(bodyX + 6 - lleg, bodyY + 68); c.stroke();
    // Shoes — red
    c.fillStyle = '#c62828';
    c.beginPath(); c.ellipse(bodyX - 6 + lleg, bodyY + 70, 9, 5, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(bodyX + 6 - lleg, bodyY + 70, 9, 5, 0, 0, Math.PI * 2); c.fill();

    // Torso — green hero suit with white cross
    c.fillStyle = '#2e7d32';
    c.beginPath(); c.roundRect(bodyX - 13, bodyY, 26, 30, 4); c.fill();
    c.fillStyle = '#fff';
    c.fillRect(bodyX - 2, bodyY + 2, 4, 14);
    c.fillRect(bodyX - 8, bodyY + 6, 16, 4);

    // Cape — red
    const capeOff = Math.sin(t * 0.35) * 6;
    c.fillStyle = '#c62828';
    c.beginPath();
    c.moveTo(bodyX - 12, bodyY + 4);
    c.lineTo(bodyX - 20, bodyY + 10 + capeOff);
    c.lineTo(bodyX - 16, bodyY + 32 + capeOff);
    c.lineTo(bodyX - 10, bodyY + 28);
    c.closePath(); c.fill();

    // Arms
    const aoff = Math.sin(t * 0.45 + Math.PI) * 10;
    c.strokeStyle = '#2e7d32'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(bodyX - 10, bodyY + 5); c.lineTo(bodyX - 18, bodyY + 22 + aoff); c.stroke();
    c.beginPath(); c.moveTo(bodyX + 10, bodyY + 5); c.lineTo(bodyX + 18, bodyY + 22 - aoff); c.stroke();
    // Gloves — green glowing
    c.fillStyle = boosting ? '#4ade80' : '#1b5e20';
    c.beginPath(); c.arc(bodyX - 18, bodyY + 22 + aoff, 5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 18, bodyY + 22 - aoff, 5, 0, Math.PI * 2); c.fill();

    // Head
    c.fillStyle = '#fde68a';
    c.beginPath(); c.arc(bodyX, bodyY - 12, 13, 0, Math.PI * 2); c.fill();

    // Bunny-ear mask (Deku's helmet)
    c.fillStyle = '#2e7d32';
    c.beginPath(); c.arc(bodyX, bodyY - 14, 14, Math.PI, 0); c.fill();
    // Ears
    c.beginPath(); c.moveTo(bodyX - 10, bodyY - 25); c.lineTo(bodyX - 14, bodyY - 42); c.lineTo(bodyX - 6, bodyY - 25); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(bodyX + 10, bodyY - 25); c.lineTo(bodyX + 14, bodyY - 42); c.lineTo(bodyX + 6, bodyY - 25); c.closePath(); c.fill();
    // Eyes — large anime style
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(bodyX - 5, bodyY - 14, 5, 6, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(bodyX + 5, bodyY - 14, 5, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1565c0';
    c.beginPath(); c.arc(bodyX - 5, bodyY - 14, 3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 5, bodyY - 14, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(bodyX - 4, bodyY - 15, 1, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 6, bodyY - 15, 1, 0, Math.PI * 2); c.fill();

    // Speed lines when boosting
    if (boosting) {
      c.strokeStyle = 'rgba(74,222,128,0.6)'; c.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const ly = y - 60 + i * 18;
        const len = 25 + Math.random() * 35;
        c.beginPath(); c.moveTo(x - 20, ly); c.lineTo(x - 20 - len, ly); c.stroke();
      }
    }

    c.restore();
  }

  private drawShigaraki(c: CanvasRenderingContext2D) {
    const x = this.shigX, y = this.shigY;
    const t = this.animT;
    const stagger = this.bossState === 'stagger';
    const attacking = this.bossState === 'attack';

    c.save();
    c.shadowColor = '#7c3aed'; c.shadowBlur = 20;

    const run = Math.sin(t * 0.43);
    const bodyX = x, bodyY = y - 55;

    // Decay aura
    c.globalAlpha = 0.25;
    c.fillStyle = '#7c3aed';
    c.beginPath(); c.arc(x, y - 35, 40, 0, Math.PI * 2); c.fill();
    c.globalAlpha = stagger ? 0.6 : 1;

    // Legs — torn dark grey
    c.strokeStyle = '#37474f'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(bodyX, bodyY + 28); c.lineTo(bodyX - 8 + run * 14, bodyY + 50); c.lineTo(bodyX - 6 + run * 14, bodyY + 68); c.stroke();
    c.beginPath(); c.moveTo(bodyX, bodyY + 28); c.lineTo(bodyX + 8 - run * 14, bodyY + 50); c.lineTo(bodyX + 6 - run * 14, bodyY + 68); c.stroke();
    c.fillStyle = '#212121';
    c.beginPath(); c.ellipse(bodyX - 6 + run * 14, bodyY + 70, 8, 4, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(bodyX + 6 - run * 14, bodyY + 70, 8, 4, 0, 0, Math.PI * 2); c.fill();

    // Torso — torn black jacket
    c.fillStyle = '#212121';
    c.beginPath(); c.roundRect(bodyX - 13, bodyY, 26, 30, 3); c.fill();
    // Torn edges
    c.strokeStyle = '#7c3aed'; c.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(bodyX - 13 + i * 6, bodyY + 30);
      c.lineTo(bodyX - 10 + i * 6 + (Math.random() - 0.5) * 4, bodyY + 37);
      c.stroke();
    }

    // Arms — right arm raised when attacking
    const aOff = Math.sin(t * 0.43 + Math.PI) * 10;
    const rightY = attacking ? bodyY - 5 : bodyY + 22 - aOff;
    c.strokeStyle = '#37474f'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(bodyX - 10, bodyY + 5); c.lineTo(bodyX - 18, bodyY + 22 + aOff); c.stroke();
    c.beginPath(); c.moveTo(bodyX + 10, bodyY + 5); c.lineTo(bodyX + 22, rightY); c.stroke();
    // Hands — decay effect (purple glow)
    c.fillStyle = '#7c3aed';
    c.beginPath(); c.arc(bodyX - 18, bodyY + 22 + aOff, 6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 22, rightY, 6, 0, Math.PI * 2); c.fill();
    if (attacking) {
      c.globalAlpha = 0.5;
      c.beginPath(); c.arc(bodyX + 22, rightY, 14, 0, Math.PI * 2); c.fill();
      c.globalAlpha = stagger ? 0.6 : 1;
    }

    // Head
    c.fillStyle = '#d7ccc8';
    c.beginPath(); c.arc(bodyX, bodyY - 12, 13, 0, Math.PI * 2); c.fill();

    // Messy pale blue hair
    c.fillStyle = '#90caf9';
    c.beginPath(); c.arc(bodyX, bodyY - 22, 15, Math.PI, 0); c.fill();
    // Spiky bits
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(bodyX + i * 6 - 3, bodyY - 25);
      c.lineTo(bodyX + i * 6, bodyY - 35 + Math.abs(i) * 3);
      c.lineTo(bodyX + i * 6 + 3, bodyY - 25);
      c.closePath(); c.fill();
    }

    // Villain mask (hand on face feel — just dark markings)
    c.fillStyle = '#7c3aed';
    c.beginPath(); c.arc(bodyX - 4, bodyY - 13, 4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 4, bodyY - 13, 4, 0, Math.PI * 2); c.fill();

    // Anime eyes — red/sinister
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(bodyX - 5, bodyY - 13, 5, 5.5, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(bodyX + 5, bodyY - 13, 5, 5.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c62828';
    c.beginPath(); c.arc(bodyX - 5, bodyY - 13, 3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 5, bodyY - 13, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(bodyX - 4, bodyY - 14, 1, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bodyX + 6, bodyY - 14, 1, 0, Math.PI * 2); c.fill();

    // Stagger effect
    if (stagger) {
      c.save(); c.globalAlpha = 0.8;
      c.strokeStyle = '#4ade80'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x - 20, y - 60); c.lineTo(x + 30, y - 30); c.stroke();
      c.beginPath(); c.moveTo(x - 25, y - 40); c.lineTo(x + 15, y - 70); c.stroke();
      c.restore();
    }

    // HP bars in boss phase
    if (this.phase === 'boss') {
      const rem = BOSS_PUNCHES - this.bossHits;
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.beginPath(); c.roundRect(x - 35, y - 90, 70, 10, 4); c.fill();
      c.fillStyle = '#c62828';
      c.beginPath(); c.roundRect(x - 35, y - 90, 70 * (rem / BOSS_PUNCHES), 10, 4); c.fill();
    }

    c.restore();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private drawHUD(c: CanvasRenderingContext2D) {
    if (this.phase === 'run') this.drawRunHUD(c);
    else if (this.phase === 'boss') this.drawBossHUD(c);
  }

  private drawRunHUD(c: CanvasRenderingContext2D) {
    // Distance bar
    const bw = 340, bh = 26, bx = CW / 2 - bw / 2, by = 8;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.roundRect(bx, by, bw, bh, 8); c.fill();
    const g = c.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#4ade80'); g.addColorStop(1, '#22c55e');
    c.fillStyle = g;
    c.beginPath(); c.roundRect(bx + 2, by + 2, Math.max(0, (this.km / TOTAL_KM) * (bw - 4)), bh - 4, 6); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
    c.fillText(`🏃 ${this.km.toFixed(1)} / ${TOTAL_KM} km`, CW / 2, by + 18);

    // Biome
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.roundRect(8, 8, 160, 26, 8); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'left';
    c.fillText(this.currentBiome.label, 18, 25);

    // Boost bar
    const bready = this.boostCooldown <= 0;
    const bactive = this.boostFrames > 0;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.roundRect(CW - 145, 8, 135, 26, 8); c.fill();
    const fill = bactive
      ? (this.boostFrames / BOOST_DURATION) * 131
      : bready ? 131
      : (1 - this.boostCooldown / BOOST_COOLDOWN) * 131;
    c.fillStyle = bactive ? '#4ade80' : bready ? '#22c55e' : '#475569';
    c.shadowColor = bactive ? '#4ade80' : 'transparent'; c.shadowBlur = bactive ? 12 : 0;
    c.beginPath(); c.roundRect(CW - 143, 10, fill, 22, 6); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
    c.fillText(bactive ? '⚡ BOOST!' : bready ? '⚡ SHIFT' : '⚡ cooldown', CW - 77, 25);

    // Controls hint
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(8, CH - 36, 310, 26, 6); c.fill();
    c.fillStyle = '#ccc'; c.font = '11px sans-serif'; c.textAlign = 'left';
    c.fillText('SPACE: jump  |  SHIFT: boost  |  Z: punch (during boost)', 14, CH - 18);
  }

  private drawBossHUD(c: CanvasRenderingContext2D) {
    // Player HP
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.beginPath(); c.roundRect(8, 8, 160, 34, 8); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.textAlign = 'left';
    c.fillText('Deku HP:', 16, 28);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i < this.playerHP ? '#4ade80' : '#374151';
      c.beginPath(); c.arc(100 + i * 22, 22, 8, 0, Math.PI * 2); c.fill();
    }

    // Shigaraki HP
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.beginPath(); c.roundRect(CW - 170, 8, 162, 34, 8); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.textAlign = 'right';
    c.fillText('Shigaraki:', CW - 70, 28);
    for (let i = 0; i < BOSS_PUNCHES; i++) {
      c.fillStyle = i < (BOSS_PUNCHES - this.bossHits) ? '#c62828' : '#374151';
      c.beginPath(); c.arc(CW - 50 + i * 22, 22, 8, 0, Math.PI * 2); c.fill();
    }

    // Instruction
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.roundRect(CW / 2 - 140, CH - 36, 280, 26, 6); c.fill();
    c.fillStyle = '#4ade80'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
    c.fillText('🥊 Press Z to PUNCH Shigaraki! (3 hits wins)', CW / 2, CH - 18);

    if (this.bossState === 'attack') {
      c.fillStyle = 'rgba(124,58,237,0.35)'; c.fillRect(0, 0, CW, CH);
      c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center';
      c.shadowColor = '#7c3aed'; c.shadowBlur = 20;
      c.fillText('DECAY ATTACK!', CW / 2, CH / 2 - 20);
      c.shadowBlur = 0;
    }
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  private drawStart(c: CanvasRenderingContext2D) {
    // Anime-style title screen
    const g = c.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#0d47a1'); g.addColorStop(1, '#1b5e20');
    c.fillStyle = g; c.fillRect(0, 0, CW, CH);

    // Stars
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137) % CW, sy = (i * 97) % (CH / 2);
      c.fillStyle = `rgba(255,255,255,${0.4 + (i % 3) * 0.2})`;
      c.beginPath(); c.arc(sx, sy, 1 + (i % 2), 0, Math.PI * 2); c.fill();
    }

    // Title panel
    c.fillStyle = 'rgba(0,0,0,0.7)';
    c.beginPath(); c.roundRect(CW / 2 - 280, 60, 560, 300, 20); c.fill();
    c.strokeStyle = '#4ade80'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(CW / 2 - 280, 60, 560, 300, 20); c.stroke();

    c.textAlign = 'center';

    // 日本 kanji decoration
    c.fillStyle = 'rgba(74,222,128,0.2)'; c.font = 'bold 120px sans-serif';
    c.fillText('日本', CW / 2, 220);

    c.fillStyle = '#4ade80'; c.font = 'bold 36px sans-serif';
    c.shadowColor = '#4ade80'; c.shadowBlur = 20;
    c.fillText('DEKU: JAPAN RUN', CW / 2, 120);
    c.shadowBlur = 0;

    c.fillStyle = '#fff'; c.font = '16px sans-serif';
    c.fillText('Chase Shigaraki across 1000 km of Japan!', CW / 2, 165);

    c.fillStyle = '#fde68a'; c.font = '13px sans-serif';
    c.fillText('SPACE: jump  |  SHIFT: speed boost  |  Z: punch (during boost or boss fight)', CW / 2, 200);
    c.fillText('Reach 1000 km → Boss fight → Land 3 punches to win!', CW / 2, 225);

    c.fillStyle = '#4ade80'; c.font = 'bold 18px sans-serif';
    c.shadowColor = '#4ade80'; c.shadowBlur = 15;
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) c.fillText('▶  Press SPACE or ENTER to Start', CW / 2, 310);
    c.shadowBlur = 0;
  }

  private drawWin(c: CanvasRenderingContext2D) {
    const g = c.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#1b5e20'); g.addColorStop(1, '#4caf50');
    c.fillStyle = g; c.fillRect(0, 0, CW, CH);

    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.beginPath(); c.roundRect(CW / 2 - 220, CH / 2 - 110, 440, 220, 16); c.fill();
    c.strokeStyle = '#4ade80'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(CW / 2 - 220, CH / 2 - 110, 440, 220, 16); c.stroke();

    c.textAlign = 'center';
    c.fillStyle = '#4ade80'; c.font = 'bold 44px sans-serif';
    c.shadowColor = '#4ade80'; c.shadowBlur = 30;
    c.fillText('PLUS ULTRA!', CW / 2, CH / 2 - 50);
    c.shadowBlur = 0;

    c.fillStyle = '#fff'; c.font = '22px sans-serif';
    c.fillText('You defeated Tomura Shigaraki!', CW / 2, CH / 2);
    c.fillStyle = '#fde68a'; c.font = '16px sans-serif';
    c.fillText(`Deku ran all 1000 km of Japan!`, CW / 2, CH / 2 + 35);

    const blink = Math.floor(Date.now() / 600) % 2 === 0;
    if (blink) { c.fillStyle = '#4ade80'; c.font = 'bold 16px sans-serif'; c.fillText('SPACE / ENTER to play again', CW / 2, CH / 2 + 75); }
  }

  private drawLose(c: CanvasRenderingContext2D) {
    const g = c.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#7f0000'); g.addColorStop(1, '#1a1a2e');
    c.fillStyle = g; c.fillRect(0, 0, CW, CH);

    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.beginPath(); c.roundRect(CW / 2 - 220, CH / 2 - 110, 440, 220, 16); c.fill();
    c.strokeStyle = '#7c3aed'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(CW / 2 - 220, CH / 2 - 110, 440, 220, 16); c.stroke();

    c.textAlign = 'center';
    c.fillStyle = '#f87171'; c.font = 'bold 40px sans-serif';
    c.shadowColor = '#f87171'; c.shadowBlur = 25;
    c.fillText('KNOCKED OUT...', CW / 2, CH / 2 - 50);
    c.shadowBlur = 0;

    c.fillStyle = '#fff'; c.font = '20px sans-serif';
    c.fillText('Shigaraki\'s decay was too strong!', CW / 2, CH / 2);
    c.fillStyle = '#d1d5db'; c.font = '15px sans-serif';
    c.fillText('Train harder and try again, Deku!', CW / 2, CH / 2 + 35);

    const blink = Math.floor(Date.now() / 600) % 2 === 0;
    if (blink) { c.fillStyle = '#f87171'; c.font = 'bold 16px sans-serif'; c.fillText('SPACE / ENTER to try again', CW / 2, CH / 2 + 75); }
  }
}
