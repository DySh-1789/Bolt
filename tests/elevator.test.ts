import { describe, expect, it } from 'vitest';
import { ElevatorState } from '../src/game/ElevatorSystem';

describe('ElevatorState', () => {
  it('stays locked until unlocked, then transitions READY -> CLOSING -> MOVING -> ARRIVED', () => {
    const elev = new ElevatorState(0, 22, 1, 42, 4.0);
    expect(elev.status).toBe('LOCKED');
    expect(elev.startRide()).toBe(false);

    elev.unlock();
    expect(elev.status).toBe('READY');
    expect(elev.startRide()).toBe(true);
    expect(elev.status).toBe('CLOSING');

    // Finish closing doors
    const startMove = elev.update(elev.closeDuration + 0.01);
    expect(startMove.beganMoving).toBe(true);
    expect(elev.status).toBe('MOVING');

    // Mid-ride ascent
    let floorChanges = 0;
    for (let i = 0; i < 20; i++) {
      const step = elev.update(0.1);
      if (step.floorChanged) floorChanges++;
    }
    expect(elev.currentY).toBeGreaterThan(5);
    expect(elev.currentY).toBeLessThan(22);
    expect(elev.currentFloor).toBeGreaterThan(1);
    expect(elev.currentFloor).toBeLessThan(42);
    expect(floorChanges).toBeGreaterThan(5);

    // Finish ride
    const finish = elev.update(2.5);
    expect(finish.arrived).toBe(true);
    expect(elev.status).toBe('ARRIVED');
    expect(elev.currentY).toBe(22);
    expect(elev.currentFloor).toBe(42);
  });

  it('supports checkpoint snapToTop and clean reset', () => {
    const elev = new ElevatorState(22, 44, 42, 95, 4.5);
    elev.snapToTop();
    expect(elev.status).toBe('ARRIVED');
    expect(elev.currentY).toBe(44);
    expect(elev.currentFloor).toBe(95);

    elev.reset();
    expect(elev.status).toBe('LOCKED');
    expect(elev.currentY).toBe(22);
    expect(elev.currentFloor).toBe(42);
  });
});
