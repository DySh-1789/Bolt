import * as THREE from 'three';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';

export type ElevatorStatus = 'LOCKED' | 'READY' | 'CLOSING' | 'MOVING' | 'ARRIVED';

export interface ElevatorConfig {
  id: string;
  centerZ: number;
  width: number;
  depth: number;
  cabinHeight: number;
  startY: number;
  endY: number;
  startFloor: number;
  endFloor: number;
  destinationTitle: string;
  accentHex: number;
  accentCss: string;
  bottomDoorId: string;
  topDoorId: string;
  buttonInteractableId: string;
  rideDuration?: number;
}

export interface ElevatorStepResult {
  beganMoving: boolean;
  floorChanged: boolean;
  arrived: boolean;
  currentY: number;
  currentFloor: number;
}

/**
 * Pure elevator state machine (decoupled from Three.js/DOM for deterministic unit tests).
 */
export class ElevatorState {
  readonly startY: number;
  readonly endY: number;
  readonly startFloor: number;
  readonly endFloor: number;
  readonly closeDuration = 0.65;
  readonly rideDuration: number;

  status: ElevatorStatus = 'LOCKED';
  currentY: number;
  currentFloor: number;
  private timer = 0;

  constructor(
    startY: number,
    endY: number,
    startFloor: number,
    endFloor: number,
    rideDuration = 4.2,
  ) {
    this.startY = startY;
    this.endY = endY;
    this.startFloor = startFloor;
    this.endFloor = endFloor;
    this.rideDuration = rideDuration;
    this.currentY = startY;
    this.currentFloor = startFloor;
  }

  reset(): void {
    this.status = 'LOCKED';
    this.currentY = this.startY;
    this.currentFloor = this.startFloor;
    this.timer = 0;
  }

  unlock(): void {
    if (this.status === 'LOCKED') {
      this.status = 'READY';
    }
  }

  startRide(): boolean {
    if (this.status !== 'READY') return false;
    this.status = 'CLOSING';
    this.timer = 0;
    return true;
  }

  snapToTop(): void {
    this.status = 'ARRIVED';
    this.currentY = this.endY;
    this.currentFloor = this.endFloor;
    this.timer = 0;
  }

  update(dt: number): ElevatorStepResult {
    let beganMoving = false;
    let floorChanged = false;
    let arrived = false;

    if (this.status === 'CLOSING') {
      this.timer += dt;
      if (this.timer >= this.closeDuration) {
        this.status = 'MOVING';
        this.timer = 0;
        beganMoving = true;
      }
    } else if (this.status === 'MOVING') {
      this.timer += dt;
      const p = Math.max(0, Math.min(1, this.timer / this.rideDuration));
      // Smooth quintic S-curve acceleration & deceleration
      const ease = p * p * p * (p * (p * 6 - 15) + 10);
      this.currentY = this.startY + (this.endY - this.startY) * ease;

      const nextFloor = Math.round(this.startFloor + (this.endFloor - this.startFloor) * ease);
      if (nextFloor !== this.currentFloor) {
        this.currentFloor = nextFloor;
        floorChanged = true;
      }

      if (p >= 1) {
        this.status = 'ARRIVED';
        this.currentY = this.endY;
        this.currentFloor = this.endFloor;
        arrived = true;
      }
    }

    return {
      beganMoving,
      floorChanged,
      arrived,
      currentY: this.currentY,
      currentFloor: this.currentFloor,
    };
  }
}

/**
 * Physical 3D Cyberpunk Elevator Shaft + Moving Cabin with glass shaft view,
 * neon passing floor rings, live CanvasTexture floor counter, and interior console.
 */
export class ElevatorRig {
  readonly config: ElevatorConfig;
  readonly state: ElevatorState;
  readonly root = new THREE.Group();
  readonly cabin = new THREE.Group();

  private displayCanvas: HTMLCanvasElement;
  private displayCtx: CanvasRenderingContext2D;
  private displayTex: THREE.CanvasTexture;
  private buttonGlowMat: THREE.MeshStandardMaterial;
  private lastRenderedFloor = -1;
  private lastRenderedStatus: ElevatorStatus | null = null;

