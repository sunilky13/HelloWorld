import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

const CW = 800, CH = 420;
const PLAYER_X = 150;
const BASE_SPD = 5, MAX_SPD = 10, MIN_SPD = 2;
const GRAV = 0.7, JUMP_V = -12;
const TOTAL_MILES = 1000;

type Biome = 'forest'|'town'|'city'|'countryside'|'mountain'|'abroad';

const BIOMES: { name:string; label:string; miles:[number,number]; hillAmp:number }[] = [
  { name:'forest',      label:'🌲 Forest',        miles:[0,150],    hillAmp:60 },
  { name:'town',        label:'🏘️ Town',           miles:[150,300],  hillAmp:22 },
  { name:'city',        label:'🏙️ City',           miles:[300,500],  hillAmp:10 },
  { name:'countryside', label:'🌾 Countryside',    miles:[500,650],  hillAmp:50 },
  { name:'mountain',    label:'⛰️ Mountain Pass',  miles:[650,800],  hillAmp:90 },
  { name:'abroad',      label:'🌷 Netherlands',    miles:[800,1000], hillAmp:8  },
];

interface Particle { x:number; y:number; vx:number; vy:number; alpha:number; c:string; r:number; }
interface Obstacle { x:number; y:number; w:number; h:number; type:string; }

