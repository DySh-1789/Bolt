import * as THREE from 'three';
import type { ProceduralTextures } from '../engine/ProceduralTextures';

/**
 * Sector 4: The sterile-cybernetic Operating Laboratory at Y = 100.
 * Samir wakes strapped to the operating table while corporate villain Rodion
 * looms over him holding a glowing Biochip and activates SOULKILLER ("Душегуб").
 */
export class OperatingTableScene {
  readonly root = new THREE.Group();
  readonly originY = 100;

  private rodionGroup = new THREE.Group();
  private rodionRightArm = new THREE.Group();
  private biochipMesh!: THREE.Mesh;
  private soulkillerCrown = new THREE.Group();
  private soulkillerLasers = new THREE.Group();
  private soulkillerLight!: THREE.PointLight;
  private surgicalLight!: THREE.SpotLight;
  private particlePoints!: THREE.Points;
  private particleVelocities: Float32Array = new Float32Array(0);

  private textures: ProceduralTextures;
  private soulkillerProgress = 0;

  constructor(scene: THREE.Scene, textures: ProceduralTextures) {
    this.textures = textures;
    this.root.position.set(0, this.originY, 0);
    this.root.visible = false;
    scene.add(this.root);
    this.buildLab();
    this.buildRodion();
    this.buildSoulkillerParticles();
  }

