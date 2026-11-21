import * as THREE from 'three';
import type { EnemyArchetype, Vec3 } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';

export interface EnemySpawnConfig {
  archetype: EnemyArchetype;
  x: number;
  y?: number;
  z: number;
}

interface EnemyProjectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  life: number;
}

interface ImpactSpark {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

export interface EnemyInstance {
  id: string;
  archetype: EnemyArchetype;
  group: THREE.Group;
  headMesh: THREE.Mesh;
  bodyMesh: THREE.Mesh;
  hpBarFill: THREE.Mesh;
  hp: number;
  maxHp: number;
  alive: boolean;
  fireTimer: number;
  strafeDir: number;
  strafeTimer: number;
  hitFlashTimer: number;
  deathTimer: number;
  hackProgress: number; // Used by netrunners
  hackBeam: THREE.Line | null;
}

export interface EnemyHitResult {
  hit: boolean;
  headshot: boolean;
  killed: boolean;
  damage: number;
  point: THREE.Vector3;
  archetype?: EnemyArchetype;
}

const ARCHETYPE_STATS: Record<
  EnemyArchetype,
  { hp: number; speed: number; fireInterval: number; damage: number; visorHex: number; bodyHex: number }
> = {
  guard: { hp: 85, speed: 3.3, fireInterval: 1.35, damage: 9, visorHex: 0xff003c, bodyHex: 0x3b4863 },
  drone: { hp: 65, speed: 4.5, fireInterval: 1.15, damage: 7, visorHex: 0x00f0ff, bodyHex: 0x4b5c7a },
  turret: { hp: 110, speed: 0, fireInterval: 0.95, damage: 11, visorHex: 0xff5500, bodyHex: 0x5c3e48 },
  netrunner: { hp: 90, speed: 2.8, fireInterval: 2.1, damage: 8, visorHex: 0x00f0ff, bodyHex: 0x2f4d70 },
  heavy: { hp: 185, speed: 2.3, fireInterval: 1.25, damage: 14, visorHex: 0xfcee0a, bodyHex: 0x543c47 },
};

export class EnemyManager {
  private enemies: EnemyInstance[] = [];
  private projectiles: EnemyProjectile[] = [];
  private sparks: ImpactSpark[] = [];
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private nextId = 1;

  private raycaster = new THREE.Raycaster();

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  spawnWave(configs: EnemySpawnConfig[]): void {
    for (const cfg of configs) {
      this.spawnEnemy(cfg);
    }
  }

  private spawnEnemy(cfg: EnemySpawnConfig): EnemyInstance {
    const stats = ARCHETYPE_STATS[cfg.archetype];
    const id = `enemy_${this.nextId++}`;
    const group = new THREE.Group();
    const baseY = cfg.y ?? (cfg.archetype === 'drone' ? 2.6 : cfg.archetype === 'turret' ? 6.6 : 0);
    group.position.set(cfg.x, baseY, cfg.z);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: stats.bodyHex,
      metalness: 0.65,
      roughness: 0.35,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: stats.visorHex,
      emissive: stats.visorHex,
      emissiveIntensity: 2.6,
    });

    let bodyMesh: THREE.Mesh;
    let headMesh: THREE.Mesh;

