import type { AABB, Vec3 } from '../types/game';

export interface RayHit {
  hit: boolean;
  distance: number;
  colliderId: string | null;
  point: Vec3;
}

export class PhysicsWorld {
  private colliders: AABB[] = [];
  private byId = new Map<string, AABB>();

  addBox(box: AABB): void {
    this.colliders.push(box);
    this.byId.set(box.id, box);
  }

  addStaticBox(
    id: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    blocksSight = true,
  ): AABB {
    const box: AABB = {
      id,
      minX: cx - sx * 0.5,
      maxX: cx + sx * 0.5,
      minY: cy - sy * 0.5,
      maxY: cy + sy * 0.5,
      minZ: cz - sz * 0.5,
      maxZ: cz + sz * 0.5,
      active: true,
      blocksSight,
    };
    this.addBox(box);
    return box;
  }

  setColliderActive(id: string, active: boolean): void {
    const c = this.byId.get(id);
    if (c) {
      c.active = active;
    }
  }

  getCollider(id: string): AABB | undefined {
    return this.byId.get(id);
  }

  getAllColliders(): readonly AABB[] {
    return this.colliders;
  }

  clear(): void {
    this.colliders = [];
    this.byId.clear();
  }

  /**
   * Resolves horizontal player movement against active AABBs using separated X/Z axis sliding
   * and circle-vs-AABB pushout so the player smoothly slides along walls and cover without snagging.
   */
  resolveCylinderMove(
    current: Vec3,
    targetX: number,
    targetZ: number,
    radius: number,
    feetY: number,
    height: number,
  ): { x: number; z: number; collided: boolean } {
    const totalDx = targetX - current.x;
    const totalDz = targetZ - current.z;
    const totalDist = Math.hypot(totalDx, totalDz);
    const maxStep = Math.max(0.2, radius * 0.55);
    const steps = Math.max(1, Math.ceil(totalDist / maxStep));

    let curX = current.x;
    let curZ = current.z;
    let anyCollided = false;

    for (let s = 1; s <= steps; s++) {
      const nextTargetX = curX + totalDx / steps;
      const nextTargetZ = curZ + totalDz / steps;
      const stepRes = this.resolveCylinderSubstep(curX, curZ, nextTargetX, nextTargetZ, radius, feetY, height);
      curX = stepRes.x;
      curZ = stepRes.z;
      if (stepRes.collided) anyCollided = true;
    }

    return { x: curX, z: curZ, collided: anyCollided };
  }

  private resolveCylinderSubstep(
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number,
    radius: number,
    feetY: number,
    height: number,
  ): { x: number; z: number; collided: boolean } {
    let x = targetX;
    let z = startZ;
    let collided = false;
    const topY = feetY + height;

    // Resolve X movement first
    for (const box of this.colliders) {
      if (!box.active || box.isFloor) continue;
      if (topY <= box.minY + 0.05 || feetY >= box.maxY - 0.05) continue;

      if (this.circleIntersectsAABB(x, z, radius, box)) {
        collided = true;
        if (x > startX) {
          x = Math.min(x, box.minX - radius - 0.001);
        } else if (x < startX) {
          x = Math.max(x, box.maxX + radius + 0.001);
        } else {
          // Already overlapping, push along nearest X face
          const dMin = Math.abs(x - (box.minX - radius));
          const dMax = Math.abs(x - (box.maxX + radius));
          x = dMin < dMax ? box.minX - radius - 0.001 : box.maxX + radius + 0.001;
        }
      }
    }

    // Resolve Z movement
    z = targetZ;
    for (const box of this.colliders) {
      if (!box.active || box.isFloor) continue;
      if (topY <= box.minY + 0.05 || feetY >= box.maxY - 0.05) continue;

      if (this.circleIntersectsAABB(x, z, radius, box)) {
        collided = true;
        if (z > startZ) {
          z = Math.min(z, box.minZ - radius - 0.001);
        } else if (z < startZ) {
          z = Math.max(z, box.maxZ + radius + 0.001);
        } else {
          const dMin = Math.abs(z - (box.minZ - radius));
          const dMax = Math.abs(z - (box.maxZ + radius));
          z = dMin < dMax ? box.minZ - radius - 0.001 : box.maxZ + radius + 0.001;
        }
      }
    }

    // Final iterative depenetration pass for corner cases
    for (let iter = 0; iter < 2; iter++) {
      for (const box of this.colliders) {
        if (!box.active || box.isFloor) continue;
        if (topY <= box.minY + 0.05 || feetY >= box.maxY - 0.05) continue;

        const closestX = Math.max(box.minX, Math.min(x, box.maxX));
        const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
        const dx = x - closestX;
        const dz = z - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          collided = true;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            const overlap = radius - dist + 0.001;
            x += (dx / dist) * overlap;
            z += (dz / dist) * overlap;
          } else {
            // Center is inside box; push to nearest edge
            const penLeft = Math.abs(x - box.minX);
            const penRight = Math.abs(box.maxX - x);
            const penNear = Math.abs(z - box.minZ);
            const penFar = Math.abs(box.maxZ - z);
            const minPen = Math.min(penLeft, penRight, penNear, penFar);
            if (minPen === penLeft) x = box.minX - radius - 0.001;
            else if (minPen === penRight) x = box.maxX + radius + 0.001;
            else if (minPen === penNear) z = box.minZ - radius - 0.001;
            else z = box.maxZ + radius + 0.001;
          }
        }
      }
    }

    return { x, z, collided };
  }

  circleIntersectsAABB(cx: number, cz: number, radius: number, box: AABB): boolean {
    const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * Slab-method raycast against active colliders.
   */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number, sightOnly = false): RayHit {
    let closestT = maxDistance;
    let hitId: string | null = null;

    const invX = Math.abs(dir.x) > 1e-8 ? 1 / dir.x : Number.POSITIVE_INFINITY;
    const invY = Math.abs(dir.y) > 1e-8 ? 1 / dir.y : Number.POSITIVE_INFINITY;
    const invZ = Math.abs(dir.z) > 1e-8 ? 1 / dir.z : Number.POSITIVE_INFINITY;

    for (const box of this.colliders) {
      if (!box.active) continue;
      if (sightOnly && box.blocksSight === false) continue;

      const t1 = (box.minX - origin.x) * invX;
      const t2 = (box.maxX - origin.x) * invX;
      const t3 = (box.minY - origin.y) * invY;
      const t4 = (box.maxY - origin.y) * invY;
      const t5 = (box.minZ - origin.z) * invZ;
      const t6 = (box.maxZ - origin.z) * invZ;

      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));

      if (tmax < 0 || tmin > tmax) continue;

      const t = tmin >= 0 ? tmin : tmax;
      if (t >= 0 && t < closestT) {
        closestT = t;
        hitId = box.id;
      }
    }

    return {
      hit: hitId !== null,
      distance: closestT,
      colliderId: hitId,
      point: {
        x: origin.x + dir.x * closestT,
        y: origin.y + dir.y * closestT,
        z: origin.z + dir.z * closestT,
      },
    };
  }

  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;

    const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
    const result = this.raycast(from, dir, dist - 0.15, true);
    return !result.hit;
  }
}
