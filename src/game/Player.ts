import * as THREE from 'three';
import type { CameraMode, Vec3 } from '../types/game';
import type { InputSnapshot } from '../engine/InputManager';
import type { PhysicsWorld } from '../engine/Physics';

export class PlayerState {
  hp = 100;
  readonly maxHp = 100;
  armor = 50;
  readonly maxArmor = 50;
  maxDocCharges = 3;
  readonly maxMaxDoc = 4;

  sandevistanEnergy = 100;
  sandevistanActive = false;
  dashCooldown = 0;

  private readonly sandevistanDrainPerSec = 25; // ~4 seconds at full energy
  private readonly sandevistanRechargePerSec = 10;

  resetFull(): void {
    this.hp = this.maxHp;
    this.armor = this.maxArmor;
    this.maxDocCharges = 3;
    this.sandevistanEnergy = 100;
    this.sandevistanActive = false;
    this.dashCooldown = 0;
  }

  takeDamage(amount: number, allowLethal = true): { applied: number; died: boolean } {
    if (amount <= 0) return { applied: 0, died: false };
    let remaining = amount;

    // Armor absorbs 55% of incoming damage while present
    if (this.armor > 0) {
      const armorAbsorb = Math.min(this.armor, remaining * 0.55);
      this.armor = Math.max(0, this.armor - armorAbsorb);
      remaining -= armorAbsorb;
    }

    const minHp = allowLethal ? 0 : 1;
    const prevHp = this.hp;
    this.hp = Math.max(minHp, this.hp - remaining);

    return {
      applied: prevHp - this.hp,
      died: allowLethal && this.hp <= 0,
    };
  }

  useMaxDoc(): boolean {
    if (this.maxDocCharges <= 0 || this.hp >= this.maxHp) {
      return false;
    }
    this.maxDocCharges--;
    this.hp = Math.min(this.maxHp, this.hp + 55);
    this.armor = Math.min(this.maxArmor, this.armor + 15);
    return true;
  }

  refillSupplies(): void {
    this.maxDocCharges = Math.min(this.maxMaxDoc, this.maxDocCharges + 1);
    this.armor = Math.min(this.maxArmor, this.armor + 25);
  }

  toggleSandevistan(): { changed: boolean; active: boolean } {
    if (this.sandevistanActive) {
      this.sandevistanActive = false;
      return { changed: true, active: false };
    }
    if (this.sandevistanEnergy >= 25) {
      this.sandevistanActive = true;
      return { changed: true, active: true };
    }
    return { changed: false, active: false };
  }

  updateTimers(dt: number): { sandevistanEnded: boolean } {
    let sandevistanEnded = false;
    if (this.dashCooldown > 0) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    }

    if (this.sandevistanActive) {
      this.sandevistanEnergy = Math.max(0, this.sandevistanEnergy - this.sandevistanDrainPerSec * dt);
      if (this.sandevistanEnergy <= 0) {
        this.sandevistanActive = false;
        sandevistanEnded = true;
      }
    } else {
      this.sandevistanEnergy = Math.min(100, this.sandevistanEnergy + this.sandevistanRechargePerSec * dt);
    }

    return { sandevistanEnded };
  }

  getWorldTimeScale(): number {
    return this.sandevistanActive ? 0.28 : 1.0;
  }
}

export class PlayerController {
  readonly state = new PlayerState();
  readonly position = new THREE.Vector3(0, 0, 14);
  readonly velocity = new THREE.Vector3();

  yaw = 0; // 0 looks along -Z
  pitch = 0;
  roll = 0;
  mode: CameraMode = 'FREE';

  readonly eyeHeight = 1.68;
  readonly radius = 0.45;
  readonly height = 1.8;

  private grounded = true;
  private headBobPhase = 0;
  private shakeIntensity = 0;
  private dashTimer = 0;
  private dashDir = new THREE.Vector3();

  // Knockback cinematic parameters
  private knockbackStart = new THREE.Vector3();
  private knockbackEnd = new THREE.Vector3();
  private knockbackProgress = 0;

  // Operating table head-look offsets
  private tableYawOffset = 0;
  private tablePitchOffset = 0;
  private tableAnchor = new THREE.Vector3(0, 101.65, 0.3);

  // Fallen camera target
  private fallenBaseYaw = 0;
  private fallenTime = 0;

