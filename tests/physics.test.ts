import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/engine/Physics';

describe('PhysicsWorld', () => {
  it('blocks player movement into solid walls while allowing sliding along parallel axis', () => {
    const world = new PhysicsWorld();
    // Solid north wall at z = -10 spanning x = [-10, 10]
    world.addStaticBox('north_wall', 0, 2, -10.5, 20, 4, 1);

    const resolved = world.resolveCylinderMove(
      { x: 0, y: 0, z: -9.2 },
      3.5,
      -10.2,
      0.45,
      0,
      1.8,
    );

    expect(resolved.collided).toBe(true);
    expect(resolved.x).toBeCloseTo(3.5, 3);
    expect(resolved.z).toBeGreaterThanOrEqual(-9.55);
  });

  it('toggles dynamic door colliders cleanly', () => {
    const world = new PhysicsWorld();
    world.addStaticBox('door_atrium', 0, 2.5, -28, 7, 5, 0.8);

    // Door closed -> blocks movement across z = -28
    const blocked = world.resolveCylinderMove(
      { x: 0, y: 0, z: -26.8 },
      0,
      -29,
      0.45,
      0,
      1.8,
    );
    expect(blocked.collided).toBe(true);
    expect(blocked.z).toBeGreaterThan(-28);

    // Open door -> player walks straight through
    world.setColliderActive('door_atrium', false);
    const passed = world.resolveCylinderMove(
      { x: 0, y: 0, z: -26.8 },
      0,
      -29,
      0.45,
      0,
      1.8,
    );
    expect(passed.collided).toBe(false);
    expect(passed.z).toBeCloseTo(-29, 3);
  });

  it('computes line-of-sight accurately with opaque walls and transparent cover', () => {
    const world = new PhysicsWorld();
    world.addStaticBox('pillar', 0, 2, 0, 2, 4, 2, true);
    world.addStaticBox('laser_field', 0, 2, -6, 6, 4, 0.5, false);

    // Blocked by solid pillar
    expect(world.hasLineOfSight({ x: 0, y: 1.5, z: 5 }, { x: 0, y: 1.5, z: -4 })).toBe(false);

    // Clear around pillar
    expect(world.hasLineOfSight({ x: 4, y: 1.5, z: 5 }, { x: 4, y: 1.5, z: -4 })).toBe(true);

    // Laser field does not block sight
    expect(world.hasLineOfSight({ x: 0, y: 1.5, z: -4 }, { x: 0, y: 1.5, z: -9 })).toBe(true);
  });

  it('blocks bullets on waist-high cover while allowing bullets through laser barriers', () => {
    const world = new PhysicsWorld();
    world.addStaticBox('waist_cover', 0, 0.65, -5, 4, 1.3, 1, false, true);
    world.addStaticBox('laser_field', 0, 2.5, -10, 6, 5, 0.5, false, false);

    // Line-of-sight passes over waist-high cover
    expect(world.hasLineOfSight({ x: 0, y: 1.0, z: 0 }, { x: 0, y: 1.0, z: -8 })).toBe(true);

    // Bullets are blocked by waist-high cover
    const coverHit = world.raycastBullets({ x: 0, y: 1.0, z: 0 }, { x: 0, y: 0, z: -1 }, 20);
    expect(coverHit.hit).toBe(true);
    expect(coverHit.colliderId).toBe('waist_cover');

    // Bullets pass through laser barrier when firing above waist-high cover
    const laserShot = world.raycastBullets({ x: 0, y: 2.0, z: 0 }, { x: 0, y: 0, z: -1 }, 20);
    expect(laserShot.hit).toBe(false);
  });

  it('handles axis-aligned raycasts lying on a collider face without NaN', () => {
    const world = new PhysicsWorld();
    world.addStaticBox('wall', 0, 2, -10, 10, 4, 1); // minY = 0, maxY = 4

    const hit = world.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(hit.hit).toBe(true);
    expect(hit.colliderId).toBe('wall');
    expect(Number.isNaN(hit.distance)).toBe(false);
    expect(hit.distance).toBeCloseTo(9.5, 3);
  });

  it('provides cover landing support and pushes overlaps out along the shortest axis', () => {
    const world = new PhysicsWorld();
    world.addStaticBox('wide_desk', 0, 0.65, -5, 4.4, 1.3, 1.1, false, true);

    // Feet near top of desk -> lands on top at y = 1.3
    expect(world.getSupportY(0, -5, 0.45, 1.28, 0)).toBeCloseTo(1.3, 3);
    // Feet on floor -> does not snap up onto 1.3m desk
    expect(world.getSupportY(0, -5, 0.45, 0, 0)).toBe(0);

    // Pre-existing overlap inside wide desk pushes out along shorter Z axis, not 2.6m sideways along X
    const pushed = world.resolveCylinderMove({ x: 0, y: 0, z: -4.7 }, 0, -4.7, 0.45, 0, 1.8);
    expect(pushed.collided).toBe(true);
    expect(Math.abs(pushed.x)).toBeLessThan(0.1);
    expect(pushed.z).toBeGreaterThanOrEqual(-4.0);
  });
});
