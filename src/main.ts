import './ui/styles.css';
import { Engine } from './engine/Engine';
import { StoryDirector } from './game/StoryDirector';

function bootstrap(): void {
  const viewport = document.getElementById('game-viewport');
  if (!viewport) {
    throw new Error('Missing #game-viewport mount container');
  }

  const engine = new Engine(viewport);
  const director = new StoryDirector(engine, viewport);

  let lastTime = performance.now();
  let rafId = 0;

  const frame = (now: number): void => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    director.update(dt);
    rafId = window.requestAnimationFrame(frame);
  };

  rafId = window.requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(rafId);
    director.dispose();
    engine.dispose();
  });
}

bootstrap();