    if (cfg.archetype === 'drone') {
      bodyMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 1), bodyMat);
      group.add(bodyMesh);
      headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), visorMat);
      headMesh.position.set(0, 0, 0.45);
      group.add(headMesh);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.28), bodyMat);
      wingL.position.set(-0.65, 0.1, 0);
      const wingR = wingL.clone();
      wingR.position.x = 0.65;
      group.add(wingL, wingR);
    } else if (cfg.archetype === 'turret') {
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.6, 10), bodyMat);
      mount.position.y = 0.9;
      group.add(mount);
      bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.95), bodyMat);
      group.add(bodyMesh);
      headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), visorMat);
      headMesh.position.set(0, -0.05, 0.48);
      group.add(headMesh);
      const twinBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.85), bodyMat);
      twinBarrel.position.set(0, -0.22, 0.6);
      group.add(twinBarrel);
    } else {
      // Humanoid cyberpunk soldier (guard, netrunner, heavy)
      const scale = cfg.archetype === 'heavy' ? 1.2 : 1.0;

      // Legs
      const legGeo = new THREE.BoxGeometry(0.24 * scale, 0.85 * scale, 0.26 * scale);
      const legL = new THREE.Mesh(legGeo, bodyMat);
      legL.position.set(-0.18 * scale, 0.42 * scale, 0);
      const legR = legL.clone();
      legR.position.x = 0.18 * scale;
      group.add(legL, legR);

      // Torso (Body hitbox)
      bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.72 * scale, 0.88 * scale, 0.42 * scale),
        bodyMat,
      );
      bodyMesh.position.set(0, 1.26 * scale, 0);
      group.add(bodyMesh);

      // Glowing armor core stripe
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.48 * scale, 0.1 * scale, 0.45 * scale),
        visorMat,
      );
      stripe.position.set(0, 1.36 * scale, 0);
      group.add(stripe);

      // Arms + rifle
      const armGeo = new THREE.BoxGeometry(0.18 * scale, 0.65 * scale, 0.2 * scale);
      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.46 * scale, 1.25 * scale, 0.15);
      armL.rotation.x = -0.6;
      const armR = armL.clone();
      armR.position.x = 0.46 * scale;
      group.add(armL, armR);

      const gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.72),
        new THREE.MeshStandardMaterial({ color: 0x0b0d14, metalness: 0.9, roughness: 0.25 }),
      );
      gun.position.set(0.24 * scale, 1.24 * scale, 0.48 * scale);
      group.add(gun);

      // Head hitbox + cyber visor
      headMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.38 * scale, 0.38 * scale, 0.38 * scale),
        new THREE.MeshStandardMaterial({ color: 0x262d3d, metalness: 0.5, roughness: 0.4 }),
      );
      headMesh.position.set(0, 1.92 * scale, 0);
      group.add(headMesh);

      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.36 * scale, 0.12 * scale, 0.12 * scale),
        visorMat,
      );
      visor.position.set(0, 0.02, 0.17 * scale);
      headMesh.add(visor);
    }

    // Tag meshes for raycast headshot / body detection
    bodyMesh.userData = { enemyId: id, isHead: false };
    headMesh.userData = { enemyId: id, isHead: true };

    // Floating holographic HP bar above enemy
    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.11),
      new THREE.MeshBasicMaterial({ color: 0x110509, side: THREE.DoubleSide }),
    );
    const barY = cfg.archetype === 'drone' ? 0.95 : cfg.archetype === 'turret' ? -0.9 : cfg.archetype === 'heavy' ? 2.8 : 2.4;
    hpBg.position.set(0, barY, 0);
    const hpBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.91, 0.075),
      new THREE.MeshBasicMaterial({ color: stats.visorHex, side: THREE.DoubleSide }),
    );
    hpBarFill.position.z = 0.01;
    hpBg.add(hpBarFill);
    group.add(hpBg);

    let hackBeam: THREE.Line | null = null;
    if (cfg.archetype === 'netrunner') {
      const beamGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 1.6, 0),
        new THREE.Vector3(0, 1.6, 1),
      ]);
      const beamMat = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.85 });
      hackBeam = new THREE.Line(beamGeo, beamMat);
      hackBeam.visible = false;
      this.scene.add(hackBeam);
    }

    this.scene.add(group);
    const enemy: EnemyInstance = {
      id,
      archetype: cfg.archetype,
      group,
      headMesh,
      bodyMesh,
      hpBarFill,
      hp: stats.hp,
      maxHp: stats.hp,
      alive: true,
      fireTimer: 0.6 + Math.random() * 0.9,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.5 + Math.random() * 1.5,
      hitFlashTimer: 0,
      deathTimer: 0,
      hackProgress: 0,
      hackBeam,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  getAliveCount(): number {
    let count = 0;
    for (const e of this.enemies) {
      if (e.alive) count++;
    }
    return count;
  }

  /**
   * Tests a player shot ray against all alive enemies, respecting world wall occlusion.
   */
  handlePlayerShot(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxWallDist: number,
    baseDamage = 42,
  ): EnemyHitResult {
    const targets: THREE.Object3D[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      targets.push(e.headMesh, e.bodyMesh);
    }

    if (targets.length === 0) {
      return { hit: false, headshot: false, killed: false, damage: 0, point: new THREE.Vector3() };
    }

    this.raycaster.set(origin, direction);
    this.raycaster.far = maxWallDist;
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      return { hit: false, headshot: false, killed: false, damage: 0, point: new THREE.Vector3() };
    }

    const first = hits[0];
    const { enemyId, isHead } = first.object.userData as { enemyId: string; isHead: boolean };
    const enemy = this.enemies.find((e) => e.id === enemyId);
    if (!enemy || !enemy.alive) {
      return { hit: false, headshot: false, killed: false, damage: 0, point: first.point };
    }

    const damage = isHead ? baseDamage * 2 : baseDamage;
    const killed = this.applyDamageToEnemy(enemy, damage, first.point);
    return {
      hit: true,
      headshot: isHead,
      killed,
      damage,
      point: first.point.clone(),
      archetype: enemy.archetype,
    };
  }

  /**
   * Flame melee cone blast: deals damage and interrupts nearby enemies.
   */
  handleFlameMelee(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    range = 4.6,
    damage = 68,
  ): { hits: number; kills: number } {
    let hitCount = 0;
    let killCount = 0;
    const toEnemy = new THREE.Vector3();

    for (const e of this.enemies) {
      if (!e.alive) continue;
      toEnemy.copy(e.group.position);
      toEnemy.y += e.archetype === 'drone' || e.archetype === 'turret' ? 0 : 1.2;
      toEnemy.sub(origin);
      const dist = toEnemy.length();
      if (dist > range) continue;
      toEnemy.normalize();
      if (toEnemy.dot(forward) < 0.42) continue;

      hitCount++;
      const killed = this.applyDamageToEnemy(e, damage, e.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
      if (killed) killCount++;
    }

    return { hits: hitCount, kills: killCount };
  }

  private applyDamageToEnemy(enemy: EnemyInstance, damage: number, hitPoint: THREE.Vector3): boolean {
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.14;
    // Interrupt netrunner overheat hack when shot!
    if (enemy.archetype === 'netrunner') {
      enemy.hackProgress = Math.max(0, enemy.hackProgress - 0.55);
    }

    const ratio = Math.max(0.001, enemy.hp / enemy.maxHp);
    enemy.hpBarFill.scale.x = ratio;
    enemy.hpBarFill.position.x = -(1 - ratio) * 0.455;

    this.spawnSparks(hitPoint, enemy.hp <= 0 ? 12 : 5, enemy.hp <= 0 ? 0xff4400 : 0xfcee0a);

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.deathTimer = 1.2;
      if (enemy.hackBeam) enemy.hackBeam.visible = false;
      return true;
    }
    return false;
  }

  spawnSparks(point: THREE.Vector3, count: number, colorHex: number): void {
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colorHex });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(point);
      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 6.5,
          1.5 + Math.random() * 4.5,
          (Math.random() - 0.5) * 6.5,
        ),
        life: 0.35 + Math.random() * 0.25,
      });
    }
  }

  update(
    worldDt: number,
    playerEye: Vec3,
    playerPos: Vec3,
    cameraPos: THREE.Vector3,
    onEnemyShot: (heavy: boolean) => void,
    onPlayerDamaged: (amount: number, fromHack: boolean) => void,
  ): { maxOverheatProgress: number } {
    let maxOverheatProgress = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // Billboard HP bar toward camera
      if (e.hpBarFill.parent) {
        e.hpBarFill.parent.lookAt(cameraPos);
      }

      if (!e.alive) {
        e.deathTimer -= worldDt;
        if (e.archetype === 'drone' || e.archetype === 'turret') {
          e.group.scale.multiplyScalar(Math.max(0.01, 1 - worldDt * 3.5));
        } else {
          e.group.rotation.x = Math.min(Math.PI / 2, e.group.rotation.x + worldDt * 4.5);
          e.group.position.y = Math.max(0.18, e.group.position.y - worldDt * 0.5);
        }
        if (e.deathTimer <= 0) {
          this.scene.remove(e.group);
          if (e.hackBeam) this.scene.remove(e.hackBeam);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // Hit flash visual feedback
      const bodyMat = e.bodyMesh.material as THREE.MeshStandardMaterial;
      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer -= worldDt;
        bodyMat.emissive.setHex(0xffffff);
        bodyMat.emissiveIntensity = 0.7;
      } else {
        bodyMat.emissive.setHex(0x000000);
        bodyMat.emissiveIntensity = 0;
      }

      const stats = ARCHETYPE_STATS[e.archetype];
      const dx = playerPos.x - e.group.position.x;
      const dz = playerPos.z - e.group.position.z;
      const horizDist = Math.hypot(dx, dz);

      // Face player smoothly
      const desiredYaw = Math.atan2(dx, dz);
      e.group.rotation.y = desiredYaw;

      const enemyEye: Vec3 = {
        x: e.group.position.x,
        y: e.group.position.y + (e.archetype === 'drone' || e.archetype === 'turret' ? 0 : 1.65),
        z: e.group.position.z,
      };
      const hasSight = horizDist < 38 && this.physics.hasLineOfSight(enemyEye, playerEye);

      // Movement AI
      if (stats.speed > 0 && horizDist < 42) {
        e.strafeTimer -= worldDt;
        if (e.strafeTimer <= 0) {
          e.strafeTimer = 1.4 + Math.random() * 1.6;
          e.strafeDir = -e.strafeDir;
        }

        const dirX = dx / Math.max(0.001, horizDist);
        const dirZ = dz / Math.max(0.001, horizDist);
        const perpX = -dirZ * e.strafeDir;
        const perpZ = dirX * e.strafeDir;

        const preferredMin = e.archetype === 'heavy' ? 6.5 : e.archetype === 'netrunner' ? 12 : 9;
        const preferredMax = e.archetype === 'heavy' ? 12 : 17;

        let moveX = perpX * 0.65;
        let moveZ = perpZ * 0.65;
        if (horizDist > preferredMax || !hasSight) {
          moveX += dirX;
          moveZ += dirZ;
        } else if (horizDist < preferredMin) {
          moveX -= dirX * 0.6;
          moveZ -= dirZ * 0.6;
        }

        const mLen = Math.hypot(moveX, moveZ);
        if (mLen > 0.01) {
          const stepX = (moveX / mLen) * stats.speed * worldDt;
          const stepZ = (moveZ / mLen) * stats.speed * worldDt;
          const res = this.physics.resolveCylinderMove(
            e.group.position,
            e.group.position.x + stepX,
            e.group.position.z + stepZ,
            0.55,
            e.archetype === 'drone' ? 2.0 : 0,
            1.7,
          );
          e.group.position.x = res.x;
          e.group.position.z = res.z;
          if (res.collided) {
            e.strafeDir = -e.strafeDir;
          }
        }

        if (e.archetype === 'drone') {
          e.group.position.y = 2.6 + Math.sin(performance.now() * 0.004 + i) * 0.3;
        }
      }

      // Netrunner Overheat quickhack channel
      if (e.archetype === 'netrunner') {
        if (hasSight && horizDist < 26) {
          e.hackProgress += worldDt * 0.24; // ~4.1 seconds to complete unless interrupted
          maxOverheatProgress = Math.max(maxOverheatProgress, Math.min(1, e.hackProgress));
          if (e.hackBeam) {
            e.hackBeam.visible = true;
            const posAttr = e.hackBeam.geometry.getAttribute('position') as THREE.BufferAttribute;
            posAttr.setXYZ(0, enemyEye.x, enemyEye.y, enemyEye.z);
            posAttr.setXYZ(1, playerEye.x, playerEye.y - 0.25, playerEye.z);
            posAttr.needsUpdate = true;
          }
          if (e.hackProgress >= 1.0) {
            e.hackProgress = 0;
            onPlayerDamaged(18, true);
          }
        } else {
          e.hackProgress = Math.max(0, e.hackProgress - worldDt * 0.35);
          if (e.hackBeam) e.hackBeam.visible = false;
        }
      }

      // Firing logic
      if (hasSight) {
        e.fireTimer -= worldDt;
        if (e.fireTimer <= 0) {
          e.fireTimer = stats.fireInterval * (0.85 + Math.random() * 0.35);
          this.fireProjectile(enemyEye, playerEye, stats.damage, stats.visorHex, e.archetype === 'heavy');
          onEnemyShot(e.archetype === 'heavy' || e.archetype === 'turret');
        }
      }
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= worldDt;
      const step = p.velocity.clone().multiplyScalar(worldDt);
      const nextPos = p.mesh.position.clone().add(step);

      // Wall hit check
      const wallRay = this.physics.raycast(
        p.mesh.position,
        p.velocity.clone().normalize(),
        step.length() + 0.15,
        true,
      );
      if (wallRay.hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
        continue;
      }

      p.mesh.position.copy(nextPos);

      // Player hit check
      const pdx = p.mesh.position.x - playerPos.x;
      const pdz = p.mesh.position.z - playerPos.z;
      const pdy = p.mesh.position.y - (playerPos.y + 1.15);
      if (pdx * pdx + pdz * pdz < 0.62 * 0.62 && Math.abs(pdy) < 0.95) {
        onPlayerDamaged(p.damage, false);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // Update impact sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= worldDt;
      s.velocity.y -= 12 * worldDt;
      s.mesh.position.addScaledVector(s.velocity, worldDt);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      }
    }

    return { maxOverheatProgress };
  }

  private fireProjectile(
    from: Vec3,
    target: Vec3,
    damage: number,
    colorHex: number,
    heavy: boolean,
  ): void {
    const dir = new THREE.Vector3(
      target.x - from.x + (Math.random() - 0.5) * 0.55,
      target.y - from.y - 0.15 + (Math.random() - 0.5) * 0.35,
      target.z - from.z + (Math.random() - 0.5) * 0.55,
    ).normalize();

    const geo = new THREE.CylinderGeometry(heavy ? 0.055 : 0.036, heavy ? 0.055 : 0.036, 0.72, 6);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, from.y, from.z);
    mesh.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
    this.scene.add(mesh);

    const speed = heavy ? 22 : 26;
    this.projectiles.push({
      mesh,
      velocity: dir.multiplyScalar(speed),
      damage,
      life: 2.6,
    });
  }

  clearAll(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      if (e.hackBeam) this.scene.remove(e.hackBeam);
    }
    this.enemies = [];

    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
    }
    this.projectiles = [];

    for (const s of this.sparks) {
      this.scene.remove(s.mesh);
    }
    this.sparks = [];
  }
}
