import * as THREE from 'three';
import type { BossPhase, Vec3 } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';

export class LevSmasherState {
  readonly maxHp = 900;
  hp = 900;
  phase: BossPhase = 'DORMANT';
  readonly phase2Threshold = 0.6;
  readonly finisherHpThreshold = 0.2;

  reset(): void {
    this.hp = this.maxHp;
    this.phase = 'DORMANT';
  }

  getHpRatio(): number {
    return this.hp / this.maxHp;
  }

  startKnockback(): void {
    this.phase = 'KNOCKBACK';
  }

  startPhase1(): void {
    this.hp = this.maxHp;
    this.phase = 'PHASE_1';
  }

  /**
   * Applies damage to Lev Smasher. HP cannot drop below the scripted finisher threshold
   * because narrative flow culminates in Smasher gravely wounding Samir before he can be killed.
   */
  applyDamage(amount: number): {
    actualDamage: number;
    enteredPhase2: boolean;
    triggeredFinisher: boolean;
  } {
    if (this.phase !== 'PHASE_1' && this.phase !== 'PHASE_2') {
      return { actualDamage: 0, enteredPhase2: false, triggeredFinisher: false };
    }

    const minHp = this.maxHp * this.finisherHpThreshold;
    const prevHp = this.hp;
    this.hp = Math.max(minHp, this.hp - Math.max(0, amount));
    const actualDamage = prevHp - this.hp;

    let enteredPhase2 = false;
    let triggeredFinisher = false;

    if (this.phase === 'PHASE_1' && this.getHpRatio() <= this.phase2Threshold) {
      this.phase = 'PHASE_2';
      enteredPhase2 = true;
    }

    if (this.phase === 'PHASE_2' && this.getHpRatio() <= this.finisherHpThreshold + 0.001) {
      this.phase = 'FINISHER';
      triggeredFinisher = true;
    }

    return { actualDamage, enteredPhase2, triggeredFinisher };
  }

  /**
   * In Phase 2, if Samir's HP falls critically low (<= 10%), trigger the scripted heavy wounding
   * rather than an abrupt game-over screen so the story flows seamlessly to the Operating Table.
   */
  shouldTriggerFinisherFromPlayerLowHp(playerHp: number): boolean {
    if (this.phase === 'PHASE_2' && playerHp <= 10) {
      this.phase = 'FINISHER';
      return true;
    }
    return false;
  }

  markFinished(): void {
    this.phase = 'FINISHED';
  }
}

interface BossProjectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  life: number;
}

interface TelegraphMissile {
  ring: THREE.Mesh;
  missile: THREE.Mesh;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  timer: number;
  maxTimer: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  prevRadius: number;
  radius: number;
  maxRadius: number;
  damagedPlayer: boolean;
}

interface AfterimageGhost {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export interface BossHitResult {
  hit: boolean;
  headshot: boolean;
  damage: number;
  enteredPhase2: boolean;
  triggeredFinisher: boolean;
  point: THREE.Vector3;
}

export interface BossCallbacks {
  onAutocannonShot: () => void;
  onMissileExplode: () => void;
  onRoar: () => void;
  onPlayerDamaged: (amount: number, knockShake: number) => void;
  onProjectileHitEnemy?: (from: Vec3, to: Vec3, damage: number) => boolean;
  onAreaDamageEnemies?: (center: Vec3, radius: number, damage: number, ignoreY?: boolean) => void;
}

function segmentHitsCylinder(
  from: Vec3,
  to: Vec3,
  cx: number,
  cz: number,
  minY: number,
  maxY: number,
  radius: number,
): { hit: boolean; distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lenXZSq = dx * dx + dz * dz;
  let t = 0;
  if (lenXZSq > 1e-8) {
    t = Math.max(0, Math.min(1, ((cx - from.x) * dx + (cz - from.z) * dz) / lenXZSq));
  }
  const px = from.x + dx * t;
  const py = from.y + dy * t;
  const pz = from.z + dz * t;
  const distSq = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
  if (distSq <= radius * radius && py >= minY && py <= maxY) {
    return { hit: true, distance: t * Math.hypot(dx, dy, dz) };
  }
  return { hit: false, distance: Number.POSITIVE_INFINITY };
}

export class LevSmasherBoss {
  readonly state = new LevSmasherState();
  readonly group = new THREE.Group();

