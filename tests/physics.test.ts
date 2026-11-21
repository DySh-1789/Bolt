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
});
