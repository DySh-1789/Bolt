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
  targetPos: THREE.Vector3;
  timer: number;
  maxTimer: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
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
  onPhase2Started: () => void;
  onFinisherTriggered: () => void;
}

export class LevSmasherBoss {
  readonly state = new LevSmasherState();
  readonly group = new THREE.Group();

  private headHitbox!: THREE.Mesh;
  private bodyHitbox!: THREE.Mesh;
  private rightArmPivot!: THREE.Group;
  private leftArmPivot!: THREE.Group;
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
    this.group.add(pauldronL, pauldronR);

    // Shoulder-mounted multi-missile pod (Left shoulder)
    const missilePod = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.82), crimsonAccent);
    missilePod.position.set(-0.98, 2.94, -0.05);
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
    this.headHitbox.add(eyeL, eyeR, brow);

    // Right arm with heavy rotary autocannon
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(1.12, 2.25, 0.1);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.05, 0.42), darkArmor);
    armR.position.set(0, -0.35, 0.2);
    armR.rotation.x = -0.65;
    this.rightArmPivot.add(armR);
    const cannonBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.45, 10), gunmetal);
    cannonBody.rotation.x = Math.PI / 2;
    cannonBody.position.set(0, -0.58, 1.05);
    this.rightArmPivot.add(cannonBody);
    const muzzleGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 8), this.coreMat);
    muzzleGlow.rotation.x = Math.PI / 2;
    muzzleGlow.position.set(0, -0.58, 1.78);
    this.rightArmPivot.add(muzzleGlow);
    this.group.add(this.rightArmPivot);

    // Left arm with crushing cyber-fist
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-1.12, 2.25, 0.1);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.12, 0.44), darkArmor);
    armL.position.set(0, -0.42, 0.16);
    armL.rotation.x = -0.35;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.56), crimsonAccent);
    fist.position.set(0, -0.92, 0.44);
    this.leftArmPivot.add(armL, fist);
    this.group.add(this.leftArmPivot);

    // Point light radiating menacing red aura around Lev Smasher
    const aura = new THREE.PointLight(0xff1a48, 34, 18, 1.15);
    aura.position.set(0, 2.2, 0.8);
    this.group.add(aura);

    this.bodyHitbox.userData = { isBoss: true, isHead: false };
    this.headHitbox.userData = { isBoss: true, isHead: true };
  }

  appearForKnockback(x: number, z: number): void {
    this.clearEffects();
    this.state.reset();
    this.state.startKnockback();
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, 0, 0);
    // Raise left fist in crushing strike pose
    this.leftArmPivot.rotation.x = -1.35;
    this.rightArmPivot.rotation.x = -0.35;
  }

  beginCombat(x = 0, z = -134): void {
    this.clearEffects();
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.state.startPhase1();
    this.gunTimer = 1.1;
    this.missileTimer = 3.8;
    this.sandevistanDashTimer = 2.8;
    this.activeDashTime = 0;
    this.leftArmPivot.rotation.x = 0;
    this.rightArmPivot.rotation.x = 0;
  }

  hide(): void {
    this.group.visible = false;
    this.clearEffects();
  }

  /**
   * Positions Lev Smasher directly in front of Samir for the scripted defeat finisher.
   */
  positionForFinisher(playerPos: Vec3, playerYaw: number): void {
    this.clearEffects();
    this.group.visible = true;
    const fx = -Math.sin(playerYaw);
    const fz = -Math.cos(playerYaw);
    const dist = 3.1;
    const targetX = Math.max(-15, Math.min(15, playerPos.x + fx * dist));
    const targetZ = Math.max(-138, Math.min(-94, playerPos.z + fz * dist));
    this.group.position.set(targetX, 0, targetZ);
    this.group.rotation.y = Math.atan2(playerPos.x - targetX, playerPos.z - targetZ);
    this.leftArmPivot.rotation.x = -1.6;
    this.spawnShockwave(targetX, targetZ, 7.5);
  }

  /**
   * Slowly stalks closer over fallen Samir during the blackout monologue.
   */
  updateFinisherLoom(dt: number, playerPos: Vec3): void {
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    this.group.rotation.y = Math.atan2(dx, dz);
    if (dist > 1.85) {
      this.group.position.x += (dx / dist) * 1.15 * dt;
      this.group.position.z += (dz / dist) * 1.15 * dt;
    }
    this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, -0.3, dt * 2.4);
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
    const hits = this.raycaster.intersectObjects([this.headHitbox, this.bodyHitbox], false);
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
    const toBoss = new THREE.Vector3(
      this.group.position.x - origin.x,
      1.6 - origin.y,
      this.group.position.z - origin.z,
    );
    const dist = toBoss.length();
    if (dist > 5.0 || toBoss.normalize().dot(forward) < 0.4) {
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

  updateCombat(
    worldDt: number,
    playerPos: Vec3,
    playerEye: Vec3,
    callbacks: BossCallbacks,
  ): void {
    if (!this.group.visible) return;
    if (this.state.phase !== 'PHASE_1' && this.state.phase !== 'PHASE_2') return;

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
      this.afterimageSpawnAccum += worldDt;
      if (this.afterimageSpawnAccum >= 0.065) {
        this.afterimageSpawnAccum = 0;
        this.spawnAfterimage();
      }
      const nextX = this.group.position.x + this.dashVelocity.x * worldDt;
      const nextZ = this.group.position.z + this.dashVelocity.z * worldDt;
      const res = this.physics.resolveCylinderMove(this.group.position, nextX, nextZ, 0.95, 0, 2.8);
      this.group.position.x = res.x;
      this.group.position.z = res.z;

      if (this.activeDashTime <= 0) {
        // End of Sandevistan dash: ground slam shockwave!
        this.spawnShockwave(this.group.position.x, this.group.position.z, 11.5);
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
          0,
          2.8,
        );
        this.group.position.x = res.x;
        this.group.position.z = res.z;
        this.walkCycle += worldDt * (isPhase2 ? 8 : 5.5);
        this.group.position.y = Math.abs(Math.sin(this.walkCycle)) * 0.14;
      }

      if (isPhase2) {
        this.sandevistanDashTimer -= worldDt;
        if (this.sandevistanDashTimer <= 0) {
          this.sandevistanDashTimer = 4.6;
          this.activeDashTime = 0.55;
          const dirX = dx / Math.max(0.001, dist);
          const dirZ = dz / Math.max(0.001, dist);
          // Dash aggressively toward or flanking Samir
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

    // Update boss projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= worldDt;
      const step = p.velocity.clone().multiplyScalar(worldDt);
      const wall = this.physics.raycast(
        p.mesh.position,
        p.velocity.clone().normalize(),
        step.length() + 0.15,
        true,
      );
      if (wall.hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.mesh.position.add(step);

      const pdx = p.mesh.position.x - playerPos.x;
      const pdz = p.mesh.position.z - playerPos.z;
      const pdy = p.mesh.position.y - (playerPos.y + 1.15);
      if (pdx * pdx + pdz * pdz < 0.72 * 0.72 && Math.abs(pdy) < 1.0) {
        callbacks.onPlayerDamaged(p.damage, 0.35);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Update telegraphed missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.timer -= worldDt;
      const progress = 1 - Math.max(0, m.timer / m.maxTimer);
      m.missile.position.lerpVectors(
        new THREE.Vector3(this.group.position.x - 0.8, 3.2, this.group.position.z),
        m.targetPos,
        progress,
      );
      m.missile.position.y += Math.sin(progress * Math.PI) * 5.2;
      m.ring.scale.setScalar(0.5 + progress * 0.5);

      if (m.timer <= 0) {
        const blastDist = Math.hypot(playerPos.x - m.targetPos.x, playerPos.z - m.targetPos.z);
        if (blastDist < 2.8) {
          callbacks.onPlayerDamaged(18, 0.75);
        }
        callbacks.onMissileExplode();
        this.scene.remove(m.ring);
        this.scene.remove(m.missile);
        this.missiles.splice(i, 1);
      }
    }

    // Update shockwaves & afterimages
    this.updateShockwaves(worldDt, playerPos, true, callbacks);
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const g = this.afterimages[i];
      g.life -= worldDt;
      if (g.life <= 0) {
        this.scene.remove(g.mesh);
        (g.mesh.material as THREE.Material).dispose();
        this.afterimages.splice(i, 1);
      } else {
        (g.mesh.material as THREE.MeshBasicMaterial).opacity = (g.life / g.maxLife) * 0.45;
      }
    }
  }

  private fireAutocannonBolt(playerEye: Vec3): void {
    const start = new THREE.Vector3(
      this.group.position.x + Math.cos(this.group.rotation.y) * 1.0,
      2.05,
      this.group.position.z - Math.sin(this.group.rotation.y) * 1.0,
    );
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
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const spread = i === 0 ? 0.6 : 2.6 + Math.random() * 2.2;
      const tx = Math.max(-15, Math.min(15, playerPos.x + Math.cos(angle) * spread));
      const tz = Math.max(-138, Math.min(-94, playerPos.z + Math.sin(angle) * spread));

      const ringGeo = new THREE.RingGeometry(1.9, 2.35, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff003c,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(tx, 0.08, tz);
      this.scene.add(ring);

      const missile = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xfcee0a }),
      );
      missile.position.set(this.group.position.x, 3.2, this.group.position.z);
      this.scene.add(missile);

      const maxTimer = 1.15 + i * 0.14;
      this.missiles.push({
        ring,
        missile,
        targetPos: new THREE.Vector3(tx, 0.15, tz),
        timer: maxTimer,
        maxTimer,
      });
    }
  }

  private spawnShockwave(x: number, z: number, maxRadius: number): void {
    const geo = new THREE.RingGeometry(0.8, 1.35, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.12, z);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, radius: 1.0, maxRadius, damagedPlayer: false });
  }

  private updateShockwaves(
    dt: number,
    playerPos: Vec3,
    dealDamage: boolean,
    callbacks?: BossCallbacks,
  ): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += dt * 15;
      sw.mesh.scale.setScalar(sw.radius);
      const t = Math.min(1, sw.radius / sw.maxRadius);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;

      if (dealDamage && !sw.damagedPlayer && callbacks) {
        const d = Math.hypot(playerPos.x - sw.mesh.position.x, playerPos.z - sw.mesh.position.z);
        // Player can jump over shockwave!
        if (Math.abs(d - sw.radius) < 1.1 && playerPos.y < 0.75) {
          sw.damagedPlayer = true;
          callbacks.onPlayerDamaged(16, 0.65);
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
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
    ghost.position.set(this.group.position.x, 1.45, this.group.position.z);
    ghost.rotation.y = this.group.rotation.y;
    this.scene.add(ghost);
    this.afterimages.push({ mesh: ghost, life: 0.45, maxLife: 0.45 });
  }

  clearEffects(): void {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    for (const m of this.missiles) {
      this.scene.remove(m.ring);
      this.scene.remove(m.missile);
    }
    this.missiles = [];
    for (const sw of this.shockwaves) this.scene.remove(sw.mesh);
    this.shockwaves = [];
    for (const g of this.afterimages) this.scene.remove(g.mesh);
    this.afterimages = [];
  }
}
