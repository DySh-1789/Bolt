import * as THREE from 'three';
import type { InteractablePoint } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';

interface SlidingDoor {
  id: string;
  leftLeaf: THREE.Mesh;
  rightLeaf: THREE.Mesh;
  closedLeftX: number;
  closedRightX: number;
  openOffset: number;
  isOpen: boolean;
  progress: number;
}

interface FlyingAv {
  mesh: THREE.Group;
  speed: number;
  minZ: number;
  maxZ: number;
}

export interface SupplyCrate {
  id: string;
  mesh: THREE.Group;
  x: number;
  z: number;
  used: boolean;
}

export class LevelBuilder {
  readonly root = new THREE.Group();
  readonly interactables: InteractablePoint[] = [];
  readonly supplyCrates: SupplyCrate[] = [];

  private doors = new Map<string, SlidingDoor>();
  private laserBarrierGroup: THREE.Group | null = null;
  private hologramSpinners: THREE.Object3D[] = [];
  private alarmLights: THREE.PointLight[] = [];
  private flyingAvs: FlyingAv[] = [];
  private councilDoorGlowMat: THREE.MeshStandardMaterial | null = null;

  private physics: PhysicsWorld;
  private textures: ProceduralTextures;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.physics = physics;
    this.textures = textures;
    scene.add(this.root);
  }

  build(): void {
    // Balanced atmospheric fill so rooms are readable without washing out shadows
    const hemi = new THREE.HemisphereLight(0x6e8ec4, 0x261626, 0.68);
    this.root.add(hemi);

    const ambient = new THREE.AmbientLight(0x303e5c, 0.30);
    this.root.add(ambient);

    const keyDir = new THREE.DirectionalLight(0xa8c4eb, 0.45);
    keyDir.position.set(14, 28, 12);
    this.root.add(keyDir);

    this.buildAtrium();
    this.buildConnector1();
    this.buildServerRoom();
    this.buildConnector2();
    this.buildCouncilHall();
  }

  private addBoxMeshAndCollider(
    id: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    material: THREE.Material,
    collide = true,
    blocksSight = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = sy > 1.5 && sx < 8 && sz < 8;
    this.root.add(mesh);
    if (collide) {
      this.physics.addStaticBox(id, cx, cy, cz, sx, sy, sz, blocksSight);
    }
    return mesh;
  }

  private addNeonStrip(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    colorHex: number,
    intensity = 1.65,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: Math.min(intensity, 1.85),
      roughness: 0.35,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    this.root.add(mesh);
    return mesh;
  }

  private addSignPlane(
    texture: THREE.Texture,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    rotY = 0,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.72,
      roughness: 0.45,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.root.add(mesh);
    return mesh;
  }

  private addSupplyCrate(id: string, x: number, z: number): void {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x16222c,
      metalness: 0.7,
      roughness: 0.35,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 2.2,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 0.8), bodyMat);
    base.position.y = 0.36;
    group.add(base);

    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.1), glowMat);
    crossH.position.set(0, 0.74, 0);
    group.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.42), glowMat);
    crossV.position.set(0, 0.74, 0);
    group.add(crossV);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.07, 0.84), glowMat);
    strip.position.y = 0.56;
    group.add(strip);

    group.position.set(x, 0, z);
    this.root.add(group);

    this.supplyCrates.push({ id, mesh: group, x, z, used: false });
    this.interactables.push({
      id,
      label: '[E] ПОПОЛНИТЬ MAXDOC И БРОНЮ',
      x,
      y: 0.8,
      z,
      radius: 2.8,
      enabled: true,
    });
  }

  private createSlidingDoor(
    id: string,
    centerZ: number,
    width: number,
    height: number,
    accentHex: number,
  ): void {
    const leafW = width * 0.5;
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x151926,
      metalness: 0.85,
      roughness: 0.28,
    });
    const leftLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, height, 0.5), doorMat);
    const rightLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, height, 0.5), doorMat);

    const closedLeftX = -leafW * 0.5;
    const closedRightX = leafW * 0.5;
    leftLeaf.position.set(closedLeftX, height * 0.5, centerZ);
    rightLeaf.position.set(closedRightX, height * 0.5, centerZ);

    // Neon trim on each leaf
    const trimMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: accentHex,
      emissiveIntensity: 2.4,
    });
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.12, height * 0.82, 0.56), trimMat);
    trimL.position.set(leafW * 0.42, 0, 0);
    leftLeaf.add(trimL);
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(0.12, height * 0.82, 0.56), trimMat);
    trimR.position.set(-leafW * 0.42, 0, 0);
    rightLeaf.add(trimR);

    this.root.add(leftLeaf, rightLeaf);
    this.physics.addStaticBox(id, 0, height * 0.5, centerZ, width, height, 0.7, true);

    this.doors.set(id, {
      id,
      leftLeaf,
      rightLeaf,
      closedLeftX,
      closedRightX,
      openOffset: leafW - 0.15,
      isOpen: false,
      progress: 0,
    });
  }

  // =========================================================================
  // SECTOR 1: MAIN ATRIUM OF MARAKULIN TOWER (Z: 18 to -28, X: -16 to 16)
  // =========================================================================
  private buildAtrium(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff003c', 8, 11),
      metalness: 0.2,
      roughness: 0.58,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 6, 2),
      metalness: 0.22,
      roughness: 0.64,
    });
    const darkMarble = new THREE.MeshStandardMaterial({
      color: 0x222b3f,
      metalness: 0.25,
      roughness: 0.55,
    });

    // Floor & ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 46), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -5);
    floor.receiveShadow = true;
    this.root.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 46),
      new THREE.MeshStandardMaterial({ color: 0x111624, roughness: 0.85 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 11, -5);
    this.root.add(ceiling);

    // Outer walls
    this.addBoxMeshAndCollider('atrium_south', 0, 5.5, 18.5, 33, 11, 1, wallMat);
    this.addBoxMeshAndCollider('atrium_west', -16.5, 5.5, -5, 1, 11, 47, wallMat);
    this.addBoxMeshAndCollider('atrium_east', 16.5, 5.5, -5, 1, 11, 47, wallMat);
    // North wall with doorway (X: -3.5..3.5, Y: 0..5.2)
    this.addBoxMeshAndCollider('atrium_north_l', -9.75, 5.5, -28, 12.5, 11, 1, wallMat);
    this.addBoxMeshAndCollider('atrium_north_r', 9.75, 5.5, -28, 12.5, 11, 1, wallMat);
    this.addBoxMeshAndCollider('atrium_north_top', 0, 8.1, -28, 7.2, 5.8, 1, wallMat);

    // Sliding blast door to Sector 2
    this.createSlidingDoor('door_atrium', -28, 7.0, 5.2, 0xff003c);

    // Iconic corporate neon signs
    this.addSignPlane(
      this.textures.getNeonSign('MARAKULIN CORP', 'МАРАКУЛИН ТАВЕР // ГЛАВНЫЙ АТРИУМ', '#ff003c', '#00f0ff'),
      0,
      7.9,
      -27.3,
      14.5,
      3.4,
      0,
    );
    this.addSignPlane(
      this.textures.getNeonSign('СЕКТОР 01', 'ТРЕВОГА БЕЗОПАСНОСТИ // КОД КРАСНЫЙ', '#ff003c', '#fcee0a'),
      -15.9,
      6.8,
      -4,
      11,
      2.6,
      Math.PI / 2,
    );
    this.addSignPlane(
      this.textures.getNeonSign('MARAKULIN TOWER', 'КОНТРОЛЬ ЭНГРАММ // ДУШЕГУБ', '#00f0ff', '#ff003c'),
      15.9,
      6.8,
      -4,
      11,
      2.6,
      -Math.PI / 2,
    );

    // Central dais + rotating holographic corporate monument
    this.addBoxMeshAndCollider('atrium_dais', 0, 0.75, -4, 4.2, 1.5, 4.2, darkMarble, true, false);
    this.addNeonStrip(0, 1.52, -4, 4.35, 0.08, 4.35, 0xff003c, 1.6);

    const holoGroup = new THREE.Group();
    holoGroup.position.set(0, 4.3, -4);
    const holoMat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
    });
    const coreOct = new THREE.Mesh(new THREE.OctahedronGeometry(1.55, 0), holoMat);
    holoGroup.add(coreOct);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.08, 8, 28), ringMat);
    outerRing.rotation.x = Math.PI / 3;
    holoGroup.add(outerRing);
    this.root.add(holoGroup);
    this.hologramSpinners.push(holoGroup);

    // 6 Tall columns with crimson light channels
    const colZ = [6, -4, -14];
    for (const cz of colZ) {
      for (const cx of [-9.5, 9.5]) {
        this.addBoxMeshAndCollider(`atrium_col_${cx}_${cz}`, cx, 5.5, cz, 2.2, 11, 2.2, darkMarble);
        this.addNeonStrip(cx, 5.5, cz + 1.12, 0.16, 10.2, 0.08, 0xff003c, 1.6);
        this.addNeonStrip(cx, 5.5, cz - 1.12, 0.16, 10.2, 0.08, 0x00f0ff, 1.4);
      }
    }

    // Tactical waist-high cover desks & barricades with glowing top edges
    const atriumCovers: Array<[string, number, number, number, number]> = [
      ['atrium_cover_1', -4.8, 4.5, 3.2, 1.0],
      ['atrium_cover_2', 4.8, 4.5, 3.2, 1.0],
      ['atrium_cover_3', -5.2, -12, 3.4, 1.0],
      ['atrium_cover_4', 5.2, -12, 3.4, 1.0],
      ['atrium_cover_5', 0, -19.5, 4.4, 1.1],
    ];
    for (const [id, x, z, w, d] of atriumCovers) {
      this.addBoxMeshAndCollider(id, x, 0.65, z, w, 1.3, d, darkMarble, true, false);
      this.addNeonStrip(x, 1.32, z, w + 0.06, 0.06, d + 0.06, 0x00f0ff, 1.3);
    }

    // Balanced overhead cyberpunk neon trusses & lights (no glare hotspots)
    for (const lz of [12, 2, -8, -19]) {
      const isCrimson = lz === -8;
      this.addNeonStrip(0, 10.7, lz, 24, 0.18, 0.35, isCrimson ? 0xff003c : 0x00f0ff, 1.5);
      const pt = new THREE.PointLight(isCrimson ? 0xff3b62 : 0x64d6f5, isCrimson ? 24 : 26, 30, 1.55);
      pt.position.set(0, 8.6, lz);
      this.root.add(pt);
      if (isCrimson) this.alarmLights.push(pt);
    }
  }

  // =========================================================================
  // CONNECTOR 1 -> 2 (Z: -28 to -38, X: -3.8 to 3.8)
  // =========================================================================
  private buildConnector1(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#00f0ff', 2, 3),
      metalness: 0.2,
      roughness: 0.58,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#00f0ff', 2, 1),
      metalness: 0.22,
      roughness: 0.64,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 10.4), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -33);
    this.root.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 10.4),
      new THREE.MeshStandardMaterial({ color: 0x111624, roughness: 0.85 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 5.4, -33);
    this.root.add(ceil);

    this.addBoxMeshAndCollider('conn1_w', -4.1, 2.7, -33, 0.8, 5.4, 10.4, wallMat);
    this.addBoxMeshAndCollider('conn1_e', 4.1, 2.7, -33, 0.8, 5.4, 10.4, wallMat);
    this.addNeonStrip(0, 5.2, -33, 0.25, 0.12, 9.6, 0x00f0ff, 1.5);

    const pt = new THREE.PointLight(0x5edbf5, 16, 18, 1.5);
    pt.position.set(0, 4.4, -33);
    this.root.add(pt);
  }

  // =========================================================================
  // SECTOR 2: CYBERSECURITY SERVER HUB (Z: -38 to -80, X: -14 to 14)
  // =========================================================================
  private buildServerRoom(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#00f0ff', 7, 10),
      metalness: 0.2,
      roughness: 0.58,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#00f0ff', 6, 2),
      metalness: 0.22,
      roughness: 0.64,
    });
    const rackMat = new THREE.MeshStandardMaterial({
      map: this.textures.getServerRack(),
      emissiveMap: this.textures.getServerRack(),
      emissive: new THREE.Color(0x99ccff),
      emissiveIntensity: 0.62,
      metalness: 0.28,
      roughness: 0.52,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 42), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -59);
    floor.receiveShadow = true;
    this.root.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 42),
      new THREE.MeshStandardMaterial({ color: 0x101624, roughness: 0.85 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 8, -59);
    this.root.add(ceil);

    // Outer walls
    this.addBoxMeshAndCollider('srv_south_l', -9, 4, -38, 10.4, 8, 1, wallMat);
    this.addBoxMeshAndCollider('srv_south_r', 9, 4, -38, 10.4, 8, 1, wallMat);
    this.addBoxMeshAndCollider('srv_south_top', 0, 6.7, -38, 8, 2.6, 1, wallMat);
    this.addBoxMeshAndCollider('srv_west', -14.5, 4, -59, 1, 8, 43, wallMat);
    this.addBoxMeshAndCollider('srv_east', 14.5, 4, -59, 1, 8, 43, wallMat);

    // North wall with doorway (X: -4..4)
    this.addBoxMeshAndCollider('srv_north_l', -9.2, 4, -80, 10.4, 8, 1, wallMat);
    this.addBoxMeshAndCollider('srv_north_r', 9.2, 4, -80, 10.4, 8, 1, wallMat);
    this.addBoxMeshAndCollider('srv_north_top', 0, 6.8, -80, 8.4, 2.4, 1, wallMat);

    this.addSignPlane(
      this.textures.getNeonSign('СЕРВЕРНЫЙ УЗЕЛ', 'ДОСТУП: НЕТРАННЕРЫ МАРАКУЛИН // СЕКТОР 02', '#00f0ff', '#fcee0a'),
      0,
      6.4,
      -79.35,
      12.5,
      2.6,
      0,
    );

    // Tactical server rack rows
    const rackCoords: Array<[number, number]> = [
      [-8, -47],
      [0, -47],
      [8, -47],
      [-9.5, -57],
      [-3.2, -57],
      [3.2, -57],
      [9.5, -57],
      [-7.5, -67],
      [0, -67],
      [7.5, -67],
    ];
    rackCoords.forEach(([rx, rz], idx) => {
      this.addBoxMeshAndCollider(`srv_rack_${idx}`, rx, 2.1, rz, 2.4, 4.2, 2.4, rackMat);
      this.addNeonStrip(rx, 4.25, rz, 2.45, 0.08, 2.45, idx % 2 === 0 ? 0x00f0ff : 0xff003c, 1.4);
    });

    // Laser security barrier blocking exit until hacked
    const laserGroup = new THREE.Group();
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8.0, 8), beamMat);
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, 0.65 + i * 0.82, -79.4);
      laserGroup.add(beam);
    }
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 5.4),
      new THREE.MeshBasicMaterial({
        color: 0xff003c,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
      }),
    );
    field.position.set(0, 2.7, -79.4);
    laserGroup.add(field);
    this.root.add(laserGroup);
    this.laserBarrierGroup = laserGroup;
    this.physics.addStaticBox('door_laser', 0, 2.8, -79.4, 8.2, 5.6, 0.6, false);

    // Hack terminal next to the laser barrier
    const termGroup = new THREE.Group();
    const ped = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.35, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x263147, metalness: 0.35, roughness: 0.5 }),
    );
    ped.position.y = 0.675;
    termGroup.add(ped);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.55),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.7,
      }),
    );
    screen.position.set(0, 1.5, 0.35);
    screen.rotation.x = -0.35;
    termGroup.add(screen);
    termGroup.position.set(5.8, 0, -75.5);
    this.root.add(termGroup);
    this.physics.addStaticBox('terminal_box', 5.8, 0.7, -75.5, 1.2, 1.4, 1.0, false);

    this.interactables.push({
      id: 'terminal_hack',
      label: '[E] ВЗЛОМАТЬ ЛАЗЕРНЫЙ БАРЬЕР',
      x: 5.8,
      y: 1.4,
      z: -75.5,
      radius: 3.1,
      enabled: false, // Enabled once Sector 2 hostiles are cleared
    });

    // Supply crate in Sector 2
    this.addSupplyCrate('crate_sector2', -5.8, -75.5);

    // Sector 2 lights
    for (const lz of [-44, -54, -64, -74]) {
      this.addNeonStrip(0, 7.75, lz, 20, 0.14, 0.28, lz === -74 ? 0xff003c : 0x00f0ff, 1.5);
      const pt = new THREE.PointLight(lz === -74 ? 0xff3b62 : 0x56d8f2, 22, 28, 1.55);
      pt.position.set(0, 6.4, lz);
      this.root.add(pt);
    }
  }

  // =========================================================================
  // CONNECTOR 2 -> 3 (Z: -80 to -90, X: -4.2 to 4.2)
  // =========================================================================
  private buildConnector2(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 2, 3),
      metalness: 0.2,
      roughness: 0.58,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#fcee0a', 2, 1),
      metalness: 0.22,
      roughness: 0.64,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 10.4), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -85);
    this.root.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 10.4),
      new THREE.MeshStandardMaterial({ color: 0x111624, roughness: 0.85 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 6.2, -85);
    this.root.add(ceil);

    this.addBoxMeshAndCollider('conn2_w', -4.5, 3.1, -85, 0.8, 6.2, 10.4, wallMat);
    this.addBoxMeshAndCollider('conn2_e', 4.5, 3.1, -85, 0.8, 6.2, 10.4, wallMat);
    this.addNeonStrip(0, 6.0, -85, 0.3, 0.12, 9.5, 0xfcee0a, 1.5);

    const pt = new THREE.PointLight(0xf5be5b, 18, 18, 1.5);
    pt.position.set(0, 5.2, -85);
    this.root.add(pt);
  }

  // =========================================================================
  // SECTOR 3: COUNCIL ANTECHAMBER & BOSS ARENA (Z: -90 to -142, X: -18 to 18)
  // =========================================================================
  private buildCouncilHall(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff003c', 9, 13),
      metalness: 0.22,
      roughness: 0.56,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 8, 2),
      metalness: 0.22,
      roughness: 0.62,
    });
    const monolithMat = new THREE.MeshStandardMaterial({
      color: 0x222b3f,
      metalness: 0.25,
      roughness: 0.54,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 52), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -116);
    floor.receiveShadow = true;
    this.root.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 52),
      new THREE.MeshStandardMaterial({ color: 0x05070e }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 14, -116);
    this.root.add(ceil);

    // South wall with entrance (X: -4.2..4.2)
    this.addBoxMeshAndCollider('hall_south_l', -11.1, 7, -90, 13.8, 14, 1, wallMat);
    this.addBoxMeshAndCollider('hall_south_r', 11.1, 7, -90, 13.8, 14, 1, wallMat);
    this.addBoxMeshAndCollider('hall_south_top', 0, 10.1, -90, 8.8, 7.8, 1, wallMat);

    // Boss lock door (starts open, closes when Lev Smasher ambushes!)
    this.createSlidingDoor('door_boss_lock', -90, 8.2, 6.2, 0xff003c);
    this.setDoorOpen('door_boss_lock', true, true);

    // East solid corporate wall
    this.addBoxMeshAndCollider('hall_east', 18.5, 7, -116, 1, 14, 53, wallMat);

    // West panoramic glass window overlooking Night City skyline!
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x112238,
      metalness: 0.2,
      roughness: 0.08,
      transparent: true,
      opacity: 0.22,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(52, 12.5), glassMat);
    glass.position.set(-18, 6.8, -116);
    glass.rotation.y = Math.PI / 2;
    this.root.add(glass);
    this.physics.addStaticBox('hall_west_glass', -18.4, 7, -116, 0.8, 14, 53, false);

    // Window mullions
    for (let mz = -96; mz >= -136; mz -= 10) {
      this.addBoxMeshAndCollider(`mullion_${mz}`, -17.9, 7, mz, 0.5, 14, 0.5, monolithMat, false);
    }

    // Night City skyline backdrop + flying AVs outside the west window
    const skylineMat = new THREE.MeshBasicMaterial({
      map: this.textures.getCitySkyline(),
    });
    const skyline = new THREE.Mesh(new THREE.PlaneGeometry(110, 52), skylineMat);
    skyline.position.set(-46, 12, -116);
    skyline.rotation.y = Math.PI / 2;
    this.root.add(skyline);

    for (let i = 0; i < 6; i++) {
      const av = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.45, 3.2),
        new THREE.MeshStandardMaterial({ color: 0x141824, metalness: 0.8, roughness: 0.2 }),
      );
      av.add(body);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.16, 0.2),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00f0ff : 0xfcee0a }),
      );
      head.position.z = 1.65;
      av.add(head);
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.16, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xff003c }),
      );
      tail.position.z = -1.65;
      av.add(tail);

      const dir = i % 2 === 0 ? 1 : -1;
      av.position.set(-24 - (i % 3) * 5, 2.5 + i * 2.1, -90 - i * 8);
      if (dir < 0) av.rotation.y = Math.PI;
      this.root.add(av);
      this.flyingAvs.push({
        mesh: av,
        speed: (12 + i * 2.5) * dir,
        minZ: -165,
        maxZ: -70,
      });
    }

    // North wall & Monumental Doors to Rodion's Council Chamber
    this.addBoxMeshAndCollider('hall_north', 0, 7, -142.5, 37, 14, 1, wallMat);

    // Ceremonial red carpet / neon runway straight to Rodion's doors
    this.addNeonStrip(-2.6, 0.04, -116, 0.16, 0.04, 48, 0xff003c, 2.2);
    this.addNeonStrip(2.6, 0.04, -116, 0.16, 0.04, 48, 0xff003c, 2.2);

    // Monumental Council Chamber Double Doors (Z = -141.6)
    const councilDoorMat = new THREE.MeshStandardMaterial({
      color: 0x160a10,
      metalness: 0.85,
      roughness: 0.22,
    });
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(9.2, 7.6, 0.9), monolithMat);
    doorFrame.position.set(0, 3.8, -141.8);
    this.root.add(doorFrame);

    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 6.6, 0.6), councilDoorMat);
    doorPanel.position.set(0, 3.3, -141.4);
    this.root.add(doorPanel);

    this.councilDoorGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xfcee0a,
      emissiveIntensity: 2.5,
    });
    const doorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.4, 0.68), this.councilDoorGlowMat);
    doorSeam.position.set(0, 3.3, -141.35);
    this.root.add(doorSeam);
    const doorArch = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.24, 0.72), this.councilDoorGlowMat);
    doorArch.position.set(0, 6.75, -141.35);
    this.root.add(doorArch);

    this.addSignPlane(
      this.textures.getNeonSign('ЗАЛ СОВЕТА // РОДИОН', 'ДОСТУП ТОЛЬКО ДЛЯ СОВЕТА ДИРЕКТОРОВ', '#ff003c', '#fcee0a'),
      0,
      9.6,
      -141.4,
      15.5,
      3.4,
      0,
    );

    // Tactical arena cover pillars & low monoliths
    const tallCovers: Array<[number, number]> = [
      [-9.5, -104],
      [9.5, -104],
      [-10.5, -118],
      [10.5, -118],
    ];
    tallCovers.forEach(([x, z], i) => {
      this.addBoxMeshAndCollider(`hall_pillar_${i}`, x, 3.2, z, 2.8, 6.4, 2.8, monolithMat);
      this.addNeonStrip(x, 3.2, z + 1.44, 0.16, 5.8, 0.08, 0xff003c, 2.2);
    });

    const lowCovers: Array<[number, number]> = [
      [-6.2, -111],
      [6.2, -111],
      [-7.0, -128],
      [7.0, -128],
    ];
    lowCovers.forEach(([x, z], i) => {
      this.addBoxMeshAndCollider(`hall_low_${i}`, x, 0.85, z, 3.2, 1.7, 1.4, monolithMat, true, false);
      this.addNeonStrip(x, 1.72, z, 3.24, 0.07, 1.44, 0xfcee0a, 1.8);
    });

    // Supply crates in Sector 3 (helpful before & during Lev Smasher fight!)
    this.addSupplyCrate('crate_sector3_a', -13.5, -99);
    this.addSupplyCrate('crate_sector3_b', 13.5, -122);

    // Dramatic crimson & golden ceiling lighting
    for (const lz of [-96, -109, -122, -135]) {
      const isCrimson = lz === -135;
      this.addNeonStrip(0, 13.6, lz, 26, 0.2, 0.4, isCrimson ? 0xff003c : 0xfcee0a, 1.5);
      const pt = new THREE.PointLight(isCrimson ? 0xff3b62 : 0xf5be6b, isCrimson ? 26 : 28, 36, 1.5);
      pt.position.set(0, 10.6, lz);
      this.root.add(pt);
      if (isCrimson) this.alarmLights.push(pt);
    }
  }

  setDoorOpen(id: string, open: boolean, immediate = false): void {
    const door = this.doors.get(id);
    if (!door) return;
    door.isOpen = open;
    this.physics.setColliderActive(id, !open);
    if (immediate) {
      door.progress = open ? 1 : 0;
      door.leftLeaf.position.x = door.closedLeftX - door.openOffset * door.progress;
      door.rightLeaf.position.x = door.closedRightX + door.openOffset * door.progress;
    }
  }

  setLaserBarrierActive(active: boolean): void {
    if (this.laserBarrierGroup) {
      this.laserBarrierGroup.visible = active;
    }
    this.physics.setColliderActive('door_laser', active);
  }

  setCouncilDoorAlert(alertRed: boolean): void {
    if (!this.councilDoorGlowMat) return;
    const hex = alertRed ? 0xff003c : 0xfcee0a;
    this.councilDoorGlowMat.color.setHex(hex);
    this.councilDoorGlowMat.emissive.setHex(hex);
    this.councilDoorGlowMat.emissiveIntensity = alertRed ? 4.0 : 2.5;
  }

  setInteractableEnabled(id: string, enabled: boolean): void {
    const item = this.interactables.find((i) => i.id === id);
    if (item) {
      item.enabled = enabled;
    }
  }

  findNearbyInteractable(px: number, pz: number): InteractablePoint | null {
    let best: InteractablePoint | null = null;
    let bestDist = Infinity;
    for (const item of this.interactables) {
      if (!item.enabled) continue;
      const dist = Math.hypot(item.x - px, item.z - pz);
      if (dist <= item.radius && dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return best;
  }

  markCrateUsed(id: string): void {
    const crate = this.supplyCrates.find((c) => c.id === id);
    if (crate) {
      crate.used = true;
      crate.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          if (child.material.emissiveIntensity > 0) {
            child.material.emissiveIntensity = 0.15;
            child.material.color.setHex(0x334444);
          }
        }
      });
    }
    this.setInteractableEnabled(id, false);
  }

  resetInteractiveState(): void {
    this.setDoorOpen('door_atrium', false, true);
    this.setDoorOpen('door_boss_lock', true, true);
    this.setLaserBarrierActive(true);
    this.setCouncilDoorAlert(false);
    this.setInteractableEnabled('terminal_hack', false);

    for (const crate of this.supplyCrates) {
      crate.used = false;
      this.setInteractableEnabled(crate.id, true);
    }
  }

  update(dt: number, totalTime: number): void {
    // Rotate Atrium hologram monument
    for (const holo of this.hologramSpinners) {
      holo.rotation.y += dt * 0.65;
      holo.position.y = 4.3 + Math.sin(totalTime * 1.9) * 0.22;
    }

    // Pulse alarm lights
    for (let i = 0; i < this.alarmLights.length; i++) {
      this.alarmLights[i].intensity = 24 + Math.sin(totalTime * 5.2 + i) * 7;
    }

    // Animate sliding doors
    for (const door of this.doors.values()) {
      const target = door.isOpen ? 1 : 0;
      if (Math.abs(door.progress - target) > 0.001) {
        const dir = target > door.progress ? 1 : -1;
        door.progress = Math.max(0, Math.min(1, door.progress + dir * dt * 1.6));
        door.leftLeaf.position.x = door.closedLeftX - door.openOffset * door.progress;
        door.rightLeaf.position.x = door.closedRightX + door.openOffset * door.progress;
      }
    }

    // Animate flying Night City AVs outside Sector 3 panoramic glass
    for (const av of this.flyingAvs) {
      av.mesh.position.z += av.speed * dt;
      if (av.speed > 0 && av.mesh.position.z > av.maxZ) {
        av.mesh.position.z = av.minZ;
      } else if (av.speed < 0 && av.mesh.position.z < av.minZ) {
        av.mesh.position.z = av.maxZ;
      }
    }
  }
}