  constructor(
    parent: THREE.Group,
    physics: PhysicsWorld,
    textures: ProceduralTextures,
    config: ElevatorConfig,
  ) {
    this.config = config;
    this.state = new ElevatorState(
      config.startY,
      config.endY,
      config.startFloor,
      config.endFloor,
      config.rideDuration ?? 4.2,
    );

    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 512;
    this.displayCanvas.height = 192;
    const ctx = this.displayCanvas.getContext('2d');
    if (!ctx) throw new Error('Unable to initialize 2D context for elevator display');
    this.displayCtx = ctx;

    this.displayTex = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;

    this.buttonGlowMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 1.8,
    });

    this.buildShaft(physics);
    this.buildCabin(textures);

    this.cabin.position.set(0, config.startY, config.centerZ);
    this.root.add(this.cabin);
    parent.add(this.root);

    this.redrawDisplay();
  }

  private buildShaft(physics: PhysicsWorld): void {
    const { id, centerZ, width, depth, cabinHeight, startY, endY, accentHex } = this.config;
    const shaftBottom = startY - 1.5;
    const shaftTop = endY + cabinHeight + 3.0;
    const shaftHeight = shaftTop - shaftBottom;
    const shaftMidY = (shaftBottom + shaftTop) * 0.5;
    const halfW = width * 0.5;
    const halfD = depth * 0.5;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a2234,
      metalness: 0.35,
      roughness: 0.58,
    });
    const shaftWallMat = new THREE.MeshStandardMaterial({
      color: 0x141b2c,
      metalness: 0.25,
      roughness: 0.65,
    });
    const neonMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: accentHex,
      emissiveIntensity: 1.5,
      roughness: 0.35,
    });

    // Full-height left/right physical shaft colliders + exterior visual shaft shell
    physics.addStaticBox(`${id}_shaft_w`, -(halfW + 0.45), shaftMidY, centerZ, 0.9, shaftHeight, depth + 0.6, true);
    physics.addStaticBox(`${id}_shaft_e`, halfW + 0.45, shaftMidY, centerZ, 0.9, shaftHeight, depth + 0.6, true);

    // Outer recessed shaft backdrop walls (set 1.8m outside the glass cabin walls so Samir sees depth!)
    const outerOffset = halfW + 1.8;
    for (const side of [-1, 1]) {
      const outerWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, shaftHeight, depth - 0.2), shaftWallMat);
      outerWall.position.set(side * outerOffset, shaftMidY, centerZ);
      this.root.add(outerWall);

      // Vertical structural guide rails inside shaft
      for (const rz of [-halfD + 0.6, 0, halfD - 0.6]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, shaftHeight, 0.28), frameMat);
        rail.position.set(side * (halfW + 0.75), shaftMidY, centerZ + rz);
        this.root.add(rail);
      }
      // Vertical neon guide strip
      const vNeon = new THREE.Mesh(new THREE.BoxGeometry(0.1, shaftHeight, 0.14), neonMat);
      vNeon.position.set(side * (halfW + 1.45), shaftMidY, centerZ);
      this.root.add(vNeon);
    }

    // Horizontal luminous floor rings spaced every 2.4m vertically (give vivid sense of vertical speed!)
    for (let y = startY + 2.2; y < shaftTop - 1.5; y += 2.4) {
      const ringColor = Math.round(y) % 2 === 0 ? accentHex : 0x00f0ff;
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringColor,
        emissive: ringColor,
        emissiveIntensity: 1.5,
        roughness: 0.35,
      });
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, depth - 0.8), ringMat);
        bar.position.set(side * (halfW + 1.42), y, centerZ);
        this.root.add(bar);
      }
      // Horizontal front/back shaft ribs (outside cabin travel path)
      const northBar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.14, 0.18), ringMat);
      northBar.position.set(0, y, centerZ - halfD - 0.55);
      if (y < endY - 0.2) this.root.add(northBar);

      const southBar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.14, 0.18), ringMat);
      southBar.position.set(0, y, centerZ + halfD + 0.55);
      if (y > startY + cabinHeight + 0.4) this.root.add(southBar);
    }

    // Solid shaft wall on SOUTH face ABOVE the lower doorway (prevents walking out when at upper floor)
    const southUpperBottom = startY + cabinHeight + 0.2;
    const southUpperH = shaftTop - southUpperBottom;
    if (southUpperH > 0.5) {
      const cy = southUpperBottom + southUpperH * 0.5;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, southUpperH, 0.6), shaftWallMat);
      mesh.position.set(0, cy, centerZ + halfD + 0.3);
      this.root.add(mesh);
      physics.addStaticBox(`${id}_south_upper`, 0, cy, centerZ + halfD + 0.3, width + 1.2, southUpperH, 0.8, true);
    }

    // Solid shaft wall on NORTH face BELOW the upper floor (prevents walking out when at bottom floor)
    const northLowerH = endY - shaftBottom;
    if (northLowerH > 0.5) {
      const cy = shaftBottom + northLowerH * 0.5;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, northLowerH, 0.6), shaftWallMat);
      mesh.position.set(0, cy, centerZ - halfD - 0.3);
      this.root.add(mesh);
      physics.addStaticBox(`${id}_north_lower`, 0, cy, centerZ - halfD - 0.3, width + 1.2, northLowerH, 0.8, true);
    }

    // Shaft cap ceiling above top floor
    const cap = new THREE.Mesh(new THREE.BoxGeometry(width + 4, 0.6, depth), frameMat);
    cap.position.set(0, shaftTop, centerZ);
    this.root.add(cap);
  }

  private buildCabin(textures: ProceduralTextures): void {
    const { width, depth, cabinHeight, accentHex } = this.config;
    const innerW = width - 0.2;
    const innerD = depth - 0.6;
    const halfW = innerW * 0.5;
    const halfD = innerD * 0.5;

    const floorMat = new THREE.MeshStandardMaterial({
      map: textures.getFloorTile(this.config.accentCss, 2, 2),
      metalness: 0.22,
      roughness: 0.55,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x252f45,
      metalness: 0.35,
      roughness: 0.5,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8c2,
      metalness: 0.65,
      roughness: 0.32,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e3552,
      metalness: 0.15,
      roughness: 0.15,
      transparent: true,
      opacity: 0.24,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: accentHex,
      emissiveIntensity: 1.5,
      roughness: 0.35,
    });

    // Solid cabin floor plate
    const floorPlate = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.3, innerD), floorMat);
    floorPlate.position.set(0, -0.15, 0);
    this.cabin.add(floorPlate);

    // Ceiling + recessed glow diffuser
    const ceilPlate = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.25, innerD), metalMat);
    ceilPlate.position.set(0, cabinHeight + 0.1, 0);
    this.cabin.add(ceilPlate);

    const ceilGlow = new THREE.Mesh(
      new THREE.BoxGeometry(innerW * 0.55, 0.06, innerD * 0.62),
      new THREE.MeshStandardMaterial({
        color: 0xd6eeff,
        emissive: 0x9fd8ff,
        emissiveIntensity: 1.25,
      }),
    );
    ceilGlow.position.set(0, cabinHeight - 0.04, 0);
    this.cabin.add(ceilGlow);

    // Cozy interior cabin light (balanced — zero glare)
    const cabinLight = new THREE.PointLight(0xbce2ff, 12, 13, 1.5);
    cabinLight.position.set(0, cabinHeight - 0.5, 0);
    this.cabin.add(cabinLight);

    // Side walls: lower kickplate + upper header + panoramic glass window looking into vertical shaft + chrome handrail!
    for (const side of [-1, 1]) {
      const wx = side * (halfW - 0.08);

      // Lower kickplate
      const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, innerD), metalMat);
      lowerWall.position.set(wx, 0.525, 0);
      this.cabin.add(lowerWall);

      // Upper header
      const upperWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, innerD), metalMat);
      upperWall.position.set(wx, cabinHeight - 0.425, 0);
      this.cabin.add(upperWall);

      // Corner frame mullions
      for (const mz of [-halfD + 0.12, halfD - 0.12]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, cabinHeight, 0.24), metalMat);
        post.position.set(wx, cabinHeight * 0.5, mz);
        this.cabin.add(post);
      }

      // Panoramic glass window pane
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, cabinHeight - 1.9, innerD - 0.4), glassMat);
      glass.position.set(wx, 1.05 + (cabinHeight - 1.9) * 0.5, 0);
      this.cabin.add(glass);

      // Handrail + glowing accent strip
      const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, innerD - 1.2, 8), railMat);
      handrail.rotation.x = Math.PI / 2;
      handrail.position.set(wx - side * 0.22, 1.12, 0);
      this.cabin.add(handrail);

      const floorTrim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, innerD - 0.4), trimMat);
      floorTrim.position.set(wx - side * 0.08, 0.06, 0);
      this.cabin.add(floorTrim);
    }

    // Glowing Elevator Button Control Console on right interior wall
    const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.95, 0.52), metalMat);
    consoleBody.position.set(halfW - 0.22, 1.45, -1.2);
    this.cabin.add(consoleBody);

    const callButton = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.24), this.buttonGlowMat);
    callButton.position.set(halfW - 0.32, 1.52, -1.2);
    this.cabin.add(callButton);

    // Live Digital Floor Display mounted above the north exit portal
    const displayPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.05),
      new THREE.MeshStandardMaterial({
        map: this.displayTex,
        emissiveMap: this.displayTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
    );
    displayPanel.position.set(0, cabinHeight - 0.65, -halfD + 0.14);
    this.cabin.add(displayPanel);
  }

  isPlayerInside(px: number, pz: number): boolean {
    const halfW = this.config.width * 0.5 - 0.2;
    const halfD = this.config.depth * 0.5 - 0.35;
    return (
      Math.abs(px) <= halfW &&
      pz <= this.config.centerZ + halfD &&
      pz >= this.config.centerZ - halfD
    );
  }

  redrawDisplay(): void {
    const ctx = this.displayCtx;
    const { accentCss, destinationTitle } = this.config;
    const floorStr = String(this.state.currentFloor).padStart(2, '0');
    const st = this.state.status;

    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, 512, 192);

    ctx.strokeStyle = accentCss;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 180);

    // Status line
    ctx.fillStyle = st === 'MOVING' ? '#fcee0a' : st === 'ARRIVED' ? '#00ff88' : accentCss;
    ctx.font = '800 22px monospace';
    const statusText =
      st === 'LOCKED'
        ? 'ДОСТУП ЗАБЛОКИРОВАН'
        : st === 'READY'
          ? 'ЛИФТ ГОТОВ // НАЖМИТЕ [E]'
          : st === 'CLOSING'
            ? 'ДВЕРИ ЗАКРЫВАЮТСЯ...'
            : st === 'MOVING'
              ? '▲ ПОДЪЁМ // MARAKULIN EXPRESS'
              : '✓ ПРИБЫТИЕ НА ЭТАЖ';
    ctx.fillText(statusText, 24, 40);

    // Huge digital floor counter
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 84px monospace';
    ctx.fillText(`ЭТ.${floorStr}`, 24, 134);

    // Up arrow icon
    if (st === 'MOVING' || st === 'CLOSING') {
      ctx.fillStyle = '#fcee0a';
      ctx.beginPath();
      ctx.moveTo(430, 62);
      ctx.lineTo(476, 132);
      ctx.lineTo(384, 132);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 22px monospace';
      ctx.fillText(destinationTitle, 24, 170);
    }

    if (st === 'MOVING' || st === 'CLOSING') {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 20px monospace';
      ctx.fillText(`ЦЕЛЬ: ${destinationTitle}`, 24, 170);
    }

    this.displayTex.needsUpdate = true;
    this.lastRenderedFloor = this.state.currentFloor;
    this.lastRenderedStatus = st;

    // Update control button color
    const btnColor =
      st === 'LOCKED' ? 0xff003c : st === 'READY' ? 0xfcee0a : st === 'ARRIVED' ? 0x00ff88 : 0x00f0ff;
    this.buttonGlowMat.color.setHex(btnColor);
    this.buttonGlowMat.emissive.setHex(btnColor);
  }

  syncVisuals(): void {
    this.cabin.position.y = this.state.currentY;
    if (
      this.state.currentFloor !== this.lastRenderedFloor ||
      this.state.status !== this.lastRenderedStatus
    ) {
      this.redrawDisplay();
    }
  }

  reset(): void {
    this.state.reset();
    this.syncVisuals();
  }

  snapToTop(): void {
    this.state.snapToTop();
    this.syncVisuals();
  }

  update(dt: number): ElevatorStepResult {
    const res = this.state.update(dt);
    this.syncVisuals();
    return res;
  }

  dispose(): void {
    this.displayTex.dispose();
    const disposedMats = new Set<THREE.Material>();
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!disposedMats.has(m)) {
            disposedMats.add(m);
            m.dispose();
          }
        }
      }
    });
  }
}