@Component({
  selector: 'app-bike-ride',
  standalone: true,
  imports: [],
  templateUrl: './bike-ride.component.html',
  styleUrl:    './bike-ride.component.css'
})
export class BikeRideComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: 'start'|'playing'|'finish' = 'start';
  miles = 0;
  keys = new Set<string>();

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private lastTs = 0;
  private animT = 0;

  // Physics
  private spd = BASE_SPD;
  private playerY = CH - 120;
  private playerGY = CH - 120;
  private jumpVy = 0;
  private airborne = false;
  private jumpsUsed = 0;
  private jumpKeyWasDown = false;
  private touchJump = false;
  private hitTimer = 0;

  // World
  private worldX = 0;       // total pixels scrolled
  private bgOffX = 0;
  private mgOffX = 0;
  private terrain: {x:number; y:number}[] = [];
  private terrainWX = 0;    // world X of rightmost terrain point
  private obstacles: Obstacle[] = [];
  private nextObs = 300;
  private particles: Particle[] = [];

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space','ArrowUp','KeyW'].includes(e.code) && this.state === 'playing') e.preventDefault();
    if (this.state === 'start' && ['Space','Enter'].includes(e.code)) this.startGame();
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.buildInitialTerrain();
    this.drawFrame();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  pressJump()   { this.touchJump = true;  }
  releaseJump() { this.touchJump = false; }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.state = 'playing';
    this.miles = 0; this.worldX = 0; this.spd = BASE_SPD;
    this.animT = 0; this.bgOffX = 0; this.mgOffX = 0;
    this.playerY = CH - 120; this.jumpVy = 0; this.airborne = false; this.jumpsUsed = 0; this.jumpKeyWasDown = false;
    this.obstacles = []; this.nextObs = 300; this.particles = [];
    this.terrain = []; this.terrainWX = 0;
    this.buildInitialTerrain();
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  get currentBiome(): typeof BIOMES[0] {
    return BIOMES.find(b => this.miles >= b.miles[0] && this.miles < b.miles[1]) ?? BIOMES[BIOMES.length-1];
  }

  // ── Terrain ──────────────────────────────────────────────────────────────

  private buildInitialTerrain() {
    const count = Math.ceil((CW + 250) / 4) + 2;
    for (let i = 0; i < count; i++) {
      const wx = i * 4;
      this.terrain.push({ x: wx - PLAYER_X, y: this.terrainY(wx) });
    }
    this.terrainWX = (count - 1) * 4;
    this.playerGY = this.getGroundY();
    this.playerY = this.playerGY;
  }

  private terrainY(wx: number): number {
    const biome = BIOMES.find(b => {
      const mileX = wx / (200000 / TOTAL_MILES);
      return mileX >= b.miles[0] && mileX < b.miles[1];
    }) ?? BIOMES[BIOMES.length-1];
    const amp = biome.hillAmp;
    return (CH - 80)
      - amp * Math.sin(wx / 900)
      - 18 * Math.sin(wx / 220 + 1.4)
      - 7  * Math.sin(wx / 85  + 0.9);
  }

  private scrollTerrain() {
    for (const p of this.terrain) p.x -= this.spd;
    while (this.terrain.length > 0 && this.terrain[0].x < -PLAYER_X - 20) this.terrain.shift();
    while (this.terrainWX < this.worldX + CW + 200) {
      this.terrainWX += 4;
      this.terrain.push({ x: this.terrainWX - this.worldX - PLAYER_X, y: this.terrainY(this.terrainWX) });
    }
  }

  private getGroundY(): number {
    const idx = this.terrain.findIndex(p => p.x >= PLAYER_X);
    if (idx <= 0) return CH - 100;
    const a = this.terrain[idx-1], b = this.terrain[idx];
    const t = (PLAYER_X - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.update(dt);
    this.drawFrame();
    if (this.state === 'playing') this.raf = requestAnimationFrame(t => this.loop(t));
  }

  private update(dt: number) {
    this.animT += dt;

    // Scroll terrain
    this.scrollTerrain();
    this.playerGY = this.getGroundY();

    // Slope-based speed
    const lookahead = this.terrain.find(p => p.x >= PLAYER_X + 20);
    const slope = lookahead ? lookahead.y - this.playerGY : 0;
    if (slope > 3)       this.spd = Math.max(MIN_SPD, this.spd - 0.04 * dt);
    else if (slope < -3) this.spd = Math.min(MAX_SPD, this.spd + 0.07 * dt);
    else                 this.spd += (BASE_SPD - this.spd) * 0.02 * dt;
    if (this.hitTimer > 0) { this.spd = MIN_SPD; this.hitTimer -= dt; }

    // Jump (double jump allowed)
    const wantJump = this.keys.has('Space') || this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touchJump;
    const justPressed = wantJump && !this.jumpKeyWasDown;
    if (justPressed && this.jumpsUsed < 2) { this.jumpVy = JUMP_V; this.airborne = true; this.jumpsUsed++; }
    this.jumpKeyWasDown = wantJump;

    if (this.airborne) {
      this.jumpVy += GRAV * dt;
      this.playerY += this.jumpVy * dt;
      if (this.playerY >= this.playerGY) { this.playerY = this.playerGY; this.jumpVy = 0; this.airborne = false; this.jumpsUsed = 0; }
    } else {
      this.playerY = this.playerGY;
    }

    // Distance
    this.worldX += this.spd;
    this.bgOffX += this.spd * 0.18;
    this.mgOffX += this.spd * 0.45;
    this.miles = Math.min(TOTAL_MILES, this.worldX / (200000 / TOTAL_MILES));
    if (this.miles >= TOTAL_MILES) { this.state = 'finish'; cancelAnimationFrame(this.raf); return; }

    // Downhill electric particles
    if (this.spd > 7) {
      if (Math.random() < 0.4) this.particles.push({
        x: PLAYER_X + (Math.random()-.5)*35,
        y: this.playerY - 20 + (Math.random()-.5)*30,
        vx: -this.spd * 0.4 + (Math.random()-.5)*2,
        vy: (Math.random()-.5)*3,
        alpha: 0.9,
        c: Math.random() > 0.45 ? '#22c55e' : '#86efac',
        r: 2 + Math.random() * 3
      });
    }

    // Obstacles
    this.nextObs -= this.spd;
    if (this.nextObs <= 0) {
      const biome = this.currentBiome.name as Biome;
      this.spawnObstacle(biome);
      this.nextObs = 220 + Math.random() * 280;
    }
    for (const o of this.obstacles) o.x -= this.spd;
    this.obstacles = this.obstacles.filter(o => o.x + o.w > -20);

    // Obstacle collision
    for (const o of this.obstacles) {
      if (this.hitTimer > 0) continue;
      const py = this.playerY - 48, ph = 48, pw = 26;
      if (PLAYER_X + pw/2 > o.x && PLAYER_X - pw/2 < o.x + o.w &&
          py + ph > o.y && py < o.y + o.h) {
        this.hitTimer = 2;
        for (let i=0;i<8;i++) this.particles.push({
          x:PLAYER_X, y:this.playerY-20,
          vx:(Math.random()-.5)*8, vy:(Math.random()-.5)*8-2,
          alpha:1, c:'#f97316', r:4
        });
      }
    }

    // Particles
    for (const p of this.particles) {
      p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 0.12*dt; p.alpha -= 0.025*dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);
  }

  private spawnObstacle(biome: Biome) {
    const gY = this.getGroundY();
    const types: Record<Biome,string[]> = {
      forest:      ['log','pothole'],
      town:        ['car','pothole'],
      city:        ['car','barrier'],
      countryside: ['pothole','log'],
      mountain:    ['rock','pothole'],
      abroad:      ['barrier','pothole'],
    };
    const type = types[biome][Math.floor(Math.random()*types[biome].length)];
    const dims: Record<string,[number,number]> = {
      log:[45,22], pothole:[28,10], car:[65,38], barrier:[28,50], rock:[40,35]
    };
    const [w,h] = dims[type] ?? [30,20];
    this.obstacles.push({ x:CW+20, y:gY-h, w, h, type });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private drawFrame() {
    const c = this.ctx;
    const biome = this.currentBiome;
    this.drawBackground(c, biome.name as Biome);
    this.drawTerrain(c);
    this.drawObstacles(c);
    this.drawParticles(c);
    this.drawCyclist(c);
    this.drawHUD(c);
  }

  private drawBackground(c: CanvasRenderingContext2D, biome: Biome) {
    // Sky
    const skies: Record<Biome,[string,string]> = {
      forest:      ['#87CEEB','#C8E6C9'],
      town:        ['#B0C4DE','#E8EAF6'],
      city:        ['#90A4AE','#CFD8DC'],
      countryside: ['#87CEEB','#FFF9C4'],
      mountain:    ['#B0BEC5','#ECEFF1'],
      abroad:      ['#87CEEB','#E8F5E9'],
    };
    const [s1,s2] = skies[biome];
    const sky = c.createLinearGradient(0,0,0,CH);
    sky.addColorStop(0,s1); sky.addColorStop(0.6,s2); sky.addColorStop(1,'#e0e0e0');
    c.fillStyle = sky; c.fillRect(0,0,CW,CH);

    const bgX = -(this.bgOffX % (CW*2));
    const mgX = -(this.mgOffX % (CW*2));

    if (biome === 'forest') {
      // Rolling hills far
      c.fillStyle='#388E3C';
      c.beginPath(); c.moveTo(0,CH);
      for (let x=bgX; x<CW+200; x+=1) c.lineTo(x, 260 - 60*Math.sin((x-bgX)/320));
      c.lineTo(CW,CH); c.fill();
      // Trees (2 layers)
      this.drawTrees(c, mgX, 200, 35, '#1B5E20', 7, 50);
      this.drawTrees(c, mgX+50, 230, 28, '#2E7D32', 9, 40);
    } else if (biome === 'town') {
      this.drawBuildings(c, bgX, 160, 180, 40, 80, '#90A4AE');
      this.drawBuildings(c, mgX, 200, 140, 30, 60, '#B0BEC5');
    } else if (biome === 'city') {
      this.drawSkyscrapers(c, bgX, 80, 260, 30, 60);
      this.drawBuildings(c, mgX, 180, 180, 30, 50, '#9E9E9E');
    } else if (biome === 'countryside') {
      c.fillStyle='#81C784';
      c.fillRect(0, 220, CW, CH-220);
      this.drawRoundTrees(c, mgX, 240, 30, '#388E3C', 6, 60);
      // Fence posts
      for (let fx=(mgX%80); fx<CW; fx+=80) {
        c.fillStyle='#8D6E63'; c.fillRect(fx,230,6,30);
        c.strokeStyle='#A1887F'; c.lineWidth=1.5;
        c.beginPath(); c.moveTo(fx,236); c.lineTo(fx+80,236); c.stroke();
        c.beginPath(); c.moveTo(fx,250); c.lineTo(fx+80,250); c.stroke();
      }
    } else if (biome === 'mountain') {
      // Mountain peaks
      c.fillStyle='#78909C';
      const pkX = bgX;
      const pks = [[0,180],[120,100],[240,140],[360,90],[480,120],[600,80],[720,110],[840,150]];
      c.beginPath(); c.moveTo(0,CH);
      for (const [px,py] of pks) c.lineTo(pkX+px,py);
      c.lineTo(CW,CH); c.fill();
      c.fillStyle='#fff';
      for (const [px,py] of pks.slice(1,-1)) {
        c.beginPath(); c.moveTo(pkX+px-20,py+30); c.lineTo(pkX+px,py); c.lineTo(pkX+px+20,py+30); c.fill();
      }
      this.drawTrees(c, mgX, 230, 25, '#37474F', 10, 40);
    } else if (biome === 'abroad') {
      // Dutch flat + windmill
      c.fillStyle='#A5D6A7'; c.fillRect(0,260,CW,CH-260);
      c.fillStyle='rgba(100,180,220,0.3)'; c.fillRect(0,280,CW,20);
      // Tulip rows
      for (let tx=(mgX%60); tx<CW; tx+=60) {
        const cols=['#ef4444','#f97316','#fbbf24','#ec4899'];
        c.fillStyle=cols[Math.floor(tx/60)%4];
        c.beginPath(); c.ellipse(tx+8,270,5,9,0,0,Math.PI*2); c.fill();
        c.fillStyle='#16a34a'; c.fillRect(tx+6,270,4,15);
      }
      // Windmill
      const wmX = (CW*0.75 - (mgX%CW) + CW*2) % (CW*2) - CW*0.2;
      this.drawWindmill(c, wmX, 180);
    }
  }

  private drawTrees(c: CanvasRenderingContext2D, offX:number, baseY:number, size:number, col:string, n:number, gap:number) {
    for (let i=0;i<Math.ceil(CW/gap)+2;i++) {
      const tx = ((offX + i*gap) % (CW+gap*2));
      c.fillStyle='#795548'; c.fillRect(tx+size/2-3, baseY, 6, size*0.7);
      c.fillStyle=col;
      c.beginPath(); c.moveTo(tx,baseY); c.lineTo(tx+size/2,baseY-size*1.2); c.lineTo(tx+size,baseY); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(tx+5,baseY-size*0.6); c.lineTo(tx+size/2,baseY-size*1.6); c.lineTo(tx+size-5,baseY-size*0.6); c.closePath(); c.fill();
    }
  }

  private drawRoundTrees(c: CanvasRenderingContext2D, offX:number, baseY:number, r:number, col:string, n:number, gap:number) {
    for (let i=0;i<Math.ceil(CW/gap)+2;i++) {
      const tx = ((offX + i*gap) % (CW+gap*2));
      c.fillStyle='#6D4C41'; c.fillRect(tx+r/2-3, baseY, 6, r);
      c.fillStyle=col; c.beginPath(); c.arc(tx+r/2, baseY, r, 0, Math.PI*2); c.fill();
    }
  }

  private drawBuildings(c: CanvasRenderingContext2D, offX:number, minY:number, maxH:number, minW:number, maxW:number, col:string) {
    let bx = offX % 500;
    while (bx < CW+100) {
      const w = minW + Math.abs(Math.sin(bx*0.7))*maxW;
      const h = maxH*0.4 + Math.abs(Math.sin(bx*0.3))*maxH;
      c.fillStyle=col; c.fillRect(bx, minY-h, w, h+CH);
      c.fillStyle='rgba(255,220,100,0.2)';
      for (let wy=minY-h+8; wy<minY-10; wy+=14)
        for (let wx=bx+4; wx<bx+w-4; wx+=10) c.fillRect(wx,wy,6,8);
      bx += w + 8 + Math.abs(Math.sin(bx*0.5))*20;
    }
  }

  private drawSkyscrapers(c: CanvasRenderingContext2D, offX:number, minY:number, maxH:number, minW:number, maxW:number) {
    let bx = offX % 600;
    while (bx < CW+100) {
      const w = minW + Math.abs(Math.sin(bx*0.4))*(maxW-minW);
      const h = maxH*0.3 + Math.abs(Math.sin(bx*0.2))*maxH;
      const dark = Math.floor(60+Math.abs(Math.sin(bx*0.6))*40);
      c.fillStyle=`rgb(${dark},${dark+10},${dark+20})`;
      c.fillRect(bx, minY-h, w, h+CH);
      c.fillStyle='rgba(255,220,80,0.25)';
      for (let wy=minY-h+6; wy<minY-10; wy+=12)
        for (let wx=bx+3; wx<bx+w-3; wx+=9) c.fillRect(wx,wy,5,7);
      bx += w + 4 + Math.abs(Math.sin(bx*0.3))*15;
    }
  }

  private drawWindmill(c: CanvasRenderingContext2D, x:number, y:number) {
    c.fillStyle='#78909C'; c.fillRect(x-6, y, 12, 100);
    const rot = this.animT * 0.04;
    c.strokeStyle='#546E7A'; c.lineWidth=5; c.lineCap='round';
    for (let i=0;i<4;i++) {
      const a = rot + i*Math.PI/2;
      c.beginPath();
      c.moveTo(x,y); c.lineTo(x+Math.cos(a)*35, y+Math.sin(a)*35); c.stroke();
    }
    c.fillStyle='#455A64'; c.beginPath(); c.arc(x,y,8,0,Math.PI*2); c.fill();
  }

  private drawTerrain(c: CanvasRenderingContext2D) {
    if (this.terrain.length < 2) return;
    const biome = this.currentBiome.name as Biome;
    const groundCols: Record<Biome,[string,string]> = {
      forest:      ['#4CAF50','#388E3C'],
      town:        ['#9E9E9E','#757575'],
      city:        ['#78909C','#546E7A'],
      countryside: ['#66BB6A','#43A047'],
      mountain:    ['#90A4AE','#78909C'],
      abroad:      ['#81C784','#66BB6A'],
    };
    const [gc,gc2]=groundCols[biome];

    // Fill ground
    c.fillStyle=gc;
    c.beginPath(); c.moveTo(this.terrain[0].x, CH);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.lineTo(this.terrain[this.terrain.length-1].x, CH);
    c.closePath(); c.fill();

    // Surface line
    c.strokeStyle=gc2; c.lineWidth=3;
    c.beginPath(); c.moveTo(this.terrain[0].x, this.terrain[0].y);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.stroke();

    // Road markings for town/city
    if (biome === 'town' || biome === 'city') {
      c.strokeStyle='rgba(255,255,255,0.4)'; c.lineWidth=2; c.setLineDash([30,20]);
      const mY = this.playerGY - 8;
      c.beginPath(); c.moveTo(0,mY); c.lineTo(CW,mY); c.stroke();
      c.setLineDash([]);
    }
  }

  private drawObstacles(c: CanvasRenderingContext2D) {
    for (const o of this.obstacles) {
      if (o.type === 'pothole') {
        c.fillStyle='#5D4037'; c.beginPath(); c.ellipse(o.x+o.w/2, o.y+o.h, o.w/2, o.h/2, 0, 0, Math.PI*2); c.fill();
        c.fillStyle='#3E2723'; c.beginPath(); c.ellipse(o.x+o.w/2, o.y+o.h, o.w/2-3, o.h/2-2, 0, 0, Math.PI*2); c.fill();
      } else if (o.type === 'log') {
        c.fillStyle='#795548'; c.beginPath(); c.roundRect(o.x, o.y, o.w, o.h, 6); c.fill();
        c.fillStyle='#A1887F';
        for (let i=0;i<4;i++) { c.beginPath(); c.moveTo(o.x+6+i*8,o.y); c.lineTo(o.x+6+i*8,o.y+o.h); c.lineWidth=1; c.strokeStyle='#8D6E63'; c.stroke(); }
        c.strokeStyle='#6D4C41'; c.lineWidth=2;
        c.beginPath(); c.ellipse(o.x+4,o.y+o.h/2,4,o.h/2,0,0,Math.PI*2); c.stroke();
        c.beginPath(); c.ellipse(o.x+o.w-4,o.y+o.h/2,4,o.h/2,0,0,Math.PI*2); c.stroke();
      } else if (o.type === 'car') {
        c.fillStyle='#E53935'; c.beginPath(); c.roundRect(o.x, o.y, o.w, o.h, 5); c.fill();
        c.fillStyle='#1565C0'; c.beginPath(); c.roundRect(o.x+8, o.y+4, o.w-16, o.h*0.45, 4); c.fill();
        c.fillStyle='#37474F';
        c.beginPath(); c.arc(o.x+12, o.y+o.h, 9, 0, Math.PI*2); c.fill();
        c.beginPath(); c.arc(o.x+o.w-12, o.y+o.h, 9, 0, Math.PI*2); c.fill();
        c.fillStyle='#546E7A';
        c.beginPath(); c.arc(o.x+12, o.y+o.h, 5, 0, Math.PI*2); c.fill();
        c.beginPath(); c.arc(o.x+o.w-12, o.y+o.h, 5, 0, Math.PI*2); c.fill();
      } else if (o.type === 'barrier') {
        c.fillStyle='#fff'; c.fillRect(o.x, o.y, o.w, o.h);
        c.save(); c.beginPath(); c.rect(o.x,o.y,o.w,o.h); c.clip();
        c.fillStyle='#dc2626';
        for (let i=-2;i<5;i++) { c.beginPath(); c.moveTo(o.x+i*14,o.y); c.lineTo(o.x+i*14+14,o.y); c.lineTo(o.x+i*14-o.h,o.y+o.h); c.lineTo(o.x+i*14-o.h+14,o.y+o.h); c.closePath(); c.fill(); }
        c.restore();
        c.strokeStyle='#dc2626'; c.lineWidth=2; c.strokeRect(o.x,o.y,o.w,o.h);
        c.fillStyle='#374151'; c.fillRect(o.x-3,o.y+o.h,o.w+6,5);
      } else if (o.type === 'rock') {
        c.fillStyle='#78909C'; c.beginPath(); c.ellipse(o.x+o.w/2, o.y+o.h/2, o.w/2, o.h/2, -0.3, 0, Math.PI*2); c.fill();
        c.fillStyle='#B0BEC5'; c.beginPath(); c.ellipse(o.x+o.w/2-5, o.y+o.h/2-5, o.w/4, o.h/4, -0.3, 0, Math.PI*2); c.fill();
      }
    }
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      c.save(); c.globalAlpha = Math.max(0, p.alpha);
      c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI*2); c.fill();
      c.restore();
    }
    // Electric arc on downhill
    if (this.spd > 7 && this.state === 'playing') {
      c.save();
      c.strokeStyle = '#22c55e'; c.lineWidth = 1.5; c.globalAlpha = 0.6;
      for (let i=0;i<2;i++) {
        const sx = PLAYER_X + (Math.random()-.5)*20, sy = this.playerY - 40 + Math.random()*30;
        const ex = sx + (Math.random()-.5)*30, ey = sy + (Math.random()-.5)*30;
        c.beginPath(); c.moveTo(sx,sy); c.lineTo((sx+ex)/2+(Math.random()-.5)*15,(sy+ey)/2+(Math.random()-.5)*15); c.lineTo(ex,ey); c.stroke();
      }
      c.restore();
    }
  }

  private drawCyclist(c: CanvasRenderingContext2D) {
    const cx = PLAYER_X, cy = this.playerY;
    const t = this.animT;
    const leg = Math.sin(t * 0.42) * 0.5;
    const downhill = this.spd > 7;

    c.save();
    if (downhill) { c.shadowColor='#22c55e'; c.shadowBlur=20; }

    // Rear wheel
    const wheelR = 18;
    const spokeRot = t * 0.4;
    const drawWheel = (wx:number, wy:number) => {
      c.strokeStyle='#1e293b'; c.lineWidth=3;
      c.beginPath(); c.arc(wx,wy,wheelR,0,Math.PI*2); c.stroke();
      c.strokeStyle='#475569'; c.lineWidth=1.5;
      for (let i=0;i<6;i++) {
        const a = spokeRot + i*Math.PI/3;
        c.beginPath(); c.moveTo(wx,wy); c.lineTo(wx+Math.cos(a)*wheelR,wy+Math.sin(a)*wheelR); c.stroke();
      }
      c.fillStyle='#334155'; c.beginPath(); c.arc(wx,wy,4,0,Math.PI*2); c.fill();
    };
    drawWheel(cx-18, cy);
    drawWheel(cx+18, cy);

    // Frame (dark green)
    c.strokeStyle='#166534'; c.lineWidth=3; c.lineCap='round';
    c.beginPath();
    c.moveTo(cx-18,cy);   c.lineTo(cx-4,cy-20);   // seat tube
    c.moveTo(cx-4,cy-20); c.lineTo(cx+18,cy);      // down tube
    c.moveTo(cx-4,cy-20); c.lineTo(cx+14,cy-22);   // top tube
    c.moveTo(cx-18,cy);   c.lineTo(cx+18,cy);      // chain stay
    c.stroke();

    // Handlebars
    c.strokeStyle='#1e293b'; c.lineWidth=2;
    c.beginPath(); c.moveTo(cx+14,cy-22); c.lineTo(cx+22,cy-30); c.stroke();
    c.beginPath(); c.moveTo(cx+22,cy-30); c.lineTo(cx+24,cy-24); c.stroke();

    // Saddle
    c.strokeStyle='#1e293b'; c.lineWidth=2;
    c.beginPath(); c.moveTo(cx-10,cy-22); c.lineTo(cx+2,cy-22); c.stroke();

    // Body — leaning forward
    const bx = cx+2, by = cy-30;
    // Torso
    c.strokeStyle='#166534'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(bx,by); c.lineTo(bx+12,by-18); c.stroke();

    // Head
    c.beginPath(); c.arc(bx+14,by-24,9,0,Math.PI*2);
    c.fillStyle='#fde68a'; c.fill(); c.strokeStyle='#92400e'; c.lineWidth=1; c.stroke();

    // Helmet
    c.fillStyle='#166534';
    c.beginPath(); c.arc(bx+14,by-28,10,Math.PI,0); c.fill();
    c.beginPath(); c.roundRect(bx+4,by-28,20,5,2); c.fill();

    // Goggles (white band + orange lenses)
    c.fillStyle='#fed7aa'; c.fillRect(bx+8,by-24,14,5);
    c.fillStyle='#f97316';
    c.beginPath(); c.arc(bx+12,by-22,4,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(bx+19,by-22,4,0,Math.PI*2); c.fill();

    // Jersey (dark green with white cross — Deku inspired)
    c.fillStyle='#166534';
    c.beginPath(); c.roundRect(bx-1,by-18,14,12,3); c.fill();
    c.fillStyle='#fff';
    c.fillRect(bx+5,by-17,3,10); c.fillRect(bx+1,by-13,11,3);

    // Arms reaching forward to handlebars
    c.strokeStyle='#fde68a'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(bx+5,by-12); c.lineTo(cx+22,cy-28); c.stroke();
    c.fillStyle='#e5e7eb'; c.beginPath(); c.arc(cx+22,cy-28,3,0,Math.PI*2); c.fill();

    // Legs pedaling
    c.strokeStyle='#14532d'; c.lineWidth=3;
    const lx1 = Math.cos(leg)*14, ly1 = Math.sin(leg)*14;
    const lx2 = Math.cos(leg+Math.PI)*14, ly2 = Math.sin(leg+Math.PI)*14;
    c.beginPath();
    c.moveTo(cx,cy-4); c.lineTo(cx+lx1,cy-4+ly1); c.lineTo(cx+lx1+6,cy-4+ly1+3);
    c.stroke();
    c.beginPath();
    c.moveTo(cx,cy-4); c.lineTo(cx+lx2,cy-4+ly2); c.lineTo(cx+lx2+6,cy-4+ly2+3);
    c.stroke();

    // Shoes
    c.fillStyle='#1e293b';
    c.beginPath(); c.ellipse(cx+lx1+6,cy-4+ly1+4,7,4,0,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(cx+lx2+6,cy-4+ly2+4,7,4,0,0,Math.PI*2); c.fill();

    // Speed lines on downhill
    if (downhill) {
      c.strokeStyle='rgba(34,197,94,0.5)'; c.lineWidth=1.5;
      for (let i=0;i<4;i++) {
        const ly = cy - 30 + i*15;
        const len = 20 + Math.random()*30;
        c.beginPath(); c.moveTo(cx-30,ly); c.lineTo(cx-30-len,ly); c.stroke();
      }
    }

    c.restore();
  }

  private drawHUD(c: CanvasRenderingContext2D) {
    // Distance bar
    const barW = 300, barH = 26;
    const bx = CW/2 - barW/2, by = 8;
    c.fillStyle='rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(bx,by,barW,barH,8); c.fill();
    const prog = c.createLinearGradient(bx,0,bx+barW,0);
    prog.addColorStop(0,'#16a34a'); prog.addColorStop(1,'#86efac');
    c.fillStyle=prog;
    c.beginPath(); c.roundRect(bx+2,by+2,Math.max(0,(this.miles/TOTAL_MILES)*(barW-4)),barH-4,6); c.fill();
    c.fillStyle='#fff'; c.font='bold 12px sans-serif'; c.textAlign='center';
    c.fillText(`🚴 ${this.miles.toFixed(1)} / ${TOTAL_MILES} miles`, CW/2, by+18);

    // Speed
    const downhill = this.spd > 7;
    c.fillStyle='rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(CW-145,8,135,26,8); c.fill();
    if (downhill) { c.fillStyle='#4ade80'; } else { c.fillStyle='#fff'; }
    c.font='bold 12px sans-serif'; c.textAlign='left';
    c.fillText(downhill ? `⚡ ${this.spd.toFixed(1)} km/s` : `🚴 ${this.spd.toFixed(1)} km/s`, CW-133, 25);

    // Biome label
    c.fillStyle='rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(8,8,145,26,8); c.fill();
    c.fillStyle='#fff'; c.font='bold 12px sans-serif'; c.textAlign='left';
    c.fillText(this.currentBiome.label, 18, 25);

    // Hit warning
    if (this.hitTimer > 0) {
      c.fillStyle='rgba(239,68,68,0.5)'; c.fillRect(0,0,CW,CH);
      c.fillStyle='#fff'; c.font='bold 20px sans-serif'; c.textAlign='center';
      c.fillText('⚠ OBSTACLE HIT!', CW/2, CH/2);
    }
  }
}
