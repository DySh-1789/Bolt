import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ACT_ORDER, StoryStateMachine } from '../src/game/StoryDirector';
import { LevSmasherBoss, LevSmasherState } from '../src/game/LevSmasherBoss';
import { EnemyManager } from '../src/game/EnemyManager';
import { PhysicsWorld } from '../src/engine/Physics';

describe('StoryStateMachine', () => {
  it('progresses through all narrative acts from TITLE to SOULKILLER and CREDITS', () => {
    const sm = new StoryStateMachine();
    expect(sm.act).toBe('TITLE');

    for (const act of ACT_ORDER.slice(1)) {
      sm.transitionTo(act);
    }

    expect(sm.act).toBe('CREDITS');
    expect(sm.history).toEqual(ACT_ORDER);
  });

  it('tracks combat accuracy, headshots, kills, and boss damage accurately', () => {
    const sm = new StoryStateMachine();
    sm.recordShot(true, true);
    sm.recordShot(true, false);
    sm.recordShot(false, false);
    sm.recordShot(true, true);
    sm.recordKill();
    sm.recordBossDamage(320);

    expect(sm.stats.shotsFired).toBe(4);
    expect(sm.stats.shotsHit).toBe(3);
    expect(sm.stats.headshots).toBe(2);
    expect(sm.getAccuracyPercent()).toBe(75);
    expect(sm.stats.enemiesEliminated).toBe(1);
    expect(sm.stats.damageDealtToSmasher).toBe(320);
  });
});

describe('LevSmasherState', () => {
  it('transitions from Phase 1 to Phase 2 at 60% HP and triggers scripted defeat finisher at 20% HP', () => {
    const boss = new LevSmasherState();
    boss.startPhase1();
    expect(boss.phase).toBe('PHASE_1');

    // Deal 400 damage (900 -> 500 = 55.5% HP -> enters Phase 2)
    const r1 = boss.applyDamage(400);
    expect(r1.enteredPhase2).toBe(true);
    expect(r1.triggeredFinisher).toBe(false);
    expect(boss.phase).toBe('PHASE_2');

    // Deal massive damage (500 -> clamped at 180 = 20% HP -> triggers scripted defeat of Samir!)
    const r2 = boss.applyDamage(600);
    expect(r2.triggeredFinisher).toBe(true);
    expect(boss.phase).toBe('FINISHER');
    expect(boss.hp).toBeCloseTo(180, 3);
  });

  it('triggers scripted defeat finisher if Samir drops to critical HP (<= 10) during Phase 2', () => {
    const boss = new LevSmasherState();
    boss.startPhase1();

    // Does NOT trigger during Phase 1
    expect(boss.shouldTriggerFinisherFromPlayerLowHp(8)).toBe(false);

    // Push into Phase 2
    boss.applyDamage(380);
    expect(boss.phase).toBe('PHASE_2');

    // Critical player HP now triggers the narrative heavy-wounding cutscene
    expect(boss.shouldTriggerFinisherFromPlayerLowHp(9)).toBe(true);
    expect(boss.phase).toBe('FINISHER');
  });
});

describe('LevSmasherBoss & EnemyManager integration', () => {
  it('does not crash when Phase 2 finisher clears active projectiles/missiles mid-update', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const boss = new LevSmasherBoss(scene, physics);

    boss.beginCombat(0, -120, 44);
    boss.state.applyDamage(400); // Enter PHASE_2
    expect(boss.state.phase).toBe('PHASE_2');

    const playerPos = { x: 0, y: 44, z: -115 };
    const playerEye = { x: 0, y: 45.68, z: -115 };
    let finisherTriggered = false;

    // Step combat enough frames for bursts/missiles to fire and hit player
    expect(() => {
      for (let i = 0; i < 160; i++) {
        if (boss.state.phase === 'FINISHER') break;
        boss.updateCombat(0.05, playerPos, playerEye, {
          onAutocannonShot: () => {},
          onMissileExplode: () => {},
          onRoar: () => {},
          onPlayerDamaged: () => {
            if (boss.state.shouldTriggerFinisherFromPlayerLowHp(5)) {
              finisherTriggered = true;
              boss.positionForFinisher(playerPos, 0);
            }
          },
        });
      }
    }).not.toThrow();

    expect(finisherTriggered).toBe(true);
    expect(boss.state.phase).toBe('FINISHER');
    boss.dispose();
  });

  it('allows Lev Smasher attacks to damage and eliminate surviving Council Hall enemies', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const enemies = new EnemyManager(scene, physics);

    enemies.spawnWave([
      { archetype: 'guard', x: 0, z: -120, floorY: 44 },
      { archetype: 'drone', x: 1.5, z: -120, floorY: 44 },
    ]);
    expect(enemies.getAliveCount()).toBe(2);

    let kills = 0;
    const hitByBolt = enemies.checkBossProjectileHit(
      { x: 0, y: 45.2, z: -124 },
      { x: 0, y: 45.2, z: -118 },
      90,
      () => kills++,
    );
    expect(hitByBolt).toBe(true);
    expect(kills).toBe(1);
    expect(enemies.getAliveCount()).toBe(1);

    const areaHits = enemies.applyAreaDamage(
      { x: 1.5, y: 45.0, z: -120 },
      3.0,
      90,
      () => kills++,
      true,
    );
    expect(areaHits).toBe(1);
    expect(kills).toBe(2);
    expect(enemies.getAliveCount()).toBe(0);
    enemies.dispose();
  });
});
