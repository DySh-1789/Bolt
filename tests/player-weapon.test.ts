import { describe, expect, it } from 'vitest';
import { PlayerState } from '../src/game/Player';
import { WeaponState } from '../src/game/WeaponSystem';

describe('PlayerState', () => {
  it('absorbs partial damage with armor and restores HP with MaxDoc', () => {
    const player = new PlayerState();
    const hit = player.takeDamage(40);

    expect(hit.died).toBe(false);
    expect(player.armor).toBeCloseTo(28, 3); // 50 - 22
    expect(player.hp).toBeCloseTo(82, 3); // 100 - 18

    const healed = player.useMaxDoc();
    expect(healed).toBe(true);
    expect(player.maxDocCharges).toBe(2);
    expect(player.hp).toBe(100);
    expect(player.armor).toBeCloseTo(43, 3);
  });

  it('activates, slows world time, drains, and recharges Sandevistan', () => {
    const player = new PlayerState();
    expect(player.getWorldTimeScale()).toBe(1.0);

    const toggled = player.toggleSandevistan();
    expect(toggled.changed).toBe(true);
    expect(toggled.active).toBe(true);
    expect(player.getWorldTimeScale()).toBeCloseTo(0.28, 3);

    // Drain to empty over 4.1 seconds
    const ended = player.updateTimers(4.1);
    expect(ended.sandevistanEnded).toBe(true);
    expect(player.sandevistanActive).toBe(false);
    expect(player.sandevistanEnergy).toBe(0);
    expect(player.getWorldTimeScale()).toBe(1.0);

    // Recharge back above threshold
    player.updateTimers(3.0);
    expect(player.sandevistanEnergy).toBeGreaterThanOrEqual(25);
  });

  it('respects non-lethal damage floor when scripted survival is required', () => {
    const player = new PlayerState();
    player.armor = 0;
    const hit = player.takeDamage(150, false);
    expect(hit.died).toBe(false);
    expect(player.hp).toBe(1);
  });
});

describe('WeaponState (Malorian S-3516)', () => {
  it('consumes 8-round magazine, auto-reloads on empty, and restores rounds after reloadDuration', () => {
    const weapon = new WeaponState();
    expect(weapon.ammo).toBe(8);

    for (let i = 0; i < 8; i++) {
      expect(weapon.tryFire()).toBe(true);
      weapon.update(weapon.fireInterval + 0.01);
    }

    expect(weapon.ammo).toBe(0);
    expect(weapon.reloading).toBe(true);
    expect(weapon.tryFire()).toBe(false);

    const finish = weapon.update(weapon.reloadDuration + 0.05);
    expect(finish.reloadCompleted).toBe(true);
    expect(weapon.reloading).toBe(false);
    expect(weapon.ammo).toBe(8);
  });

  it('enforces flame melee cooldown', () => {
    const weapon = new WeaponState();
    expect(weapon.tryMelee()).toBe(true);
    expect(weapon.tryMelee()).toBe(false);

    weapon.update(weapon.meleeInterval + 0.05);
    expect(weapon.tryMelee()).toBe(true);
  });
});