  private camera: THREE.PerspectiveCamera;
  private baseFov = 75;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
  }

  teleport(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = 0;
    this.grounded = true;
    this.dashTimer = 0;
    this.syncCamera(0);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'FALLEN') {
      this.fallenBaseYaw = this.yaw;
      this.fallenTime = 0;
    } else if (mode === 'OPERATING_TABLE') {
      this.tableYawOffset = 0;
      this.tablePitchOffset = 0;
    } else if (mode === 'FREE') {
      this.roll = 0;
    }
  }

  startKnockback(targetZ: number, targetX = 0): void {
    this.mode = 'KNOCKBACK';
    this.knockbackStart.copy(this.position);
    this.knockbackEnd.set(targetX, 0, targetZ);
    this.knockbackProgress = 0;
    this.velocity.set(0, 0, 0);
    this.addShake(1.0);
  }

  setOperatingTableAnchor(x: number, y: number, z: number): void {
    this.tableAnchor.set(x, y, z);
  }

  addShake(intensity: number): void {
    this.shakeIntensity = Math.min(1.4, this.shakeIntensity + intensity);
  }

  getEyePosition(): Vec3 {
    if (this.mode === 'OPERATING_TABLE') {
      return { x: this.tableAnchor.x, y: this.tableAnchor.y, z: this.tableAnchor.z };
    }
    const h = this.mode === 'FALLEN' ? 0.34 : this.eyeHeight;
    return {
      x: this.position.x,
      y: this.position.y + h,
      z: this.position.z,
    };
  }

  getForwardVector(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out).normalize();
  }

  update(
    dt: number,
    input: InputSnapshot,
    physics: PhysicsWorld,
  ): {
    dashed: boolean;
    sandevistanChanged: boolean;
    sandevistanActive: boolean;
    sandevistanEnded: boolean;
    healed: boolean;
  } {
    const timers = this.state.updateTimers(dt);
    let dashed = false;
    let sandevistanChanged = false;
    let sandevistanActive = this.state.sandevistanActive;
    let healed = false;

    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.8);

    if (this.mode === 'FREE') {
      // Mouse look
      this.yaw -= input.mouseDeltaX;
      this.pitch = Math.max(-1.32, Math.min(1.32, this.pitch - input.mouseDeltaY));

      // Abilities
      if (input.sandevistanPressed) {
        const res = this.state.toggleSandevistan();
        sandevistanChanged = res.changed;
        sandevistanActive = res.active;
      }

      if (input.healPressed) {
        healed = this.state.useMaxDoc();
      }

      // Compute horizontal move direction
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      const forwardX = -sinY;
      const forwardZ = -cosY;
      const rightX = cosY;
      const rightZ = -sinY;

      let wishX = forwardX * input.moveForward + rightX * input.moveRight;
      let wishZ = forwardZ * input.moveForward + rightZ * input.moveRight;
      const wishLen = Math.hypot(wishX, wishZ);
      if (wishLen > 0.001) {
        wishX /= wishLen;
        wishZ /= wishLen;
      }

      // Cyberpunk Kerenzikov/Dash burst
      if (input.dashPressed && this.state.dashCooldown <= 0) {
        this.state.dashCooldown = 1.15;
        this.dashTimer = 0.17;
        dashed = true;
        if (wishLen > 0.001) {
          this.dashDir.set(wishX, 0, wishZ);
        } else {
          this.dashDir.set(forwardX, 0, forwardZ);
        }
      }

      const baseSpeed = this.state.sandevistanActive ? 9.6 : 7.8;
      let moveX = wishX * baseSpeed;
      let moveZ = wishZ * baseSpeed;

      if (this.dashTimer > 0) {
        this.dashTimer = Math.max(0, this.dashTimer - dt);
        moveX = this.dashDir.x * 22.5;
        moveZ = this.dashDir.z * 22.5;
      }

      const nextX = this.position.x + moveX * dt;
      const nextZ = this.position.z + moveZ * dt;
      const resolved = physics.resolveCylinderMove(
        this.position,
        nextX,
        nextZ,
        this.radius,
        this.position.y,
        this.height,
      );
      this.position.x = resolved.x;
      this.position.z = resolved.z;

      // Jump & gravity
      if (input.jumpPressed && this.grounded) {
        this.velocity.y = 6.9;
        this.grounded = false;
      }
      this.velocity.y -= 18.5 * dt;
      this.position.y += this.velocity.y * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.velocity.y = 0;
        this.grounded = true;
      }

      // Headbob & strafe tilt
      const moving = wishLen > 0.1 && this.grounded;
      if (moving) {
        this.headBobPhase += dt * (this.state.sandevistanActive ? 13 : 10.5);
      } else {
        this.headBobPhase *= 0.9;
      }
      const targetRoll = -input.moveRight * 0.025;
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 10);
    } else if (this.mode === 'INTRO') {
      // Gentle cinematic breath & mouse subtle look
      this.yaw -= input.mouseDeltaX * 0.25;
      this.pitch = Math.max(-0.35, Math.min(0.45, this.pitch - input.mouseDeltaY * 0.25));
      this.roll *= 0.9;
    } else if (this.mode === 'KNOCKBACK') {
      // Launched backwards by Lev Smasher!
      this.knockbackProgress = Math.min(1, this.knockbackProgress + dt * 0.95);
      const t = this.knockbackProgress;
      const easeOut = 1 - Math.pow(1 - t, 3);
      this.position.x = THREE.MathUtils.lerp(this.knockbackStart.x, this.knockbackEnd.x, easeOut);
      this.position.z = THREE.MathUtils.lerp(this.knockbackStart.z, this.knockbackEnd.z, easeOut);
      // Parabolic flight arc with heavy landing bounce
      const arc = t < 0.72 ? Math.sin((t / 0.72) * Math.PI) * 2.15 : Math.sin(((t - 0.72) / 0.28) * Math.PI) * 0.28;
      this.position.y = Math.max(0, arc);

      // Camera looks back at Lev Smasher near doors (-Z) while tumbling
      this.yaw = THREE.MathUtils.lerp(this.yaw, 0, dt * 6);
      this.pitch = Math.sin(t * Math.PI) * 0.38 - (t > 0.7 ? (1 - t) * 0.4 : 0);
      this.roll = Math.sin(t * Math.PI * 1.4) * 0.55 * (1 - t * 0.65);
    } else if (this.mode === 'FALLEN') {
      // Heavily wounded Samir collapses to the floor and looks up at Smasher
      this.fallenTime += dt;
      const collapseT = Math.min(1, this.fallenTime / 1.15);
      const smooth = collapseT * collapseT * (3 - 2 * collapseT);
      this.roll = THREE.MathUtils.lerp(0, 1.08, smooth); // ~62 degrees sideways tilt
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.28, dt * 2.5);
      this.yaw = this.fallenBaseYaw + Math.sin(this.fallenTime * 0.9) * 0.04;
    } else if (this.mode === 'OPERATING_TABLE') {
      // Lying on operating table looking upward toward surgical light and Rodion
      this.tableYawOffset = Math.max(-0.65, Math.min(0.65, this.tableYawOffset - input.mouseDeltaX * 0.75));
      this.tablePitchOffset = Math.max(-0.32, Math.min(0.38, this.tablePitchOffset - input.mouseDeltaY * 0.75));
    }

    this.syncCamera(dt);

    return {
      dashed,
      sandevistanChanged,
      sandevistanActive,
      sandevistanEnded: timers.sandevistanEnded,
      healed,
    };
  }

  private syncCamera(dt: number): void {
    // Dynamic FOV punch on dash or Sandevistan
    const targetFov = this.dashTimer > 0 ? 88 : this.state.sandevistanActive ? 83 : this.baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    const shakeX = (Math.random() - 0.5) * 0.14 * this.shakeIntensity;
    const shakeY = (Math.random() - 0.5) * 0.14 * this.shakeIntensity;
    const shakeRoll = (Math.random() - 0.5) * 0.07 * this.shakeIntensity;

    if (this.mode === 'OPERATING_TABLE') {
      this.camera.position.set(
        this.tableAnchor.x + shakeX * 0.3,
        this.tableAnchor.y + shakeY * 0.3,
        this.tableAnchor.z,
      );
      // Base view looks diagonally up toward Rodion standing near -Z / +X side of table
      this.camera.rotation.set(
        0.34 + this.tablePitchOffset,
        -0.36 + this.tableYawOffset,
        shakeRoll * 0.4,
        'YXZ',
      );
      return;
    }

    let eyeOffsetY = this.eyeHeight;
    if (this.mode === 'FALLEN') {
      const collapseT = Math.min(1, this.fallenTime / 1.15);
      const smooth = collapseT * collapseT * (3 - 2 * collapseT);
      eyeOffsetY = THREE.MathUtils.lerp(this.eyeHeight, 0.32, smooth);
    } else if (this.mode === 'FREE') {
      eyeOffsetY += Math.sin(this.headBobPhase) * 0.045;
    }

    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + eyeOffsetY + shakeY,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, this.roll + shakeRoll, 'YXZ');
  }
}
