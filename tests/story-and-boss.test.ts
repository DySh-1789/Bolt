import { describe, expect, it } from 'vitest';
import { ACT_ORDER, StoryStateMachine } from '../src/game/StoryDirector';
import { LevSmasherState } from '../src/game/LevSmasherBoss';

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