  private buildLab(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#00f0ff', 4, 4),
      metalness: 0.45,
      roughness: 0.25,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 3, 2),
      metalness: 0.6,
      roughness: 0.35,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x3b4456,
      metalness: 0.88,
      roughness: 0.2,
    });

    // Enclosed sterile dark-cyberpunk operating chamber (14 x 6.5 x 14)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x05080f }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 6.2;
    this.root.add(ceil);

    const walls: Array<[number, number, number, number, number, number]> = [
      [0, 3.1, -7, 14, 6.2, 0.4],
      [0, 3.1, 7, 14, 6.2, 0.4],
      [-7, 3.1, 0, 0.4, 6.2, 14],
      [7, 3.1, 0, 0.4, 6.2, 14],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      this.root.add(m);
    }

    // Operating table beneath Samir's camera (0, 1.65, 0.3)
    const tableBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 2.2), steelMat);
    tableBase.position.set(0, 0.425, 0.15);
    this.root.add(tableBase);
    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.16, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x161b26, metalness: 0.5, roughness: 0.45 }),
    );
    tableTop.position.set(0, 0.92, 0.15);
    this.root.add(tableTop);

    // Glowing red laser-restraint cuffs visible at edges of table
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 2.5,
    });
    for (const cz of [-0.45, 0.65]) {
      const railL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.32), cuffMat);
      railL.position.set(-0.62, 1.04, cz);
      const railR = railL.clone();
      railR.position.x = 0.62;
      this.root.add(railL, railR);
    }

    // Medical ECG & Soulkiller monitors flanking Samir's view
    const ecgMat = new THREE.MeshStandardMaterial({
      map: this.textures.getMedicalMonitor('ecg'),
      emissiveMap: this.textures.getMedicalMonitor('ecg'),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.0,
    });
    const ecgScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.15), ecgMat);
    ecgScreen.position.set(-2.3, 2.35, -2.0);
    ecgScreen.rotation.y = 0.55;
    this.root.add(ecgScreen);

    const skMat = new THREE.MeshStandardMaterial({
      map: this.textures.getMedicalMonitor('soulkiller'),
      emissiveMap: this.textures.getMedicalMonitor('soulkiller'),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.1,
    });
    const skScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.25), skMat);
    skScreen.position.set(2.3, 2.4, -2.1);
    skScreen.rotation.y = -0.52;
    this.root.add(skScreen);

    // Back wall glowing corporate banner
    const labSign = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 1.7),
      new THREE.MeshStandardMaterial({
        map: this.textures.getNeonSign('SOULKILLER // ДУШЕГУБ', 'МАРАКУЛИН ТАВЕР // ЛАБОРАТОРИЯ ЭНГРАММ', '#ff003c', '#00f0ff'),
        emissiveMap: this.textures.getNeonSign('SOULKILLER // ДУШЕГУБ', 'МАРАКУЛИН ТАВЕР // ЛАБОРАТОРИЯ ЭНГРАММ', '#ff003c', '#00f0ff'),
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
      }),
    );
    labSign.position.set(0, 4.3, -6.7);
    this.root.add(labSign);

    // Overhead surgical lamp ring + descending Soulkiller Neural Crown
    this.soulkillerCrown.position.set(0, 4.4, -0.15);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 10, 28), steelMat);
    ring.rotation.x = Math.PI / 2;
    this.soulkillerCrown.add(ring);

    const lampGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.05, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xd8f8ff,
        emissive: 0xb8f0ff,
        emissiveIntensity: 2.6,
      }),
    );
    lampGlow.rotation.x = Math.PI / 2;
    lampGlow.position.y = -0.05;
    this.soulkillerCrown.add(lampGlow);

    // Soulkiller converging extraction laser beams (activated during SOULKILLER act)
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.5, 6), laserMat);
      beam.position.set(Math.cos(a) * 0.48, -1.25, Math.sin(a) * 0.48);
      beam.rotation.z = Math.cos(a) * 0.25;
      beam.rotation.x = -Math.sin(a) * 0.25;
      this.soulkillerLasers.add(beam);
    }
    this.soulkillerLasers.visible = false;
    this.soulkillerCrown.add(this.soulkillerLasers);
    this.root.add(this.soulkillerCrown);

    // Dramatic sterile spotlight from overhead + ambient cyan/red bounce
    this.surgicalLight = new THREE.SpotLight(0xdaf6ff, 55, 16, Math.PI / 3, 0.45, 1.3);
    this.surgicalLight.position.set(0, 5.2, 0.2);
    this.surgicalLight.target.position.set(0.3, 1.0, -0.6);
    this.root.add(this.surgicalLight, this.surgicalLight.target);

    const rimRed = new THREE.PointLight(0xff003c, 22, 14, 1.5);
    rimRed.position.set(3.2, 2.6, -3.5);
    this.root.add(rimRed);

    const rimCyan = new THREE.PointLight(0x00f0ff, 18, 14, 1.5);
    rimCyan.position.set(-3.2, 2.6, -2.5);
    this.root.add(rimCyan);

    this.soulkillerLight = new THREE.PointLight(0xff003c, 0, 12, 1.4);
    this.soulkillerLight.position.set(0, 2.8, 0);
    this.root.add(this.soulkillerLight);
  }

  /**
   * Builds corporate antagonist Rodion in a sleek dark-red corporate suit with gold cyber-seams,
   * glowing ocular implant, and a luminous Biochip in his raised hand.
   */
  private buildRodion(): void {
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x0d1018,
      metalness: 0.42,
      roughness: 0.38,
    });
    const crimsonLapel = new THREE.MeshStandardMaterial({
      color: 0x7c0a20,
      emissive: 0x440310,
      emissiveIntensity: 0.8,
      metalness: 0.55,
      roughness: 0.3,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xc8a998,
      roughness: 0.62,
      metalness: 0.08,
    });
    const goldChrome = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xffaa00,
      emissiveIntensity: 1.5,
      metalness: 0.9,
      roughness: 0.2,
    });

    // Legs
    const legGeo = new THREE.BoxGeometry(0.22, 0.95, 0.24);
    const legL = new THREE.Mesh(legGeo, suitMat);
    legL.position.set(-0.15, 0.475, 0);
    const legR = legL.clone();
    legR.position.x = 0.15;
    this.rodionGroup.add(legL, legR);

    // Tailored double-breasted corporate coat
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.92, 0.34), suitMat);
    torso.position.set(0, 1.4, 0);
    this.rodionGroup.add(torso);

    // High crimson neo-corpo collar & tie accent
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.38), crimsonLapel);
    collar.position.set(0, 1.88, 0);
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.36), crimsonLapel);
    lapel.position.set(0, 1.48, 0.02);
    this.rodionGroup.add(collar, lapel);

    // Head with gold cybernetic seams and glowing crimson right ocular implant
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.32), skinMat);
    head.position.set(0, 2.15, 0.02);
    this.rodionGroup.add(head);

    // Slicked-back dark corporate hair
    const hair = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.14, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x090a10, roughness: 0.5 }),
    );
    hair.position.set(0, 2.34, 0);
    this.rodionGroup.add(hair);

    // Cybernetic right eye + gold temple line
    const cyberEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff003c, emissive: 0xff003c, emissiveIntensity: 3.5 }),
    );
    cyberEye.position.set(-0.075, 2.16, 0.165);
    const naturalEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x161a24 }),
    );
    naturalEye.position.set(0.075, 2.16, 0.165);
    const goldSeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.04), goldChrome);
    goldSeam.position.set(-0.14, 2.12, 0.15);
    this.rodionGroup.add(cyberEye, naturalEye, goldSeam);

    // Left arm behind back / authoritative posture
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.18), suitMat);
    armL.position.set(0.38, 1.42, -0.02);
    armL.rotation.z = -0.1;
    this.rodionGroup.add(armL);

    // Right arm pivot holding the glowing Soulkiller Biochip
    this.rodionRightArm.position.set(-0.38, 1.72, 0.06);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.68, 0.18), suitMat);
    armR.position.set(0, -0.26, 0.22);
    armR.rotation.x = -0.95;
    this.rodionRightArm.add(armR);

    this.biochipMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.16, 0.025),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 3.5,
      }),
    );
    this.biochipMesh.position.set(0, -0.35, 0.56);
    this.rodionRightArm.add(this.biochipMesh);
    this.rodionGroup.add(this.rodionRightArm);

    // Position Rodion beside the operating table, looking down at Samir
    this.rodionGroup.position.set(1.15, 0.35, -1.25);
    this.rodionGroup.rotation.y = -0.68;
    this.root.add(this.rodionGroup);
  }

  private buildSoulkillerParticles(): void {
    const count = 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.particleVelocities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 4.2;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = 0.6 + Math.random() * 4.5;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      this.particleVelocities[i] = 0.8 + Math.random() * 2.4;

      const isCyan = i % 2 === 0;
      colors[i * 3] = isCyan ? 0.0 : 1.0;
      colors[i * 3 + 1] = isCyan ? 0.94 : 0.05;
      colors[i * 3 + 2] = isCyan ? 1.0 : 0.28;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.085,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.particlePoints = new THREE.Points(geo, mat);
    this.root.add(this.particlePoints);
  }

  activate(): void {
    this.root.visible = true;
    this.soulkillerProgress = 0;
    this.soulkillerCrown.position.y = 4.4;
    this.soulkillerLasers.visible = false;
    this.soulkillerLight.intensity = 0;
    this.rodionGroup.position.set(1.25, 0.35, -1.55);
    this.rodionRightArm.rotation.x = 0.25;
    (this.particlePoints.material as THREE.PointsMaterial).opacity = 0;
  }

  deactivate(): void {
    this.root.visible = false;
  }

  setSoulkillerProgress(progress: number): void {
    this.soulkillerProgress = Math.max(0, Math.min(1, progress));
    this.soulkillerLasers.visible = this.soulkillerProgress > 0.02;
    this.soulkillerCrown.position.y = THREE.MathUtils.lerp(4.4, 2.75, Math.min(1, this.soulkillerProgress * 1.4));
    this.soulkillerLight.intensity = this.soulkillerProgress * 55;
    (this.particlePoints.material as THREE.PointsMaterial).opacity = Math.min(0.95, this.soulkillerProgress * 1.25);
  }

  update(dt: number, elapsed: number, rodionCloser: boolean): void {
    if (!this.root.visible) return;

    // Rodion steps smoothly closer during monologue
    const targetZ = rodionCloser ? -1.05 : -1.55;
    const targetX = rodionCloser ? 0.92 : 1.25;
    this.rodionGroup.position.z += (targetZ - this.rodionGroup.position.z) * Math.min(1, dt * 1.5);
    this.rodionGroup.position.x += (targetX - this.rodionGroup.position.x) * Math.min(1, dt * 1.5);

    // Subtle sinister breathing & raising the biochip
    const targetArmRot = this.soulkillerProgress > 0 ? -0.45 : rodionCloser ? -0.25 : 0.22;
    this.rodionRightArm.rotation.x += (targetArmRot - this.rodionRightArm.rotation.x) * Math.min(1, dt * 2.2);
    this.biochipMesh.rotation.y += dt * 2.5;

    // Spin Soulkiller laser crown and ascend engram particles
    if (this.soulkillerProgress > 0.01) {
      this.soulkillerCrown.rotation.y += dt * (1.5 + this.soulkillerProgress * 5.0);
      const posAttr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) + this.particleVelocities[i] * dt * (1 + this.soulkillerProgress * 2.5);
        if (y > 5.8) y = 0.6;
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        const rot = dt * (0.6 + this.soulkillerProgress * 1.4);
        const nx = x * Math.cos(rot) - z * Math.sin(rot);
        const nz = x * Math.sin(rot) + z * Math.cos(rot);
        posAttr.setXYZ(i, nx, y, nz);
      }
      posAttr.needsUpdate = true;
    }

    // Subtle surgical lamp flicker
    this.surgicalLight.intensity = 52 + Math.sin(elapsed * 11) * (this.soulkillerProgress > 0 ? 18 : 2.5);
  }
}