  private headHitbox!: THREE.Mesh;
  private bodyHitbox!: THREE.Mesh;
  private hitMeshes: THREE.Object3D[] = [];
  private rightArmPivot!: THREE.Group;
  private leftArmPivot!: THREE.Group;
  private muzzleGlow!: THREE.Mesh;
  private coreMat!: THREE.MeshStandardMaterial;

  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private raycaster = new THREE.Raycaster();

  private projectiles: BossProjectile[] = [];
  private missiles: TelegraphMissile[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private afterimages: AfterimageGhost[] = [];

  private gunTimer = 1.0;
  private burstRemaining = 0;
  private burstSpacing = 0;
  private missileTimer = 4.2;
  private sandevistanDashTimer = 3.2;
  private activeDashTime = 0;
  private dashVelocity = new THREE.Vector3();
  private afterimageSpawnAccum = 0;
  private hitFlashTimer = 0;
  private walkCycle = 0;
  private floorY = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
    this.buildModel();
    this.group.visible = false;
    this.scene.add(this.group);
  }

  /**
   * Builds the towering 3.1m full-borg juggernaut "Lev Smasher" with crimson skull-visor,
   * rotary autocannon, cyber-claw, and shoulder missile pod.
   */
  private buildModel(): void {
    const darkArmor = new THREE.MeshStandardMaterial({
      color: 0x30374a,
      metalness: 0.62,
      roughness: 0.32,
    });
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x546078,
      metalness: 0.7,
      roughness: 0.25,
    });
    const crimsonAccent = new THREE.MeshStandardMaterial({
      color: 0xb81432,
      metalness: 0.5,
      roughness: 0.35,
    });
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 3.2,
    });

    // Heavy hydraulic legs
    const legGeo = new THREE.BoxGeometry(0.48, 1.32, 0.56);
    const legL = new THREE.Mesh(legGeo, darkArmor);
    legL.position.set(-0.46, 0.66, 0);
    const legR = legL.clone();
    legR.position.x = 0.46;
    legL.userData = { isBoss: true, isHead: false };
    legR.userData = { isBoss: true, isHead: false };
    this.group.add(legL, legR);

    // Knee piston guards
    const kneeGeo = new THREE.BoxGeometry(0.54, 0.32, 0.64);
    const kneeL = new THREE.Mesh(kneeGeo, crimsonAccent);
    kneeL.position.set(-0.46, 0.72, 0.08);
    const kneeR = kneeL.clone();
    kneeR.position.x = 0.46;
    this.group.add(kneeL, kneeR);

    // Massive armored torso (Body Hitbox)
    this.bodyHitbox = new THREE.Mesh(new THREE.BoxGeometry(1.56, 1.32, 0.96), darkArmor);
    this.bodyHitbox.position.set(0, 1.94, 0);
    this.bodyHitbox.castShadow = true;
    this.group.add(this.bodyHitbox);

    // Ribbed chest plates + glowing crimson reactor core
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.72, 0.25), crimsonAccent);
    chestPlate.position.set(0, 2.02, 0.45);
    chestPlate.userData = { isBoss: true, isHead: false };
    this.group.add(chestPlate);

    const reactorCore = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12), this.coreMat);
    reactorCore.rotation.x = Math.PI / 2;
    reactorCore.position.set(0, 2.04, 0.5);
    this.group.add(reactorCore);

    // Heavy pauldrons
    const pauldronGeo = new THREE.BoxGeometry(0.75, 0.56, 0.95);
    const pauldronL = new THREE.Mesh(pauldronGeo, gunmetal);
    pauldronL.position.set(-1.05, 2.48, 0);
    pauldronL.rotation.z = 0.18;
    const pauldronR = pauldronL.clone();
    pauldronR.position.x = 1.05;
    pauldronR.rotation.z = -0.18;
    pauldronL.userData = { isBoss: true, isHead: false };
    pauldronR.userData = { isBoss: true, isHead: false };
    this.group.add(pauldronL, pauldronR);

    // Shoulder-mounted multi-missile pod (Left shoulder)
    const missilePod = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.82), crimsonAccent);
    missilePod.position.set(-0.98, 2.94, -0.05);
    missilePod.userData = { isBoss: true, isHead: false };
    this.group.add(missilePod);
    for (const mx of [-0.15, 0.15]) {
      for (const my of [-0.12, 0.12]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8), this.coreMat);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(-0.98 + mx, 2.94 + my, 0.36);
        this.group.add(tube);
      }
    }

    // Borg skull head (Head Hitbox)
    this.headHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.58, 0.58), gunmetal);
    this.headHitbox.position.set(0, 2.86, 0.14);
    this.group.add(this.headHitbox);

    // Iconic glowing crimson cyber-eyes + jaw grille
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.08), this.coreMat);
    eyeL.position.set(-0.13, 0.06, 0.28);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.13;
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.12), crimsonAccent);
    brow.position.set(0, 0.17, 0.28);
    eyeL.userData = { isBoss: true, isHead: true };
    eyeR.userData = { isBoss: true, isHead: true };
    brow.userData = { isBoss: true, isHead: true };
    this.headHitbox.add(eyeL, eyeR, brow);

    // Right arm with heavy rotary autocannon
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(1.12, 2.25, 0.1);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.05, 0.42), darkArmor);
    armR.position.set(0, -0.35, 0.2);
    armR.rotation.x = -0.65;
    armR.userData = { isBoss: true, isHead: false };
    this.rightArmPivot.add(armR);
    const cannonBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.45, 10), gunmetal);
    cannonBody.rotation.x = Math.PI / 2;
    cannonBody.position.set(0, -0.58, 1.05);
    this.rightArmPivot.add(cannonBody);
    this.muzzleGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 8), this.coreMat);
    this.muzzleGlow.rotation.x = Math.PI / 2;
    this.muzzleGlow.position.set(0, -0.58, 1.78);
    this.rightArmPivot.add(this.muzzleGlow);
    this.group.add(this.rightArmPivot);

    // Left arm with crushing cyber-fist
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-1.12, 2.25, 0.1);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.12, 0.44), darkArmor);
    armL.position.set(0, -0.42, 0.16);
    armL.rotation.x = -0.35;
    armL.userData = { isBoss: true, isHead: false };
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.56), crimsonAccent);
    fist.position.set(0, -0.92, 0.44);
    fist.userData = { isBoss: true, isHead: false };
    this.leftArmPivot.add(armL, fist);
    this.group.add(this.leftArmPivot);

    // Point light radiating menacing red aura around Lev Smasher
    const aura = new THREE.PointLight(0xff1a48, 14, 14, 1.5);
    aura.position.set(0, 2.2, 0.8);
    this.group.add(aura);

    this.bodyHitbox.userData = { isBoss: true, isHead: false };
    this.headHitbox.userData = { isBoss: true, isHead: true };
    this.hitMeshes = [
      this.headHitbox,
      eyeL,
      eyeR,
      brow,
      this.bodyHitbox,
      chestPlate,
      legL,
      legR,
      pauldronL,
      pauldronR,
      missilePod,
      armR,
      armL,
      fist,
    ];
  }

  appearForKnockback(x: number, z: number, floorY = 0): void {
    this.clearEffects();
    this.floorY = floorY;
    this.state.reset();
    this.state.startKnockback();
    this.group.visible = true;
    this.group.position.set(x, this.floorY, z);
    this.group.rotation.set(0, 0, 0);
    this.hitFlashTimer = 0;
    const bodyMat = this.bodyHitbox.material as THREE.MeshStandardMaterial;
    bodyMat.emissive.setHex(0x000000);
    bodyMat.emissiveIntensity = 0;
    // Raise left fist in crushing strike pose
    this.leftArmPivot.rotation.x = -1.35;
    this.rightArmPivot.rotation.x = -0.35;
  }

  beginCombat(x = 0, z = -134, floorY = 0): void {
    this.clearEffects();
    this.floorY = floorY;
    this.group.visible = true;
    this.group.position.set(x, this.floorY, z);
    this.state.startPhase1();
    this.gunTimer = 1.1;
    this.burstRemaining = 0;
    this.burstSpacing = 0;
    this.missileTimer = 3.8;
    this.sandevistanDashTimer = 2.8;
    this.activeDashTime = 0;
    this.afterimageSpawnAccum = 0;
    this.hitFlashTimer = 0;
    this.walkCycle = 0;
    const bodyMat = this.bodyHitbox.material as THREE.MeshStandardMaterial;
    bodyMat.emissive.setHex(0x000000);
    bodyMat.emissiveIntensity = 0;
    this.leftArmPivot.rotation.x = 0;
    this.rightArmPivot.rotation.x = 0;
  }

  hide(): void {
    this.group.visible = false;
    this.clearEffects();
  }

  /**
   * Positions Lev Smasher in an unobstructed spot near Samir (avoiding pillars/walls)
   * for the scripted defeat finisher and returns his final XZ position.
   */
  positionForFinisher(playerPos: Vec3, playerYaw: number): { x: number; z: number } {
    this.clearEffects();
    this.group.visible = true;

    const dist = 3.1;
    const candidateAngles = [0, 0.55, -0.55, 1.15, -1.15, Math.PI, Math.PI * 0.5, -Math.PI * 0.5];
    let bestX = Math.max(-15, Math.min(15, playerPos.x));
    let bestZ = Math.max(-138, Math.min(-94, playerPos.z - dist));

    for (const offset of candidateAngles) {
      const a = playerYaw + offset;
      const fx = -Math.sin(a);
      const fz = -Math.cos(a);
      const rawX = Math.max(-15.5, Math.min(15.5, playerPos.x + fx * dist));
      const rawZ = Math.max(-138.5, Math.min(-93.5, playerPos.z + fz * dist));
      const resolved = this.physics.resolveCylinderMove(
        { x: rawX, y: this.floorY, z: rawZ },
        rawX,
        rawZ,
        0.95,
        this.floorY,
        2.8,
      );
      const sep = Math.hypot(resolved.x - playerPos.x, resolved.z - playerPos.z);
      if (sep >= 2.0 && this.physics.hasLineOfSight(
        { x: playerPos.x, y: this.floorY + 1.0, z: playerPos.z },
        { x: resolved.x, y: this.floorY + 1.8, z: resolved.z },
      )) {
        bestX = resolved.x;
        bestZ = resolved.z;
        break;
      }
    }

    this.group.position.set(bestX, this.floorY, bestZ);
    this.group.rotation.y = Math.atan2(playerPos.x - bestX, playerPos.z - bestZ);
    this.leftArmPivot.rotation.x = -1.6;
    this.spawnShockwave(bestX, bestZ, 7.5);
    return { x: bestX, z: bestZ };
  }

  /**
   * Slowly stalks closer over fallen Samir during the blackout monologue (respecting pillars).
   */
  updateFinisherLoom(dt: number, playerPos: Vec3): void {
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    this.group.rotation.y = Math.atan2(dx, dz);
    if (dist > 1.85) {
      const nextX = this.group.position.x + (dx / dist) * 1.15 * dt;
      const nextZ = this.group.position.z + (dz / dist) * 1.15 * dt;
      const res = this.physics.resolveCylinderMove(this.group.position, nextX, nextZ, 0.95, this.floorY, 2.8);
      this.group.position.x = res.x;
      this.group.position.z = res.z;
    }
    this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, -0.3, Math.min(1, dt * 2.4));
    this.updateShockwaves(dt, playerPos, false);
  }

  handlePlayerShot(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxWallDist: number,
    baseDamage = 38,
  ): BossHitResult {
    if (!this.group.visible || (this.state.phase !== 'PHASE_1' && this.state.phase !== 'PHASE_2')) {
      return {
        hit: false,
        headshot: false,
        damage: 0,
        enteredPhase2: false,
        triggeredFinisher: false,
        point: new THREE.Vector3(),
      };
    }

    this.raycaster.set(origin, direction);
    this.raycaster.far = maxWallDist;
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false);
    if (hits.length === 0) {
      return {
        hit: false,
        headshot: false,
        damage: 0,
        enteredPhase2: false,
        triggeredFinisher: false,
        point: new THREE.Vector3(),
      };
    }

    const first = hits[0];
    const isHead = Boolean(first.object.userData.isHead);
    const dmg = isHead ? baseDamage * 1.85 : baseDamage;
    const res = this.state.applyDamage(dmg);
    this.hitFlashTimer = 0.12;

    return {
      hit: true,
      headshot: isHead,
      damage: res.actualDamage,
      enteredPhase2: res.enteredPhase2,
      triggeredFinisher: res.triggeredFinisher,
      point: first.point.clone(),
    };
  }

  handleFlameMelee(origin: THREE.Vector3, forward: THREE.Vector3): {
    hit: boolean;
    damage: number;
    enteredPhase2: boolean;
    triggeredFinisher: boolean;
  } {
    if (!this.group.visible || (this.state.phase !== 'PHASE_1' && this.state.phase !== 'PHASE_2')) {
      return { hit: false, damage: 0, enteredPhase2: false, triggeredFinisher: false };
    }
    const targetPos = new THREE.Vector3(this.group.position.x, this.floorY + 1.6, this.group.position.z);
    const toBoss = new THREE.Vector3().subVectors(targetPos, origin);
    const dist = toBoss.length();
    if (dist > 5.0) {
      return { hit: false, damage: 0, enteredPhase2: false, triggeredFinisher: false };
    }
    if (dist > 1e-4 && toBoss.divideScalar(dist).dot(forward) < 0.4) {
      return { hit: false, damage: 0, enteredPhase2: false, triggeredFinisher: false };
    }
    if (!this.physics.hasLineOfSight(origin, targetPos)) {
      return { hit: false, damage: 0, enteredPhase2: false, triggeredFinisher: false };
    }
    const res = this.state.applyDamage(55);
    this.hitFlashTimer = 0.14;
    return {
      hit: true,
      damage: res.actualDamage,
      enteredPhase2: res.enteredPhase2,
      triggeredFinisher: res.triggeredFinisher,
    };
  }

  private isCombatActive(): boolean {
    return this.group.visible && (this.state.phase === 'PHASE_1' || this.state.phase === 'PHASE_2');
  }

  updateCombat(
    worldDt: number,
    playerPos: Vec3,
    playerEye: Vec3,
    callbacks: BossCallbacks,
  ): void {
    if (!this.isCombatActive()) return;

    // Hit flash
    const bodyMat = this.bodyHitbox.material as THREE.MeshStandardMaterial;
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= worldDt;
      bodyMat.emissive.setHex(0xff3355);
      bodyMat.emissiveIntensity = 0.7;
    } else {
      bodyMat.emissive.setHex(0x000000);
      bodyMat.emissiveIntensity = 0;
    }

    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    this.group.rotation.y = Math.atan2(dx, dz);

    const isPhase2 = this.state.phase === 'PHASE_2';

    // Movement / Phase 2 Sandevistan Dash
    if (this.activeDashTime > 0) {
      this.activeDashTime -= worldDt;
      this.group.position.y = this.floorY;
      this.afterimageSpawnAccum += worldDt;
      if (this.afterimageSpawnAccum >= 0.065) {
        this.afterimageSpawnAccum = 0;
        this.spawnAfterimage();
      }
      const nextX = this.group.position.x + this.dashVelocity.x * worldDt;
      const nextZ = this.group.position.z + this.dashVelocity.z * worldDt;
      const res = this.physics.resolveCylinderMove(this.group.position, nextX, nextZ, 0.95, this.floorY, 2.8);
      this.group.position.x = res.x;
      this.group.position.z = res.z;

      // Lev Smasher bowls through any surviving corporate troops during his Sandevistan charge
      callbacks.onAreaDamageEnemies?.(
        { x: this.group.position.x, y: this.floorY + 1.2, z: this.group.position.z },
        2.2,
        140 * worldDt,
        true,
      );

      if (this.activeDashTime <= 0) {
        // End of Sandevistan dash: ground slam shockwave!
        this.spawnShockwave(this.group.position.x, this.group.position.z, 11.5);
        callbacks.onAreaDamageEnemies?.(
          { x: this.group.position.x, y: this.floorY + 1.0, z: this.group.position.z },
          9.0,
          75,
          true,
        );
        callbacks.onMissileExplode();
      }
    } else {
      // Menacing heavy march toward Samir
      const speed = isPhase2 ? 4.4 : 3.1;
      if (dist > 6.5) {
        const dirX = dx / Math.max(0.001, dist);
        const dirZ = dz / Math.max(0.001, dist);
        const res = this.physics.resolveCylinderMove(
          this.group.position,
          this.group.position.x + dirX * speed * worldDt,
          this.group.position.z + dirZ * speed * worldDt,
          0.95,
          this.floorY,
          2.8,
        );
        this.group.position.x = res.x;
        this.group.position.z = res.z;
        this.walkCycle += worldDt * (isPhase2 ? 8 : 5.5);
        this.group.position.y = this.floorY + Math.abs(Math.sin(this.walkCycle)) * 0.14;
      } else {
        this.group.position.y = this.floorY;
      }

      if (isPhase2) {
        this.sandevistanDashTimer -= worldDt;
        if (this.sandevistanDashTimer <= 0) {
          this.sandevistanDashTimer = 4.6;
          this.activeDashTime = 0.55;
          const dirX = dx / Math.max(0.001, dist);
          const dirZ = dz / Math.max(0.001, dist);
          this.dashVelocity.set(dirX * 19.5, 0, dirZ * 19.5);
          callbacks.onRoar();
        }
      }
    }

    // Autocannon bursts
    if (this.burstRemaining > 0) {
      this.burstSpacing -= worldDt;
      if (this.burstSpacing <= 0) {
        this.burstRemaining--;
        this.burstSpacing = isPhase2 ? 0.13 : 0.16;
        this.fireAutocannonBolt(playerEye);
        callbacks.onAutocannonShot();
      }
    } else {
      this.gunTimer -= worldDt;
      if (this.gunTimer <= 0) {
        this.gunTimer = isPhase2 ? 1.85 : 2.35;
        this.burstRemaining = isPhase2 ? 5 : 4;
        this.burstSpacing = 0;
      }
    }

    // Telegraphed shoulder micro-missile salvo
    this.missileTimer -= worldDt;
    if (this.missileTimer <= 0) {
      this.missileTimer = isPhase2 ? 5.2 : 6.4;
      this.launchMissileSalvo(playerPos, isPhase2 ? 4 : 3);
      callbacks.onRoar();
    }

    // Update boss projectiles (segment-vs-cylinder check before wall occlusion, plus friendly-fire vs enemies)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (i >= this.projectiles.length) continue;
      const p = this.projectiles[i];
      p.life -= worldDt;
      const step = p.velocity.clone().multiplyScalar(worldDt);
      const stepLen = step.length();
      const prevPos = p.mesh.position.clone();
      const nextPos = prevPos.clone().add(step);
      const dir = stepLen > 1e-6 ? step.clone().divideScalar(stepLen) : p.velocity.clone().normalize();

      const wall = this.physics.raycastBullets(prevPos, dir, stepLen + 0.12);
      const playerHit = segmentHitsCylinder(
        prevPos,
        nextPos,
        playerPos.x,
        playerPos.z,
        playerPos.y + 0.15,
        playerPos.y + 2.1,
        0.72,
      );

      if (playerHit.hit && (!wall.hit || playerHit.distance <= wall.distance)) {
        this.removeProjectileAt(i);
        callbacks.onPlayerDamaged(p.damage, 0.35);
        if (!this.isCombatActive()) return;
        continue;
      }

      if (callbacks.onProjectileHitEnemy?.(prevPos, nextPos, p.damage * 3)) {
        this.removeProjectileAt(i);
        continue;
      }

      if (wall.hit || p.life <= 0) {
        this.removeProjectileAt(i);
        continue;
      }

      p.mesh.position.copy(nextPos);
    }

    // Update telegraphed missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      if (i >= this.missiles.length) continue;
      const m = this.missiles[i];
      m.timer -= worldDt;
      const progress = 1 - Math.max(0, m.timer / m.maxTimer);
      m.missile.position.lerpVectors(m.startPos, m.targetPos, progress);
      m.missile.position.y += Math.sin(progress * Math.PI) * 5.2;
      m.ring.scale.setScalar(0.5 + progress * 0.5);

      if (m.timer <= 0) {
        const targetCopy = m.targetPos.clone();
        this.removeMissileAt(i);
        callbacks.onMissileExplode();
        callbacks.onAreaDamageEnemies?.(targetCopy, 2.8, 85, true);

        const blastDist = Math.hypot(playerPos.x - targetCopy.x, playerPos.z - targetCopy.z);
        if (blastDist < 2.6) {
          callbacks.onPlayerDamaged(18, 0.75);
          if (!this.isCombatActive()) return;
        }
      }
    }

    // Update shockwaves & afterimages
    this.updateShockwaves(worldDt, playerPos, true, callbacks);
    if (!this.isCombatActive()) return;

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      if (i >= this.afterimages.length) continue;
      const g = this.afterimages[i];
      g.life -= worldDt;
      if (g.life <= 0) {
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        (g.mesh.material as THREE.Material).dispose();
        this.afterimages.splice(i, 1);
      } else {
        (g.mesh.material as THREE.MeshBasicMaterial).opacity = (g.life / g.maxLife) * 0.45;
      }
    }
  }

  private removeProjectileAt(idx: number): void {
    const p = this.projectiles[idx];
    if (!p) return;
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    this.projectiles.splice(idx, 1);
  }

  private removeMissileAt(idx: number): void {
    const m = this.missiles[idx];
    if (!m) return;
    this.scene.remove(m.ring);
    m.ring.geometry.dispose();
    (m.ring.material as THREE.Material).dispose();
    this.scene.remove(m.missile);
    m.missile.geometry.dispose();
    (m.missile.material as THREE.Material).dispose();
    this.missiles.splice(idx, 1);
  }

  private fireAutocannonBolt(playerEye: Vec3): void {
    this.group.updateMatrixWorld(true);
    const start = new THREE.Vector3();
    this.muzzleGlow.getWorldPosition(start);

    const dir = new THREE.Vector3(
      playerEye.x - start.x + (Math.random() - 0.5) * 0.75,
      playerEye.y - start.y - 0.18 + (Math.random() - 0.5) * 0.4,
      playerEye.z - start.z + (Math.random() - 0.5) * 0.75,
    ).normalize();

    const geo = new THREE.CylinderGeometry(0.065, 0.065, 1.0, 6);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff003c });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(dir));
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: dir.multiplyScalar(27),
      damage: 10,
      life: 2.8,
    });
  }

  private launchMissileSalvo(playerPos: Vec3, count: number): void {
    const podStart = new THREE.Vector3(
      this.group.position.x - Math.cos(this.group.rotation.y) * 0.95,
      this.floorY + 3.15,
      this.group.position.z + Math.sin(this.group.rotation.y) * 0.95,
    );

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const spread = i === 0 ? 0.6 : 2.6 + Math.random() * 2.2;
      const tx = Math.max(-15, Math.min(15, playerPos.x + Math.cos(angle) * spread));
      const tz = Math.max(-138, Math.min(-94, playerPos.z + Math.sin(angle) * spread));

      // Outer radius 2.6 matches the 2.6m blast radius 1:1
      const ringGeo = new THREE.RingGeometry(2.15, 2.6, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff003c,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(tx, this.floorY + 0.08, tz);
      this.scene.add(ring);

      const missile = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xfcee0a }),
      );
      missile.position.copy(podStart);
      this.scene.add(missile);

      const maxTimer = 1.15 + i * 0.14;
      this.missiles.push({
        ring,
        missile,
        startPos: podStart.clone(),
        targetPos: new THREE.Vector3(tx, this.floorY + 0.15, tz),
        timer: maxTimer,
        maxTimer,
      });
    }
  }

  private spawnShockwave(x: number, z: number, maxRadius: number): void {
    const geo = new THREE.RingGeometry(0.92, 1.04, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, this.floorY + 0.12, z);
    mesh.scale.setScalar(0.5);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, prevRadius: 0, radius: 0.5, maxRadius, damagedPlayer: false });
  }

  private updateShockwaves(
    dt: number,
    playerPos: Vec3,
    dealDamage: boolean,
    callbacks?: BossCallbacks,
  ): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      if (i >= this.shockwaves.length) continue;
      const sw = this.shockwaves[i];
      sw.prevRadius = sw.radius;
      sw.radius += dt * 15;
      sw.mesh.scale.setScalar(sw.radius);
      const t = Math.min(1, sw.radius / sw.maxRadius);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;

      if (dealDamage && !sw.damagedPlayer && callbacks) {
        const d = Math.hypot(playerPos.x - sw.mesh.position.x, playerPos.z - sw.mesh.position.z);
        // Player can jump over shockwave! Check swept band [prevRadius - 0.65, radius + 0.65] so epicenter isn't skipped.
        if (d >= sw.prevRadius - 0.65 && d <= sw.radius + 0.65 && playerPos.y < this.floorY + 0.75) {
          sw.damagedPlayer = true;
          callbacks.onPlayerDamaged(16, 0.65);
          if (!this.isCombatActive()) return;
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        (sw.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  private spawnAfterimage(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.42,
      wireframe: true,
    });
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.9, 0.95), mat);
    ghost.position.set(this.group.position.x, this.floorY + 1.45, this.group.position.z);
    ghost.rotation.y = this.group.rotation.y;
    this.scene.add(ghost);
    this.afterimages.push({ mesh: ghost, life: 0.45, maxLife: 0.45 });
  }

  clearEffects(): void {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.projectiles = [];
    for (const m of this.missiles) {
      this.scene.remove(m.ring);
      m.ring.geometry.dispose();
      (m.ring.material as THREE.Material).dispose();
      this.scene.remove(m.missile);
      m.missile.geometry.dispose();
      (m.missile.material as THREE.Material).dispose();
    }
    this.missiles = [];
    for (const sw of this.shockwaves) {
      this.scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      (sw.mesh.material as THREE.Material).dispose();
    }
    this.shockwaves = [];
    for (const g of this.afterimages) {
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      (g.mesh.material as THREE.Material).dispose();
    }
    this.afterimages = [];
  }

  dispose(): void {
    this.clearEffects();
    this.scene.remove(this.group);
    const disposedGeos = new Set<THREE.BufferGeometry>();
    const disposedMats = new Set<THREE.Material>();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!disposedGeos.has(obj.geometry)) {
          disposedGeos.add(obj.geometry);
          obj.geometry.dispose();
        }
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
