import * as THREE from 'three';

export class WeaponState {
  readonly magazineSize = 8;
  ammo = 8;
  reloading = false;
  reloadTimer = 0;
  readonly reloadDuration = 1.05;

  fireCooldown = 0;
  readonly fireInterval = 0.24;

  meleeCooldown = 0;
  readonly meleeInterval = 1.45;

  reset(): void {
    this.ammo = this.magazineSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.meleeCooldown = 0;
  }

  canFire(): boolean {
    return !this.reloading && this.fireCooldown <= 0 && this.ammo > 0;
  }

  tryFire(): boolean {
    if (!this.canFire()) return false;
    this.ammo--;
    this.fireCooldown = this.fireInterval;
    if (this.ammo === 0) {
      this.startReload();
    }
    return true;
  }

  startReload(): boolean {
    if (this.reloading || this.ammo >= this.magazineSize) return false;
    this.reloading = true;
    this.reloadTimer = this.reloadDuration;
    return true;
  }

  tryMelee(): boolean {
    if (this.meleeCooldown > 0) return false;
    this.meleeCooldown = this.meleeInterval;
    return true;
  }

  update(dt: number): { reloadCompleted: boolean } {
    if (this.fireCooldown > 0) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }
    if (this.meleeCooldown > 0) {
      this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    }

    let reloadCompleted = false;
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo = this.magazineSize;
        reloadCompleted = true;
      }
    }
    return { reloadCompleted };
  }
}

