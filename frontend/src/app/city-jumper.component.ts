import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

const CW = 800, CH = 420, GY = 340;
const PX = 140;
const GRAV = 0.7, JFORCE = -14.5;

interface Player { y: number; vy: number; jumpCount: number; animT: number; dead: boolean; }
interface Obstacle { x: number; y: number; w: number; h: number; type: string; }
interface Coin     { x: number; y: number; taken: boolean; animT: number; }
interface Cloud    { x: number; y: number; r: number; spd: number; }
interface Particle { x: number; y: number; vx: number; vy: number; alpha: number; color: string; r: number; }

@Component({
  selector: 'app-city-jumper',
  standalone: true,
  imports: [],
  templateUrl: './city-jumper.component.html',
  styleUrl:    './city-jumper.component.css'
})
export class CityJumperComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: 'start' | 'playing' | 'dead' = 'start';
  score  = 0;
  best   = 0;
  coins  = 0;

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private keys = new Set<string>();
  private lastTs = 0;
  private jumpHeld = false;
  private touchJump = false;

  private player!: Player;
  private obstacles!: Obstacle[];
  private coinList!: Coin[];
  private clouds!: Cloud[];
  private particles!: Particle[];

  private spd    = 5;
  private dist   = 0;
  private groundX = 0;
  private nextObs = 0;
  private nextCoin = 0;

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (this.state === 'playing' && ['Space','ArrowUp','KeyW'].includes(e.code)) e.preventDefault();
    if (this.state === 'start' || this.state === 'dead') {
      if (['Space','ArrowUp','KeyW','Enter'].includes(e.code)) this.startGame();
    }
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.drawStatic();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.score = this.dist = this.coins = 0;
    this.spd = 5; this.groundX = 0; this.nextObs = 160; this.nextCoin = 220;
    this.player    = { y: GY - 52, vy: 0, jumpCount: 0, animT: 0, dead: false };
    this.obstacles = [];
    this.coinList  = [];
    this.particles = [];
    this.clouds    = Array.from({length:6}, () => this.makeCloud(Math.random()*CW));
    this.state = 'playing';
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  pressJump()   { this.touchJump = true;  }
  releaseJump() { this.touchJump = false; }

  // ── Loop ──────────────────────────────────────────────────────────────────
  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.update(dt);
    this.render();
    if (this.state === 'playing') this.raf = requestAnimationFrame(t => this.loop(t));
  }

  private update(dt: number) {
    const p = this.player;
    const wantJump = this.keys.has('Space') || this.keys.has('ArrowUp') ||
                     this.keys.has('KeyW')  || this.touchJump;

    // Jump
    if (wantJump && !this.jumpHeld && p.jumpCount < 2) {
      p.vy = JFORCE; p.jumpCount++; this.jumpHeld = true;
    }
    if (!wantJump) this.jumpHeld = false;

    // Physics
    p.vy = Math.min(p.vy + GRAV * dt, 20);
    p.y += p.vy * dt;

    if (p.y >= GY - 52) { p.y = GY - 52; p.vy = 0; p.jumpCount = 0; }
    p.animT += dt;

    // Speed ramp
    this.dist += this.spd * dt;
    this.score = Math.floor(this.dist / 6);
    this.spd   = 5 + Math.floor(this.score / 300) * 0.6;

    // Ground scroll
    this.groundX = (this.groundX + this.spd * dt) % 40;

    // Obstacles
    this.nextObs -= this.spd * dt;
    if (this.nextObs <= 0) {
      this.spawnObstacle();
      this.nextObs = 260 + Math.random() * 300 - Math.min(this.score / 20, 100);
    }
    for (const o of this.obstacles) o.x -= this.spd * dt;
    this.obstacles = this.obstacles.filter(o => o.x + o.w > -20);

    // Coins
    this.nextCoin -= this.spd * dt;
    if (this.nextCoin <= 0) {
      this.coinList.push({ x: CW + 20, y: GY - 80 - Math.random() * 100, taken: false, animT: 0 });
      this.nextCoin = 180 + Math.random() * 160;
    }
    for (const c of this.coinList) { c.x -= this.spd * dt; c.animT += dt; }
    this.coinList = this.coinList.filter(c => c.x > -20);

    // Clouds
    for (const c of this.clouds) { c.x -= c.spd * dt; if (c.x + c.r * 2 < 0) Object.assign(c, this.makeCloud(CW + 20)); }

    // Particles
    for (const p of this.particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 0.15*dt; p.alpha -= 0.025*dt; }
    this.particles = this.particles.filter(p => p.alpha > 0);

    // Collision — player hitbox
    const phx = PX - 9, phy = p.y + 4, phw = 18, phh = 44;

    for (const o of this.obstacles) {
      if (phx < o.x+o.w && phx+phw > o.x && phy < o.y+o.h && phy+phh > o.y) {
        this.die(); return;
      }
    }
    for (const c of this.coinList) {
      if (!c.taken && Math.abs(PX - c.x) < 18 && Math.abs(p.y + 20 - c.y) < 18) {
        c.taken = true; this.coins++; this.score += 50;
        this.burst(c.x, c.y, '#fbbf24', 6);
      }
    }
  }

  private spawnObstacle() {
    const types = ['tram','tram','bollard','bollard','bike','swan','barrier'];
    const type  = types[Math.floor(Math.random() * types.length)];
    const dims: Record<string, [number,number]> = {
      tram:    [90, 68], bollard: [18, 38], bike: [44, 38],
      swan:    [48, 32], barrier: [30, 52]
    };
    const [w, h] = dims[type];
    this.obstacles.push({ x: CW + 10, y: GY - h, w, h, type });
  }

  private die() {
    if (this.player.dead) return;
    this.player.dead = true;
    if (this.score > this.best) this.best = this.score;
    this.burst(PX, this.player.y + 20, '#ef4444', 14);
    setTimeout(() => { this.state = 'dead'; cancelAnimationFrame(this.raf); }, 700);
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) this.particles.push({
      x, y, vx: (Math.random()-.5)*9, vy: (Math.random()-.5)*9-3,
      alpha: 1, color, r: 3 + Math.random()*4
    });
  }

  private makeCloud(x: number): Cloud {
    return { x, y: 40 + Math.random()*90, r: 28+Math.random()*40, spd: 0.4+Math.random()*0.5 };
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  private render() {
    const c = this.ctx;
    this.drawBg(c);
    this.drawGround(c);
    this.drawCoins(c);
    for (const o of this.obstacles) this.drawObstacle(c, o);
    this.drawParticles(c);
    if (!this.player.dead) this.drawPlayer(c);
    this.drawHUD(c);
  }

  private drawStatic() { this.drawBg(this.ctx); this.drawGround(this.ctx); }

  private drawBg(c: CanvasRenderingContext2D) {
    // Sky gradient
    const sky = c.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, '#87ceeb'); sky.addColorStop(0.6, '#c9e8f5'); sky.addColorStop(1, '#e8f4f8');
    c.fillStyle = sky; c.fillRect(0, 0, CW, CH);

    // Alps (very far, fixed)
    c.fillStyle = '#d1d5db';
    const peaks = [[60,240],[160,200],[280,215],[400,195],[520,210],[660,225],[780,235]];
    c.beginPath(); c.moveTo(0, CH);
    for (const [px,py] of peaks) {
      c.lineTo(px - 60, py + 40); c.lineTo(px, py); c.lineTo(px + 60, py + 40);
    }
    c.lineTo(CW, CH); c.closePath(); c.fill();
    // Snow caps
    c.fillStyle = '#fff';
    for (const [px,py] of peaks) {
      c.beginPath(); c.moveTo(px-18, py+22); c.lineTo(px, py); c.lineTo(px+18, py+22); c.fill();
    }

    // Clouds
    c.fillStyle = 'rgba(255,255,255,0.88)';
    for (const cl of (this.clouds ?? [])) {
      c.beginPath();
      c.arc(cl.x,      cl.y,      cl.r,        0, Math.PI*2);
      c.arc(cl.x+cl.r, cl.y-cl.r*0.4, cl.r*0.7, 0, Math.PI*2);
      c.arc(cl.x-cl.r, cl.y-cl.r*0.2, cl.r*0.6, 0, Math.PI*2);
      c.fill();
    }

    // Zurich skyline silhouette (parallax offset 0.15)
    const off = this.state === 'playing' ? (this.dist * 0.15) % CW : 0;
    c.fillStyle = '#4a5568';
    this.drawSkyline(c, -off);
    this.drawSkyline(c, CW - off);

    // Lake Zurich shimmer at horizon
    const lake = c.createLinearGradient(0, GY - 20, 0, GY);
    lake.addColorStop(0, 'rgba(100,180,220,0.25)');
    lake.addColorStop(1, 'rgba(100,180,220,0)');
    c.fillStyle = lake; c.fillRect(0, GY-20, CW, 20);
  }

  private drawSkyline(c: CanvasRenderingContext2D, xOff: number) {
    const b = (x: number, y: number, w: number, h: number) =>
      c.fillRect(xOff + x, y, w, h);

    // Grossmünster twin towers
    b(80,  220, 22, 100); b(110, 215, 22, 105);
    // Pointed spires
    c.beginPath(); c.moveTo(xOff+80, 220); c.lineTo(xOff+91, 190); c.lineTo(xOff+102,220); c.fill();
    c.beginPath(); c.moveTo(xOff+110,215); c.lineTo(xOff+121,182); c.lineTo(xOff+132,215); c.fill();
    // Rose window hint
    c.fillStyle='rgba(255,200,100,0.3)'; c.beginPath(); c.arc(xOff+91,245,6,0,Math.PI*2); c.fill();
    c.fillStyle='#4a5568';

    // Fraumünster spire
    b(200, 230, 16, 90);
    c.beginPath(); c.moveTo(xOff+200,230); c.lineTo(xOff+208,205); c.lineTo(xOff+216,230); c.fill();

    // St Peter's (big clock tower)
    b(300, 225, 28, 95);
    c.fillStyle='rgba(200,200,200,0.5)'; c.beginPath(); c.arc(xOff+314,250,11,0,Math.PI*2); c.fill();
    c.fillStyle='#4a5568';

    // Modern buildings
    const blds = [[380,250,35,90],[440,240,28,100],[490,255,40,85],[560,235,32,105],[620,248,38,92],[680,260,30,80],[730,242,35,98]];
    for (const [x,y,w,h] of blds) {
      b(x,y,w,h);
      // Windows
      c.fillStyle='rgba(255,220,100,0.25)';
      for (let wy=y+8; wy<y+h-8; wy+=14)
        for (let wx=x+4; wx<x+w-4; wx+=10) c.fillRect(xOff+wx,wy,5,7);
      c.fillStyle='#4a5568';
    }
  }

  private drawGround(c: CanvasRenderingContext2D) {
    // Cobblestone base
    c.fillStyle = '#78716c'; c.fillRect(0, GY, CW, CH - GY);

    // Scrolling cobblestone rows
    const off = this.state === 'playing' ? this.groundX : 0;
    c.fillStyle = '#57534e';
    for (let row = 0; row < 4; row++) {
      const shift = row % 2 === 0 ? 0 : 20;
      for (let col = -1; col < CW/40 + 1; col++) {
        const cx = col*40 + shift - (off % 40);
        c.fillRect(cx, GY + row*20, 36, 17);
      }
    }
    // Pavement edge highlight
    c.fillStyle = '#a8a29e'; c.fillRect(0, GY, CW, 5);
  }

  private drawCoins(c: CanvasRenderingContext2D) {
    for (const coin of this.coinList) {
      if (coin.taken) continue;
      const bob = Math.sin(coin.animT * 0.15) * 4;
      c.save();
      c.shadowColor = '#fbbf24'; c.shadowBlur = 8;
      c.fillStyle = '#fbbf24';
      c.beginPath(); c.arc(coin.x, coin.y + bob, 11, 0, Math.PI*2); c.fill();
      c.fillStyle = '#92400e';
      c.font = 'bold 11px serif'; c.textAlign = 'center';
      c.fillText('₣', coin.x, coin.y + bob + 4);
      c.restore();
    }
  }

  private drawObstacle(c: CanvasRenderingContext2D, o: Obstacle) {
    const { x, y, w, h, type } = o;

    if (type === 'tram') {
      // Red Swiss tram body
      c.fillStyle = '#b91c1c'; c.fillRect(x, y, w, h);
      // Blue roof stripe
      c.fillStyle = '#1e40af'; c.fillRect(x, y, w, 10);
      // Cream windows
      c.fillStyle = '#fef3c7';
      for (let i = 0; i < 4; i++) c.fillRect(x+6+i*20, y+14, 14, 22);
      // Destination board
      c.fillStyle = '#fff'; c.fillRect(x+4, y+40, w-8, 12);
      c.fillStyle = '#1e3a5f'; c.font='bold 8px sans-serif'; c.textAlign='center';
      c.fillText('ZÜRICH HB', x+w/2, y+50);
      // Door line
      c.strokeStyle='#7f1d1d'; c.lineWidth=1.5;
      c.beginPath(); c.moveTo(x+w/2,y+12); c.lineTo(x+w/2,y+h-2); c.stroke();
      // Wheels
      c.fillStyle='#374151';
      [[x+14,y+h],[x+w-14,y+h]].forEach(([wx,wy])=>{ c.beginPath(); c.arc(wx,wy,8,0,Math.PI*2); c.fill(); });
      c.fillStyle='#6b7280';
      [[x+14,y+h],[x+w-14,y+h]].forEach(([wx,wy])=>{ c.beginPath(); c.arc(wx,wy,4,0,Math.PI*2); c.fill(); });
      // Trolley pole
      c.strokeStyle='#6b7280'; c.lineWidth=2;
      c.beginPath(); c.moveTo(x+w/2,y); c.lineTo(x+w/2-5,y-30); c.stroke();
      c.beginPath(); c.moveTo(x+w/2-5,y-30); c.lineTo(x+w/2-5,y-35); c.strokeStyle='#fbbf24'; c.lineWidth=3; c.stroke();
    }

    else if (type === 'bollard') {
      // Orange Swiss bollard
      c.fillStyle='#ea580c'; c.fillRect(x,y,w,h);
      // White stripes
      c.fillStyle='#fff'; c.fillRect(x,y+8,w,5); c.fillRect(x,y+20,w,5);
      // Dome top
      c.fillStyle='#ea580c'; c.beginPath(); c.arc(x+w/2,y,w/2,Math.PI,0); c.fill();
      // Shine
      c.fillStyle='rgba(255,255,255,0.3)'; c.beginPath(); c.ellipse(x+w/2-2,y+6,4,8,0,0,Math.PI*2); c.fill();
    }

    else if (type === 'bike') {
      // Swiss bicycle
      c.strokeStyle='#1e3a5f'; c.lineWidth=2.5; c.lineCap='round';
      // Wheels
      c.beginPath(); c.arc(x+10,y+h,12,0,Math.PI*2);
      c.arc(x+34,y+h,12,0,Math.PI*2); c.stroke();
      // Spokes
      c.lineWidth=1; c.strokeStyle='#64748b';
      [-1,0,1].forEach(a => {
        c.beginPath(); c.moveTo(x+10,y+h);
        c.lineTo(x+10+Math.cos(a)*10, y+h+Math.sin(a)*10); c.stroke();
        c.beginPath(); c.moveTo(x+34,y+h);
        c.lineTo(x+34+Math.cos(a+0.5)*10, y+h+Math.sin(a+0.5)*10); c.stroke();
      });
      // Frame
      c.lineWidth=2.5; c.strokeStyle='#dc2626';
      c.beginPath(); c.moveTo(x+10,y+h); c.lineTo(x+22,y+h-18); c.lineTo(x+34,y+h);
      c.moveTo(x+22,y+h-18); c.lineTo(x+16,y+h); c.stroke();
      // Handlebar & seat
      c.strokeStyle='#1e3a5f';
      c.beginPath(); c.moveTo(x+30,y+h-20); c.lineTo(x+38,y+h-17); c.stroke();
      c.beginPath(); c.moveTo(x+14,y+h-20); c.lineTo(x+22,y+h-18); c.stroke();
    }

    else if (type === 'swan') {
      // White Zurich swan
      c.fillStyle='#fff'; c.strokeStyle='#d1d5db'; c.lineWidth=1.5;
      // Body
      c.beginPath(); c.ellipse(x+18,y+h-10,18,10,0,0,Math.PI*2); c.fill(); c.stroke();
      // Wing detail
      c.fillStyle='#f3f4f6'; c.beginPath(); c.ellipse(x+14,y+h-14,10,6,-0.3,0,Math.PI*2); c.fill();
      // Neck (S-curve)
      c.fillStyle='#fff'; c.strokeStyle='#d1d5db'; c.lineWidth=4; c.lineCap='round';
      c.beginPath(); c.moveTo(x+30,y+h-14);
      c.bezierCurveTo(x+38,y+h-20, x+40,y+h-35, x+44,y+h-30); c.stroke();
      // Head
      c.fillStyle='#fff'; c.beginPath(); c.arc(x+44,y+h-32,6,0,Math.PI*2); c.fill();
      // Orange beak
      c.fillStyle='#f97316';
      c.beginPath(); c.moveTo(x+50,y+h-32); c.lineTo(x+57,y+h-29); c.lineTo(x+50,y+h-27); c.closePath(); c.fill();
      // Eye
      c.fillStyle='#1e293b'; c.beginPath(); c.arc(x+46,y+h-34,1.5,0,Math.PI*2); c.fill();
    }

    else if (type === 'barrier') {
      // Red & white construction barrier
      c.fillStyle='#fff'; c.fillRect(x,y,w,h);
      // Red stripes (diagonal)
      c.save(); c.beginPath(); c.rect(x,y,w,h); c.clip();
      c.fillStyle='#dc2626';
      for (let i=-2;i<5;i++) {
        c.beginPath();
        c.moveTo(x+i*14,    y);
        c.lineTo(x+i*14+14, y);
        c.lineTo(x+i*14-h,  y+h);
        c.lineTo(x+i*14-h+14, y+h);
        c.closePath(); c.fill();
      }
      c.restore();
      // Border
      c.strokeStyle='#dc2626'; c.lineWidth=2; c.strokeRect(x,y,w,h);
      // Feet
      c.fillStyle='#374151'; c.fillRect(x-4,y+h,w+8,6);
    }
  }

  private drawPlayer(c: CanvasRenderingContext2D) {
    const p = this.player;
    const cx = PX, cy = p.y;
    const t  = p.animT;
    const onG = p.y >= GY - 53;
    const ls  = onG ? Math.sin(t*.35)*14 : 0;
    const as  = onG ? Math.sin(t*.35)*11 : -5;

    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';

    // Shadow
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.beginPath(); c.ellipse(cx, GY+2, 12, 4, 0, 0, Math.PI*2); c.fill();

    // Head
    c.beginPath(); c.arc(cx, cy+8, 9, 0, Math.PI*2);
    c.fillStyle='#fde68a'; c.fill();
    c.strokeStyle='#92400e'; c.lineWidth=1.5; c.stroke();

    // Hair
    c.fillStyle='#78350f';
    c.beginPath(); c.arc(cx, cy+2, 9, Math.PI, 0); c.fill();

    // Face
    c.fillStyle='#1e293b'; c.beginPath(); c.arc(cx+3.5,cy+9,1.8,0,Math.PI*2); c.fill();
    c.strokeStyle='#92400e'; c.lineWidth=1.2;
    c.beginPath(); c.arc(cx+1,cy+13,3,0.1,Math.PI-0.1); c.stroke();

    // Red Swiss shirt
    c.fillStyle='#dc2626'; c.beginPath(); c.roundRect(cx-8,cy+18,16,14,3); c.fill();
    // Swiss cross
    c.fillStyle='#fff';
    c.fillRect(cx-1,cy+20,3,10);
    c.fillRect(cx-5,cy+23,11,3);

    // Body below shirt
    c.strokeStyle='#78350f'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(cx,cy+32); c.lineTo(cx,cy+38); c.stroke();

    // Arms
    c.strokeStyle='#fde68a'; c.lineWidth=2.5;
    c.beginPath();
    c.moveTo(cx,cy+22); c.lineTo(cx-11+as,cy+31);
    c.moveTo(cx,cy+22); c.lineTo(cx+11-as,cy+31);
    c.stroke();

    // Legs & shoes
    c.strokeStyle='#1e3a5f'; c.lineWidth=3;
    c.beginPath();
    c.moveTo(cx,cy+38); c.lineTo(cx-9+ls, cy+50);
    c.moveTo(cx,cy+38); c.lineTo(cx+9-ls, cy+50);
    c.stroke();

    // Shoes
    c.fillStyle='#1e293b';
    c.beginPath(); c.ellipse(cx-9+ls,cy+51,6,3.5,0,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(cx+9-ls,cy+51,6,3.5,0,0,Math.PI*2); c.fill();

    c.restore();
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      c.save(); c.globalAlpha = p.alpha;
      c.fillStyle = p.color; c.beginPath(); c.arc(p.x,p.y,p.r,0,Math.PI*2); c.fill();
      c.restore();
    }
  }

  private drawHUD(c: CanvasRenderingContext2D) {
    // Score box
    c.fillStyle='rgba(0,0,0,0.45)'; c.beginPath(); c.roundRect(CW-170,10,160,50,8); c.fill();
    c.fillStyle='#fff'; c.font='bold 13px sans-serif'; c.textAlign='left';
    c.fillText(`Score:  ${this.score}`,   CW-158, 29);
    c.fillText(`Best:   ${this.best}`,    CW-158, 46);

    // Coins
    c.fillStyle='rgba(0,0,0,0.45)'; c.beginPath(); c.roundRect(10,10,120,32,8); c.fill();
    c.font='14px serif'; c.fillText('₣', 22, 32);
    c.fillStyle='#fbbf24'; c.font='bold 13px sans-serif';
    c.fillText(`× ${this.coins}`, 36, 32);

    // Speed level
    const level = Math.floor((this.spd-5)/0.6)+1;
    if (level > 1) {
      c.fillStyle='rgba(220,38,38,0.7)'; c.beginPath(); c.roundRect(CW/2-30,10,60,24,6); c.fill();
      c.fillStyle='#fff'; c.font='bold 11px sans-serif'; c.textAlign='center';
      c.fillText(`LV ${level} 🔥`, CW/2, 26);
    }
    c.textAlign='left';
  }
}