interface TracerEffect {
  line: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface FlameBurst {
  group: THREE.Group;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class WeaponSystem {
  readonly state = new WeaponState();
  readonly viewModel = new THREE.Group();
  private gunPivot = new THREE.Group();
  private muzzleLight: THREE.PointLight;
  private muzzleFlashMesh: THREE.Mesh;
  private ammoStripMat: THREE.MeshStandardMaterial;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private recoilKick = 0;
  private recoilPitch = 0;
  private swayTime = 0;
  private introSpinTimer = 0;
  private meleeAnimTimer = 0;
  private muzzleFlashTimer = 0;

  private tracers: TracerEffect[] = [];
  private flames: FlameBurst[] = [];
  private droppedGun: THREE.Group | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.ammoStripMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    this.muzzleLight = new THREE.PointLight(0xff8833, 0, 9);
    this.muzzleLight.position.set(0, 0.05, -0.58);

    const flashGeo = new THREE.OctahedronGeometry(0.085, 0);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlashMesh.position.set(0, 0.045, -0.55);

    this.buildMalorianMesh(this.gunPivot);
    this.gunPivot.add(this.muzzleLight);
    this.gunPivot.add(this.muzzleFlashMesh);

    this.viewModel.add(this.gunPivot);
    this.viewModel.position.set(0.24, -0.22, -0.44);
    this.camera.add(this.viewModel);
  }

  /**
   * Builds the iconic heavy cyber-pistol Malorian S-3516 out of layered geometric primitives.
   */
  private buildMalorianMesh(target: THREE.Group): void {
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x1b1f29,
      metalness: 0.88,
      roughness: 0.25,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xbac4d4,
      metalness: 0.94,
      roughness: 0.16,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x0d0f16,
      metalness: 0.35,
      roughness: 0.78,
    });
    const cyanSight = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.5,
    });

    // Long heavy upper slide
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.075, 0.42), gunmetal);
    slide.position.set(0, 0.035, -0.14);
    target.add(slide);

    // Chrome top rail & compensator vents
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.022, 0.38), chrome);
    topRail.position.set(0, 0.078, -0.13);
    target.add(topRail);

    const compensator = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.068, 0.12), chrome);
    compensator.position.set(0, 0.032, -0.39);
    target.add(compensator);

    // Barrel bore
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x06070a, metalness: 0.9, roughness: 0.3 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -0.45);
    target.add(barrel);

    // Lower receiver & underbarrel flame-module
    const underModule = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.042, 0.26), gunmetal);
    underModule.position.set(0, -0.012, -0.22);
    target.add(underModule);

    // Glowing crimson ammo indicator rails on both sides
    const leftStrip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.22), this.ammoStripMat);
    leftStrip.position.set(-0.031, 0.032, -0.16);
    target.add(leftStrip);

    const rightStrip = leftStrip.clone();
    rightStrip.position.x = 0.031;
    target.add(rightStrip);

    // Angled heavy grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.16, 0.08), gripMat);
    grip.position.set(0, -0.085, 0.01);
    grip.rotation.x = 0.26;
    target.add(grip);

    // Trigger guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.09), chrome);
    guard.position.set(0, -0.032, -0.065);
    target.add(guard);

    // Holographic rear iron sights (cyan dots)
    const sightL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.014, 0.012), cyanSight);
    sightL.position.set(-0.018, 0.095, 0.045);
    target.add(sightL);
    const sightR = sightL.clone();
    sightR.position.x = 0.018;
    target.add(sightR);
  }

  setVisible(visible: boolean): void {
    this.viewModel.visible = visible;
  }

  playIntroSpin(): void {
    this.introSpinTimer = 1.15;
  }

  triggerFireVisual(hitPoint: THREE.Vector3): void {
    this.recoilKick = 0.11;
    this.recoilPitch = 0.26;
    this.muzzleFlashTimer = 0.055;
    this.muzzleLight.intensity = 6.5;
    (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleFlashMesh.scale.setScalar(0.8 + Math.random() * 0.5);

    // Spawn luminous bullet tracer from muzzle in world space to hitPoint
    const muzzleWorld = new THREE.Vector3();
    this.muzzleFlashMesh.getWorldPosition(muzzleWorld);
    this.spawnTracer(muzzleWorld, hitPoint, 0xffaa33);
  }

  spawnTracer(start: THREE.Vector3, end: THREE.Vector3, colorHex: number): void {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(0.2, dir.length());
    const geo = new THREE.CylinderGeometry(0.013, 0.013, len, 5);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.lookAt(end);
    this.scene.add(mesh);
    this.tracers.push({ line: mesh, life: 0.08, maxLife: 0.08 });
  }

  triggerFlameMeleeVisual(origin: THREE.Vector3, forward: THREE.Vector3): void {
    this.meleeAnimTimer = 0.42;
    this.recoilKick = -0.14;

    const group = new THREE.Group();
    const flameColors = [0xff4400, 0xff9900, 0xffee55];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: flameColors[i % flameColors.length],
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const orb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + (i % 3) * 0.1, 0), mat);
      orb.position.set(
        (Math.random() - 0.5) * 0.55,
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.55,
      );
      group.add(orb);
    }

    group.position.copy(origin).addScaledVector(forward, 0.85);
    this.scene.add(group);
    this.flames.push({
      group,
      velocity: forward.clone().multiplyScalar(13),
      life: 0.32,
      maxLife: 0.32,
    });
  }

  /**
   * Drops Samir's Malorian onto the floor during the Lev Smasher defeat cutscene.
   */
  spawnDroppedWeapon(position: THREE.Vector3, yaw: number): void {
    this.clearDroppedWeapon();
    const prop = new THREE.Group();
    this.buildMalorianMesh(prop);
    prop.position.set(
      position.x + Math.cos(yaw) * 0.85,
      position.y + 0.06,
      position.z - Math.sin(yaw) * 0.85 - 1.1,
    );
    prop.rotation.set(0.1, yaw + 0.9, Math.PI / 2 - 0.08);
    prop.scale.setScalar(1.3);
    this.scene.add(prop);
    this.droppedGun = prop;
  }

  clearDroppedWeapon(): void {
    if (this.droppedGun) {
      this.scene.remove(this.droppedGun);
      this.droppedGun = null;
    }
  }

  update(dt: number, isMoving: boolean): { reloadCompleted: boolean } {
    const res = this.state.update(dt);

    // Update ammo rail glow intensity & color
    if (this.state.reloading) {
      this.ammoStripMat.color.setHex(0xfcee0a);
      this.ammoStripMat.emissive.setHex(0xfcee0a);
    } else if (this.state.ammo <= 2) {
      this.ammoStripMat.color.setHex(0xff003c);
      this.ammoStripMat.emissive.setHex(0xff003c);
    } else {
      this.ammoStripMat.color.setHex(0x00f0ff);
      this.ammoStripMat.emissive.setHex(0x00f0ff);
    }

    // Muzzle flash decay
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      const t = this.muzzleFlashTimer / 0.055;
      this.muzzleLight.intensity = 6.5 * t;
      (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = t;
    } else {
      this.muzzleLight.intensity = 0;
      (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }

    // Recoil spring recovery
    this.recoilKick += (0 - this.recoilKick) * Math.min(1, dt * 15);
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, dt * 13);

    // Sway
    this.swayTime += dt * (isMoving ? 9.5 : 2.2);
    const swayX = Math.cos(this.swayTime) * (isMoving ? 0.012 : 0.0025);
    const swayY = Math.abs(Math.sin(this.swayTime)) * (isMoving ? 0.012 : 0.002);

    // Reload / Intro spin / Flame melee animation angles
    let rotX = this.recoilPitch;
    let rotY = 0;
    let rotZ = 0;
    let offsetY = 0;
    let offsetZ = this.recoilKick;

    if (this.introSpinTimer > 0) {
      this.introSpinTimer = Math.max(0, this.introSpinTimer - dt);
      const p = 1 - this.introSpinTimer / 1.15;
      rotX += Math.PI * 2 * (1 - Math.pow(1 - p, 2));
      offsetY += Math.sin(p * Math.PI) * 0.08;
    } else if (this.state.reloading) {
      const p = 1 - this.state.reloadTimer / this.state.reloadDuration;
      rotX += Math.sin(p * Math.PI) * -0.95;
      rotZ += Math.sin(p * Math.PI * 2) * 0.48;
      offsetY -= Math.sin(p * Math.PI) * 0.14;
    } else if (this.meleeAnimTimer > 0) {
      this.meleeAnimTimer = Math.max(0, this.meleeAnimTimer - dt);
      const p = 1 - this.meleeAnimTimer / 0.42;
      const swing = Math.sin(p * Math.PI);
      rotY += swing * 0.72;
      rotZ -= swing * 0.45;
      offsetZ -= swing * 0.18;
    }

    this.gunPivot.position.set(swayX, -swayY + offsetY, offsetZ);
    this.gunPivot.rotation.set(rotX, rotY, rotZ);

    // Update tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        (tr.line.material as THREE.MeshBasicMaterial).opacity = tr.life / tr.maxLife;
      }
    }

    // Update flame melee bursts
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const fl = this.flames[i];
      fl.life -= dt;
      fl.group.position.addScaledVector(fl.velocity, dt);
      fl.group.scale.addScalar(dt * 3.8);
      if (fl.life <= 0) {
        this.scene.remove(fl.group);
        this.flames.splice(i, 1);
      } else {
        const opacity = fl.life / fl.maxLife;
        fl.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            (obj.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
          }
        });
      }
    }

    return res;
  }
}
