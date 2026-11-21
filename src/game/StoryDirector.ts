import * as THREE from 'three';
import {
  createDefaultPostFx,
  createInitialRunStats,
  type CheckpointData,
  type DialogueChoice,
  type GameAct,
  type PostFxState,
  type RunStats,
  type SpeakerId,
  type SubtitleEvent,
} from '../types/game';
import type { Engine } from '../engine/Engine';
import { PhysicsWorld } from '../engine/Physics';
import { ProceduralTextures } from '../engine/ProceduralTextures';
import { AudioEngine } from '../engine/AudioEngine';
import { InputManager } from '../engine/InputManager';
import { PlayerController } from './Player';
import { WeaponSystem } from './WeaponSystem';
import {
  FLOOR_ATRIUM_Y,
  FLOOR_COUNCIL_Y,
  FLOOR_SERVER_Y,
  LevelBuilder,
} from './LevelBuilder';
import { EnemyManager } from './EnemyManager';
import { LevSmasherBoss } from './LevSmasherBoss';
import { OperatingTableScene } from './OperatingTableScene';
import { HUD } from '../ui/HUD';

export const ACT_ORDER: readonly GameAct[] = [
  'TITLE',
  'INTRO',
  'ATRIUM',
  'SERVER_ROOM',
  'COUNCIL_HALL',
  'BOSS_KNOCKBACK',
  'BOSS_FIGHT',
  'SAMIR_DEFEATED',
  'OPERATING_TABLE',
  'SOULKILLER',
  'CREDITS',
] as const;

/**
 * Pure narrative progression tracker (decoupled from Three.js/DOM for deterministic unit testing).
 */
export class StoryStateMachine {
  act: GameAct = 'TITLE';
  stats: RunStats = createInitialRunStats();
  history: GameAct[] = ['TITLE'];

  reset(): void {
    this.act = 'TITLE';
    this.stats = createInitialRunStats();
    this.history = ['TITLE'];
  }

  transitionTo(next: GameAct): void {
    if (this.act === next) return;
    this.act = next;
    this.history.push(next);
  }

  recordShot(hit: boolean, headshot: boolean): void {
    this.stats.shotsFired++;
    if (hit) this.stats.shotsHit++;
    if (headshot) this.stats.headshots++;
  }

  recordKill(): void {
    this.stats.enemiesEliminated++;
  }

  recordBossDamage(dmg: number): void {
    this.stats.damageDealtToSmasher += Math.max(0, dmg);
  }

  recordDeath(): void {
    this.stats.deaths++;
  }

  getAccuracyPercent(): number {
    if (this.stats.shotsFired === 0) return 0;
    return Math.round((this.stats.shotsHit / this.stats.shotsFired) * 100);
  }
}

const FINALE_CHOICES: DialogueChoice[] = [
  { id: 'defiant', key: '1', text: '«Гори в аду, Родион. Я ещё выжгу Маракулин Тавер дотла.»' },
  { id: 'taunt', key: '2', text: '«Ты жалкий трус, корпорат. Прятался за спиной Смэшера.»' },
];

export class StoryDirector {
  readonly story = new StoryStateMachine();
  readonly fx: PostFxState = createDefaultPostFx();

  private engine: Engine;
  private physics: PhysicsWorld;
  private textures: ProceduralTextures;
  private audio: AudioEngine;
  private input: InputManager;
  private player: PlayerController;
  private weapon: WeaponSystem;
  private level: LevelBuilder;
  private enemies: EnemyManager;
  private boss: LevSmasherBoss;
  private operatingScene: OperatingTableScene;
  private hud: HUD;

  private paused = false;
  private dead = false;
  private totalTime = 0;
  private actTimer = 0;

  // Sector progression flags
  private atriumCleared = false;
  private serverCleared = false;
  private laserHacked = false;
  private councilCleared = false;
  private knockbackSlamTriggered = false;

  // Operating table dialogue substates
  private tableStage: 'WAKING' | 'MONOLOGUE_1' | 'MONOLOGUE_2' | 'AWAITING_CHOICE' | 'RESPONSE' = 'WAKING';
  private tableStageTimer = 0;
  private soulkillerTimer = 0;
  private readonly soulkillerDuration = 6.6;

  private subtitleQueue: SubtitleEvent[] = [];
  private subtitleCooldown = 0;

  private checkpoint: CheckpointData = { act: 'ATRIUM', x: 0, y: 0, z: 14, yaw: 0 };

  constructor(engine: Engine, viewportEl: HTMLElement) {
    this.engine = engine;
    this.physics = new PhysicsWorld();
    this.textures = new ProceduralTextures();
    this.audio = new AudioEngine();
    this.player = new PlayerController(engine.camera);
    this.weapon = new WeaponSystem(engine.scene, engine.camera);
    this.level = new LevelBuilder(engine.scene, this.physics, this.textures);
    this.level.build();
    this.enemies = new EnemyManager(engine.scene, this.physics);
    this.boss = new LevSmasherBoss(engine.scene, this.physics);
    this.operatingScene = new OperatingTableScene(engine.scene, this.textures);

    this.input = new InputManager(viewportEl, {
      onLockChange: (locked) => this.handlePointerLockChange(locked),
      onEscapePressed: () => this.handleEscape(),
      onViewportClick: () => this.handleViewportClick(),
    });

    this.hud = new HUD({
      onStartGame: () => this.startNewGame(),
      onResumeGame: () => this.resumeGame(),
      onRestartGame: () => this.startNewGame(),
      onRetryCheckpoint: () => this.respawnAtCheckpoint(),
      onSensitivityChange: (v) => this.input.setSensitivity(v),
      onVolumeChange: (v) => this.audio.setVolume(v),
      onDialogueChoiceSelected: (id) => this.handleFinaleChoice(id),
    });

    this.enterTitle();
  }

  private handleViewportClick(): void {
    if (this.paused || this.dead) return;
    if (this.story.act === 'TITLE' || this.story.act === 'CREDITS') return;
    if (this.story.act === 'OPERATING_TABLE' && this.tableStage === 'AWAITING_CHOICE') return;
    if (this.story.act === 'SOULKILLER') return;
    this.input.requestPointerLock();
  }

  private handlePointerLockChange(locked: boolean): void {
    const playableAct =
      this.story.act === 'ATRIUM' ||
      this.story.act === 'SERVER_ROOM' ||
      this.story.act === 'COUNCIL_HALL' ||
      this.story.act === 'BOSS_FIGHT';
    if (!locked && playableAct && !this.paused && !this.dead) {
      this.pauseGame();
    }
  }

  private handleEscape(): void {
    if (this.story.act === 'TITLE' || this.story.act === 'CREDITS' || this.dead) return;
    if (this.paused) {
      this.resumeGame();
    } else {
      this.pauseGame();
    }
  }

  private pauseGame(): void {
    this.paused = true;
    this.audio.setPaused(true);
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.hud.showScreen('pause');
  }

  private resumeGame(): void {
    this.paused = false;
    this.audio.setPaused(false);
    this.input.clearTransient();
    this.hud.showScreen('playing');
    if (
      this.story.act !== 'SOULKILLER' &&
      !(this.story.act === 'OPERATING_TABLE' && this.tableStage === 'AWAITING_CHOICE')
    ) {
      this.input.requestPointerLock();
    }
  }

  private queueLine(
    speaker: SpeakerId,
    text: string,
    duration = 4.0,
    immediate = false,
  ): void {
    const names: Record<SpeakerId, { name: string; role: string }> = {
      samir: { name: 'САМИР', role: 'НАЁМНИК // ШТУРМ БАШНИ' },
      rodion: { name: 'РОДИОН', role: 'MARAKULIN CORP // ГЛАВА СОВЕТА' },
      smasher: { name: 'ЛЕВ СМЭШЕР', role: 'ОХРАННЫЙ КИБОРГ // КЛАСС S' },
      system: { name: 'MARAKULIN OS', role: 'СИСТЕМА БЕЗОПАСНОСТИ БАШНИ' },
    };
    const evt: SubtitleEvent = {
      speaker,
      speakerName: names[speaker].name,
      role: names[speaker].role,
      text,
      duration,
    };
    if (immediate) {
      this.subtitleQueue = [];
      this.subtitleCooldown = duration;
      this.hud.showSubtitle(evt);
      this.audio.playHoloChime();
    } else {
      this.subtitleQueue.push(evt);
    }
  }

  private enterTitle(): void {
    this.story.reset();
    this.paused = false;
    this.dead = false;
    this.audio.setPaused(false);
    this.audio.setSandevistanMode(false);
    this.input.clearTransient();
    this.weapon.resetVisuals();
    this.weapon.setVisible(false);
    this.boss.hide();
    this.operatingScene.deactivate();
    this.enemies.clearAll();
    this.level.resetInteractiveState();
    this.hud.showScreen('title');
    this.hud.setBossBar(false);
    this.hud.setSoulkillerProgress(false);
    this.hud.setTraumaBanner(false);
    this.hud.clearSubtitle();
    Object.assign(this.fx, createDefaultPostFx());
  }

  startNewGame(): void {
    this.audio.unlock();
    this.audio.setPaused(false);
    this.audio.setSandevistanMode(false);
    this.story.reset();
    this.paused = false;
    this.dead = false;

    this.atriumCleared = false;
    this.serverCleared = false;
    this.laserHacked = false;
    this.councilCleared = false;
    this.knockbackSlamTriggered = false;

    this.subtitleQueue = [];
    this.subtitleCooldown = 0;
    Object.assign(this.fx, createDefaultPostFx());
    this.input.clearTransient();

    this.enemies.clearAll();
    this.boss.hide();
    this.operatingScene.deactivate();
    this.weapon.clearDroppedWeapon();
    this.weapon.resetVisuals();
    this.level.resetInteractiveState();
    this.engine.setFogDensity(0.01, 0x0c1224);

    this.player.state.resetFull();
    this.weapon.state.reset();
    this.weapon.setVisible(true);
    this.player.teleport(0, 0, 14, 0, 0);
    this.player.setMode('INTRO');

    this.hud.showScreen('playing');
    this.hud.setCombatHudVisible(true);
    this.hud.setBossBar(false);
    this.hud.setSoulkillerProgress(false);
    this.hud.setTraumaBanner(false);
    this.hud.setOverheatProgress(0);
    this.hud.hideDialogueChoices();
    this.hud.clearSubtitle();

    this.input.requestPointerLock();
    this.enterIntro();
  }

  private enterIntro(): void {
    this.story.transitionTo('INTRO');
    this.actTimer = 0;
    this.weapon.playIntroSpin();
    this.audio.setMusicIntensity('ambient');
    this.hud.setQuest('Войти в Главный Атриум Маракулин Тавер', 'СЕКТОР 01 // ВХОД');

    this.queueLine('samir', 'Маракулин Тавер... Пора свести счёты с Родионом.', 3.1, true);
    this.queueLine(
      'rodion',
      'Самир? Решил штурмовать мою башню в одиночку? Охрана — огонь на поражение!',
      4.4,
    );
  }

  private enterAtrium(): void {
    this.story.transitionTo('ATRIUM');
    this.actTimer = 0;
    this.player.setMode('FREE');
    this.checkpoint = { act: 'ATRIUM', x: 0, y: FLOOR_ATRIUM_Y, z: 14, yaw: 0 };
    this.audio.setMusicIntensity('combat');
    this.hud.setQuest('Уничтожить корпо-охрану в Атриуме', 'ЭТАЖ 01 // ГЛАВНЫЙ АТРИУМ');

    this.enemies.clearAll();
    this.enemies.spawnWave([
      { archetype: 'guard', x: -7, z: -2, floorY: FLOOR_ATRIUM_Y },
      { archetype: 'guard', x: 7, z: -2, floorY: FLOOR_ATRIUM_Y },
      { archetype: 'guard', x: -4.5, z: -14, floorY: FLOOR_ATRIUM_Y },
      { archetype: 'guard', x: 4.5, z: -14, floorY: FLOOR_ATRIUM_Y },
      { archetype: 'drone', x: 0, z: -11, floorY: FLOOR_ATRIUM_Y },
      { archetype: 'drone', x: -9, z: -18, floorY: FLOOR_ATRIUM_Y },
    ]);
  }

  private enterServerRoom(): void {
    this.story.transitionTo('SERVER_ROOM');
    this.actTimer = 0;
    this.checkpoint = { act: 'SERVER_ROOM', x: 0, y: FLOOR_SERVER_Y, z: -40, yaw: 0 };
    this.audio.setMusicIntensity('combat');
    this.hud.setQuest('Зачистить Серверный узел и найти терминал', 'ЭТАЖ 42 // КИБЕРБЕЗОПАСНОСТЬ');

    this.queueLine('system', 'ТРЕВОГА: Вторжение на 42-й этаж. Активированы турели и нетраннеры.', 3.8, true);
    this.queueLine('samir', 'Нетраннеры... Надо сбивать их взлом, пока импланты не сгорели.', 3.6);

    this.enemies.clearAll();
    this.enemies.spawnWave([
      { archetype: 'guard', x: -6, z: -50, floorY: FLOOR_SERVER_Y },
      { archetype: 'guard', x: 6, z: -52, floorY: FLOOR_SERVER_Y },
      { archetype: 'netrunner', x: 0, z: -62, floorY: FLOOR_SERVER_Y },
      { archetype: 'turret', x: -9, z: -63, floorY: FLOOR_SERVER_Y },
      { archetype: 'turret', x: 9, z: -63, floorY: FLOOR_SERVER_Y },
      { archetype: 'drone', x: 0, z: -54, floorY: FLOOR_SERVER_Y },
      { archetype: 'heavy', x: 0, z: -72, floorY: FLOOR_SERVER_Y },
    ]);
  }

  private enterCouncilHall(): void {
    this.story.transitionTo('COUNCIL_HALL');
    this.actTimer = 0;
    this.checkpoint = { act: 'COUNCIL_HALL', x: 0, y: FLOOR_COUNCIL_Y, z: -92, yaw: 0 };
    this.audio.setMusicIntensity('combat');
    this.hud.setQuest('Прорваться к дверям Зала Совета Родиона', 'ЭТАЖ 95 // ПЕНТХАУС СОВЕТА');

    this.queueLine('rodion', 'Добро пожаловать на 95-й этаж, Самир. Ты дошёл почти до вершины — но дальше стена.', 4.4, true);

    this.enemies.clearAll();
    this.enemies.spawnWave([
      { archetype: 'heavy', x: -6, z: -108, floorY: FLOOR_COUNCIL_Y },
      { archetype: 'heavy', x: 6, z: -108, floorY: FLOOR_COUNCIL_Y },
      { archetype: 'netrunner', x: 0, z: -122, floorY: FLOOR_COUNCIL_Y },
      { archetype: 'guard', x: -11, z: -124, floorY: FLOOR_COUNCIL_Y },
      { archetype: 'guard', x: 11, z: -124, floorY: FLOOR_COUNCIL_Y },
      { archetype: 'drone', x: 0, z: -114, floorY: FLOOR_COUNCIL_Y },
    ]);
  }

  private enterBossKnockback(): void {
    this.story.transitionTo('BOSS_KNOCKBACK');
    this.actTimer = 0;
    this.knockbackSlamTriggered = false;

    // Lock movement during the brief ambush reveal before Smasher's slam
    this.player.setMode('INTRO');

    // Seal elevator exit behind Samir and turn Council Doors crimson!
    this.level.setDoorOpen('door_elev2_top', false, false);
    this.level.setCouncilDoorAlert(true);
    this.audio.setMusicIntensity('boss');
    this.audio.playSmasherRoar();

    // Lev Smasher bursts directly in front of Rodion's doors on Floor 95!
    this.boss.appearForKnockback(0, -135.5, FLOOR_COUNCIL_Y);
    this.fx.glitch = 0.85;
    this.fx.chromaticBoost = 0.7;
    this.player.addShake(0.95);
    this.hud.setQuest('ЗАСАДА ПЕРЕД ЗАЛОМ РОДИОНА!', 'ЭТАЖ 95 // КРИТИЧЕСКАЯ УГРОЗА');

    this.queueLine(
      'smasher',
      'Куда собрался, Самир?! Думал дойти до Родиона?! Ты — кусок хрома на убой!',
      4.2,
      true,
    );
  }

  private enterBossFight(): void {
    this.story.transitionTo('BOSS_FIGHT');
    this.actTimer = 0;
    this.player.setMode('FREE');
    this.checkpoint = { act: 'BOSS_FIGHT', x: 0, y: FLOOR_COUNCIL_Y, z: -113, yaw: 0 };

    this.boss.beginCombat(0, -133, FLOOR_COUNCIL_Y);
    this.hud.setBossBar(true, 1.0, 'ФАЗА I // АВТОПУШКА И МИКРОРАКЕТЫ');
    this.hud.setQuest('Сразиться со Львом Смэшером', 'БОСС // ПЕРЕД ЗАЛОМ РОДИОНА');
    this.audio.setMusicIntensity('boss');

    this.queueLine('samir', 'Лев Смэшер... Значит, придётся пройти через тебя!', 3.2, true);
  }

  private enterSamirDefeated(): void {
    if (this.story.act === 'SAMIR_DEFEATED') return;
    this.story.transitionTo('SAMIR_DEFEATED');
    this.actTimer = 0;

    // Disable Sandevistan and take away weapon control
    this.player.state.sandevistanActive = false;
    this.audio.setSandevistanMode(false);
    this.audio.setMusicIntensity('ambient');
    this.audio.playExplosion(true);
    this.audio.playPlayerHurt(true);
    this.audio.playTinnitus(3.2);

    // Position Lev Smasher in an unobstructed spot near Samir and orient fallen camera toward him
    const smasherPos = this.boss.positionForFinisher(this.player.position, this.player.yaw);
    this.player.setMode('FALLEN');
    this.player.faceTargetInFallenMode(smasherPos.x, smasherPos.z);

    this.weapon.setVisible(false);
    this.weapon.spawnDroppedWeapon(this.player.position, this.player.yaw, this.player.groundY);

    this.player.addShake(1.3);
    this.fx.damageVignette = 0.95;
    this.fx.glitch = 1.1;

    this.hud.setBossBar(false);
    this.hud.setCombatHudVisible(false);
    this.hud.setOverheatProgress(0);
    this.hud.setInteractPrompt(null);
    this.hud.setTraumaBanner(true, 'ТЯЖЁЛОЕ РАНЕНИЕ // ПОТЕРЯ СОЗНАНИЯ...');
    this.hud.setQuest('Критическое повреждение систем', 'БИОМОНИТОР // ОТКАЗ ОПТИКИ');

    this.queueLine(
      'smasher',
      'Неплохо держался, Самир... Но Родион заказал тебя живым. Вырубайся.',
      4.5,
      true,
    );
  }

  private enterOperatingTable(): void {
    this.story.transitionTo('OPERATING_TABLE');
    this.actTimer = 0;
    this.tableStage = 'WAKING';
    this.tableStageTimer = 0;

    // Clean up tower entities and activate Sector 4 Operating Lab at Y = 100
    this.enemies.clearAll();
    this.boss.state.markFinished();
    this.boss.hide();
    this.weapon.clearDroppedWeapon();
    this.operatingScene.activate();
    this.level.updateShadowAnchor(0, 0, 0, false);

    this.engine.setFogDensity(0.018, 0x0b1322);
    this.player.setOperatingTableAnchor(0, this.operatingScene.originY + 1.68, 0.35);
    this.player.setMode('OPERATING_TABLE');
    this.weapon.setVisible(false);

    this.fx.damageVignette = 0.28;
    this.fx.glitch = 0.12;
    this.fx.blackout = 0.85;
    this.fx.eyelids = 0.95;

    this.audio.setMusicIntensity('operating');
    this.hud.setBossBar(false);
    this.hud.setCombatHudVisible(false);
    this.hud.setTraumaBanner(false);
    this.hud.setQuest('Прийти в сознание на операционном столе', 'ЛАБОРАТОРИЯ ЭНГРАММ // РОДИОН');
  }

  private handleFinaleChoice(choiceId: string): void {
    if (this.story.act !== 'OPERATING_TABLE' || this.tableStage !== 'AWAITING_CHOICE') return;
    this.hud.hideDialogueChoices();
    this.tableStage = 'RESPONSE';
    this.tableStageTimer = 0;

    const picked = FINALE_CHOICES.find((c) => c.id === choiceId) ?? FINALE_CHOICES[0];
    this.story.stats.chosenFinaleLine = picked.text;

    if (choiceId === 'defiant') {
      this.queueLine('samir', 'Гори в аду, Родион. Я ещё выжгу Маракулин Тавер дотла.', 3.2, true);
      this.queueLine(
        'rodion',
        'Огонь в глазах — именно за это я тебя и сохраню. Навсегда. Включаю «Душегуб».',
        4.3,
      );
    } else {
      this.queueLine('samir', 'Ты жалкий трус, корпорат. Прятался за спиной Льва Смэшера.', 3.2, true);
      this.queueLine(
        'rodion',
        'Умные люди используют инструменты, Самир. А теперь твоя душа станет моим новым инструментом.',
        4.5,
      );
    }
  }

  private enterSoulkiller(): void {
    this.story.transitionTo('SOULKILLER');
    this.soulkillerTimer = 0;
    this.audio.setMusicIntensity('soulkiller');
    this.audio.playSoulkillerSurge(this.soulkillerDuration);
    this.hud.setBossBar(false);
    this.hud.setSoulkillerProgress(true, 0);
    this.hud.setQuest('ПРОТОКОЛ «ДУШЕГУБ» АКТИВЕН', 'КРАЖА ДУШИ // СОЗДАНИЕ ЭНГРАММЫ');
    this.queueLine(
      'rodion',
      'Прощай, Самир. Теперь твоя душа принадлежит корпорации Маракулин.',
      4.8,
      true,
    );
  }

  private enterCredits(): void {
    this.story.transitionTo('CREDITS');
    this.input.exitPointerLock();
    this.audio.setMusicIntensity('title');
    this.hud.setBossBar(false);
    this.hud.setSoulkillerProgress(false);
    this.hud.clearSubtitle();
    this.hud.populateCredits(this.story.stats);
    this.hud.showScreen('credits');
  }

  private triggerPlayerDeath(): void {
    if (this.dead) return;
    this.dead = true;
    this.player.state.sandevistanActive = false;
    this.audio.setSandevistanMode(false);
    this.story.recordDeath();
    this.audio.playPlayerHurt(true);
    this.audio.setMusicIntensity('silent');
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.hud.showScreen('death');
  }

  private respawnAtCheckpoint(): void {
    this.dead = false;
    this.paused = false;
    this.audio.setPaused(false);
    this.audio.setSandevistanMode(false);
    this.input.clearTransient();
    this.subtitleQueue = [];
    this.subtitleCooldown = 0;
    this.hud.clearSubtitle();
    this.hud.setBossBar(false);

    Object.assign(this.fx, createDefaultPostFx());
    this.player.state.resetFull();
    this.weapon.state.reset();
    this.weapon.resetVisuals();
    this.weapon.setVisible(true);
    this.player.teleport(this.checkpoint.x, this.checkpoint.y, this.checkpoint.z, this.checkpoint.yaw, 0);
    this.player.setMode('FREE');

    this.hud.showScreen('playing');
    this.hud.setCombatHudVisible(true);
    this.hud.setOverheatProgress(0);
    this.input.requestPointerLock();

    if (this.checkpoint.act === 'ATRIUM') {
      this.atriumCleared = false;
      this.level.elev1.reset();
      this.level.setDoorOpen('door_elev1_bottom', false, true);
      this.level.setInteractableEnabled('elev1_button', false);
      this.enterAtrium();
    } else if (this.checkpoint.act === 'SERVER_ROOM') {
      this.serverCleared = false;
      this.laserHacked = false;
      this.level.elev1.snapToTop();
      this.level.setDoorOpen('door_elev1_top', true, true);
      this.level.setLaserBarrierActive(true);
      this.level.elev2.reset();
      this.level.setDoorOpen('door_elev2_bottom', false, true);
      this.level.setInteractableEnabled('terminal_hack', false);
      this.level.setInteractableEnabled('elev2_button', false);
      this.level.resetCratesByPrefix('crate_sector2');
      this.enterServerRoom();
    } else if (this.checkpoint.act === 'COUNCIL_HALL') {
      this.councilCleared = false;
      this.level.elev1.snapToTop();
      this.level.elev2.snapToTop();
      this.level.setDoorOpen('door_elev2_top', true, true);
      this.level.setCouncilDoorAlert(false);
      this.level.resetCratesByPrefix('crate_sector3');
      this.enterCouncilHall();
    } else if (this.checkpoint.act === 'BOSS_FIGHT') {
      this.enemies.clearAll();
      this.level.elev1.snapToTop();
      this.level.elev2.snapToTop();
      this.level.setDoorOpen('door_elev2_top', false, true);
      this.level.setCouncilDoorAlert(true);
      this.level.resetCratesByPrefix('crate_sector3');
      this.enterBossFight();
    }
  }

  private handlePlayerFire(): void {
    const wasReloading = this.weapon.state.reloading;
    if (!this.weapon.state.tryFire()) return;
    this.audio.playMalorianShot();
    if (!wasReloading && this.weapon.state.reloading) {
      this.audio.playReload();
    }
    const aimBlend = this.player.getAimBlend();
    this.player.addShake(THREE.MathUtils.lerp(0.18, 0.1, aimBlend));

    const origin = new THREE.Vector3(
      this.engine.camera.position.x,
      this.engine.camera.position.y,
      this.engine.camera.position.z,
    );
    const dir = this.player.getForwardVector();

    const wallRay = this.physics.raycastBullets(origin, dir, 120);
    const maxDist = wallRay.hit ? wallRay.distance : 120;
    let tracerEnd = new THREE.Vector3(wallRay.point.x, wallRay.point.y, wallRay.point.z);

    // Check regular enemies first
    const enemyHit = this.enemies.handlePlayerShot(origin, dir, maxDist, 44);
    if (enemyHit.hit) {
      tracerEnd = enemyHit.point;
      this.story.recordShot(true, enemyHit.headshot);
      if (enemyHit.killed) this.story.recordKill();
      this.hud.flashHitmarker(enemyHit.headshot);
      this.audio.playHitMarker(enemyHit.headshot);
      this.weapon.triggerFireVisual(tracerEnd, aimBlend);
      return;
    }

    // Check Lev Smasher boss
    const bossHit = this.boss.handlePlayerShot(origin, dir, maxDist, 40);
    if (bossHit.hit) {
      tracerEnd = bossHit.point;
      this.story.recordShot(true, bossHit.headshot);
      this.story.recordBossDamage(bossHit.damage);
      this.hud.flashHitmarker(bossHit.headshot);
      this.audio.playHitMarker(bossHit.headshot);
      this.enemies.spawnSparks(bossHit.point, 7, 0xff4422);

      if (bossHit.enteredPhase2) {
        this.onBossEnteredPhase2();
      }
      if (bossHit.triggeredFinisher) {
        this.enterSamirDefeated();
      }
      this.weapon.triggerFireVisual(tracerEnd, aimBlend);
      return;
    }

    // Missed shot -> sparks on wall
    this.story.recordShot(false, false);
    if (wallRay.hit) {
      this.enemies.spawnSparks(tracerEnd, 4, 0x00f0ff);
    }
    this.weapon.triggerFireVisual(tracerEnd, aimBlend);
  }

  private handlePlayerMelee(): void {
    if (!this.weapon.state.tryMelee()) return;
    this.audio.playFlameMelee();
    this.player.addShake(0.24);

    const origin = new THREE.Vector3(
      this.engine.camera.position.x,
      this.engine.camera.position.y,
      this.engine.camera.position.z,
    );
    const forward = this.player.getForwardVector();
    this.weapon.triggerFlameMeleeVisual(origin, forward);

    const enemyRes = this.enemies.handleFlameMelee(origin, forward);
    if (enemyRes.hits > 0) {
      this.hud.flashHitmarker(true);
      this.audio.playHitMarker(true);
      for (let i = 0; i < enemyRes.kills; i++) this.story.recordKill();
    }

    const bossRes = this.boss.handleFlameMelee(origin, forward);
    if (bossRes.hit) {
      this.story.recordBossDamage(bossRes.damage);
      this.hud.flashHitmarker(true);
      this.audio.playHitMarker(true);
      if (bossRes.enteredPhase2) this.onBossEnteredPhase2();
      if (bossRes.triggeredFinisher) this.enterSamirDefeated();
    }
  }

  private onBossEnteredPhase2(): void {
    this.audio.playSmasherRoar();
    this.fx.glitch = 0.55;
    this.player.addShake(0.55);
    this.hud.setBossBar(true, this.boss.state.getHpRatio(), 'ФАЗА II // САНДЕВИСТАН И УДАРНЫЕ ВОЛНЫ');
    this.queueLine(
      'smasher',
      'Думаешь, твой Сандевистан особенный?! Это устаревший хлам! ПОСМОТРИ НА МОЙ!',
      4.4,
      true,
    );
  }

  private handleInteraction(interactableId: string): void {
    if (interactableId === 'elev1_button') {
      if (!this.level.elev1.isPlayerInside(this.player.position.x, this.player.position.z)) return;
      if (this.level.elev1.state.startRide()) {
        this.level.elev1.syncVisuals();
        this.level.setDoorOpen('door_elev1_bottom', false, false);
        this.level.setInteractableEnabled('elev1_button', false);
        this.audio.setMusicIntensity('ambient');
        this.audio.playElevatorRide(this.level.elev1.state.rideDuration + 0.5);
        this.player.addShake(0.14);
        this.hud.setQuest('Подъём на Этаж 42 — Серверный узел', 'ЛИФТ MARAKULIN EXPRESS // В ПУТИ');
        this.queueLine(
          'rodion',
          'Едешь на 42-й? Мои нетраннеры уже ждут тебя у выхода из лифта, Самир.',
          4.0,
          true,
        );
      }
      return;
    }

    if (interactableId === 'elev2_button') {
      if (!this.level.elev2.isPlayerInside(this.player.position.x, this.player.position.z)) return;
      if (this.level.elev2.state.startRide()) {
        this.level.elev2.syncVisuals();
        this.level.setDoorOpen('door_elev2_bottom', false, false);
        this.level.setInteractableEnabled('elev2_button', false);
        this.audio.setMusicIntensity('ambient');
        this.audio.playElevatorRide(this.level.elev2.state.rideDuration + 0.5);
        this.player.addShake(0.14);
        this.hud.setQuest('Подъём на Этаж 95 — Пентхаус Совета', 'ЭКСПРЕСС-ЛИФТ СОВЕТА // В ПУТИ');
        this.queueLine(
          'samir',
          'Девяносто пятый этаж. Время закончить это, Родион.',
          3.8,
          true,
        );
      }
      return;
    }

    if (interactableId === 'terminal_hack' && !this.laserHacked) {
      this.laserHacked = true;
      this.level.setLaserBarrierActive(false);
      this.level.setInteractableEnabled('terminal_hack', false);
      this.level.elev2.state.unlock();
      this.level.elev2.syncVisuals();
      this.level.setDoorOpen('door_elev2_bottom', true, false);
      this.level.setInteractableEnabled('elev2_button', true);
      this.audio.playTerminalHack();
      this.audio.playElevatorDing();
      this.hud.setQuest('Войдите в лифт пентхауса и нажмите [E] → Этаж 95', 'ЭТАЖ 42 // ЛИФТ ОТКРЫТ');
      this.queueLine('samir', 'Барьер отключён, лифт в пентхаус открыт. Поехали наверх.', 3.4, true);
      return;
    }

    if (interactableId.startsWith('crate_')) {
      this.level.markCrateUsed(interactableId);
      this.player.state.refillSupplies();
      this.audio.playMaxDoc();
      this.queueLine('system', 'Пополнен запас ингаляторов MaxDoc и кибер-брони.', 2.4, true);
    }
  }

  private updateElevators(dt: number): boolean {
    let playerInMovingElevator = false;
    const elevators = [
      { rig: this.level.elev1, topDoor: 'door_elev1_top', arrivalQuest: 'Выйдите из лифта в Серверный узел (Этаж 42)', arrivalSub: 'ЭТАЖ 42 // ПРИБЫТИЕ' },
      { rig: this.level.elev2, topDoor: 'door_elev2_top', arrivalQuest: 'Выйдите из лифта в Предбанник Совета (Этаж 95)', arrivalSub: 'ЭТАЖ 95 // ПРИБЫТИЕ' },
    ];

    for (const entry of elevators) {
      const st = entry.rig.state.status;
      if (st !== 'CLOSING' && st !== 'MOVING') continue;

      const res = entry.rig.update(dt);
      // Carry Samir physically upward with the moving 3D elevator cabin!
      if (entry.rig.isPlayerInside(this.player.position.x, this.player.position.z)) {
        this.player.syncElevatorY(res.currentY);
        playerInMovingElevator = true;
      }

      if (res.beganMoving) {
        this.player.addShake(0.1);
      }
      if (res.floorChanged) {
        this.audio.playElevatorFloorTick();
        const fl = String(res.currentFloor).padStart(2, '0');
        this.hud.setQuest(
          `Подъём: ${entry.rig.config.destinationTitle}`,
          `ЭТАЖ ${fl} // MARAKULIN EXPRESS`,
        );
      }
      if (res.arrived) {
        this.player.syncElevatorY(res.currentY);
        this.player.addShake(0.18);
        this.audio.playElevatorDing();
        this.level.setDoorOpen(entry.topDoor, true, false);
        this.hud.setQuest(entry.arrivalQuest, entry.arrivalSub);
      }
    }
    return playerInMovingElevator;
  }

  private isCombatAct(): boolean {
    return (
      this.story.act === 'ATRIUM' ||
      this.story.act === 'SERVER_ROOM' ||
      this.story.act === 'COUNCIL_HALL' ||
      this.story.act === 'BOSS_FIGHT'
    );
  }

  update(rawDt: number): void {
    const dt = Math.max(0, Math.min(rawDt, 0.05));
    this.totalTime += dt;

    // Live title camera pan through neon Atrium
    if (this.story.act === 'TITLE') {
      const camX = Math.sin(this.totalTime * 0.28) * 9.5;
      const camZ = 10 + Math.cos(this.totalTime * 0.24) * 5.5;
      this.engine.camera.position.set(camX, 4.6, camZ);
      this.engine.camera.lookAt(0, 3.6, -8);
      this.level.updateShadowAnchor(0, FLOOR_ATRIUM_Y, -5, true);
      this.level.update(dt, dt);
      this.engine.render(dt, this.fx);
      return;
    }

    if (this.story.act === 'CREDITS') {
      this.hud.updateCredits(dt);
      this.engine.render(dt, this.fx);
      return;
    }

    if (this.paused || this.dead) {
      this.engine.render(dt, this.fx);
      return;
    }

    // Track active run time
    this.story.stats.elapsedSec += dt;

    const input = this.input.consumeSnapshot();
    this.actTimer += dt;

    // Subtitle queue progression
    if (this.subtitleCooldown > 0) {
      this.subtitleCooldown -= dt;
    } else if (this.subtitleQueue.length > 0) {
      const next = this.subtitleQueue.shift()!;
      this.subtitleCooldown = next.duration + 0.35;
      this.hud.showSubtitle(next);
      this.audio.playHoloChime();
    }

    // Decay transient post-FX smoothly
    this.fx.glitch = Math.max(0, this.fx.glitch - dt * 1.15);
    this.fx.chromaticBoost = Math.max(0, this.fx.chromaticBoost - dt * 1.4);
    if (this.story.act !== 'SAMIR_DEFEATED' && this.story.act !== 'OPERATING_TABLE') {
      const lowHpVignette = this.player.state.hp < 35 ? (35 - this.player.state.hp) / 55 : 0;
      this.fx.damageVignette = Math.max(lowHpVignette, this.fx.damageVignette - dt * 1.25);
    }

    // Update physical moving elevators BEFORE player movement so groundY is exact
    const inMovingElevator = this.updateElevators(dt);

    // Player movement & abilities (ADS allowed in combat acts while not reloading)
    const canAim = this.isCombatAct() && !this.weapon.state.reloading;
    const playerRes = this.player.update(dt, input, this.physics, inMovingElevator, canAim);
    if (playerRes.dashed) {
      this.audio.playDash();
      this.fx.chromaticBoost = 0.45;
    }
    if (playerRes.sandevistanChanged) {
      this.audio.playSandevistan(playerRes.sandevistanActive);
      this.audio.setSandevistanMode(playerRes.sandevistanActive);
    }
    if (playerRes.sandevistanEnded) {
      this.audio.playSandevistan(false);
      this.audio.setSandevistanMode(false);
    }
    if (playerRes.healed) {
      this.audio.playMaxDoc();
    }

    // Smooth Sandevistan shader ramp
    const targetSandyFx = this.player.state.sandevistanActive ? 1 : 0;
    this.fx.sandevistan += (targetSandyFx - this.fx.sandevistan) * Math.min(1, dt * 8);

    const worldTimeScale = this.player.state.getWorldTimeScale();
    const worldDt = dt * worldTimeScale;

    // Weapon actions in combat acts (re-check isCombatAct() after fire/melee in case finisher triggered)
    if (this.isCombatAct()) {
      if (input.firePressed || input.fireHeld) {
        this.handlePlayerFire();
      }
      if (this.isCombatAct() && input.reloadPressed && this.weapon.state.startReload()) {
        this.audio.playReload();
      }
      if (this.isCombatAct() && input.meleePressed) {
        this.handlePlayerMelee();
      }

      if (this.isCombatAct()) {
        // Check nearby interactables on current floor
        const nearby = this.level.findNearbyInteractable(
          this.player.position.x,
          this.player.position.y,
          this.player.position.z,
        );
        this.hud.setInteractPrompt(nearby ? nearby.label : null);
        if (nearby && input.interactPressed) {
          this.handleInteraction(nearby.id);
        }
      } else {
        this.hud.setInteractPrompt(null);
      }
    } else {
      this.hud.setInteractPrompt(null);
    }

    const isMoving = Math.abs(input.moveForward) > 0 || Math.abs(input.moveRight) > 0;
    const aimBlend = this.isCombatAct() ? this.player.getAimBlend() : 0;
    this.weapon.update(dt, this.isCombatAct() && isMoving, aimBlend);
    this.hud.setAiming(aimBlend > 0.35 && !this.weapon.state.reloading);
    this.level.update(worldDt, dt);
    this.level.updateShadowAnchor(
      this.player.position.x,
      this.player.groundY,
      this.player.position.z,
      this.story.act !== 'OPERATING_TABLE' && this.story.act !== 'SOULKILLER',
    );

    // Update Act-specific logic
    this.updateActLogic(dt, worldDt, input);

    // Sync HUD
    this.hud.updateVitals(
      this.player.state.hp,
      this.player.state.maxHp,
      this.player.state.armor,
      this.player.state.maxArmor,
      this.player.state.sandevistanEnergy,
      this.player.state.sandevistanActive,
      this.player.state.maxDocCharges,
      this.weapon.state.meleeCooldown,
    );
    this.hud.updateWeapon(this.weapon.state.ammo, this.weapon.state.reloading);
    this.hud.update(dt);

    this.engine.render(dt, this.fx);
  }

  private updateActLogic(dt: number, worldDt: number, input: ReturnType<InputManager['consumeSnapshot']>): void {
    const playerEye = this.player.getEyePosition();

    // Update active enemies during Sectors 1-3 AND during BOSS_FIGHT if player rushed past Council guards
    if (
      this.story.act === 'ATRIUM' ||
      this.story.act === 'SERVER_ROOM' ||
      this.story.act === 'COUNCIL_HALL' ||
      (this.story.act === 'BOSS_FIGHT' && this.enemies.getAliveCount() > 0)
    ) {
      const { maxOverheatProgress } = this.enemies.update(
        worldDt,
        playerEye,
        this.player.position,
        this.engine.camera.position,
        (heavy) => this.audio.playEnemyShot(heavy),
        (dmg, fromHack) => {
          const inBossPhase2 = this.story.act === 'BOSS_FIGHT' && this.boss.state.phase === 'PHASE_2';
          const res = this.player.state.takeDamage(dmg, !inBossPhase2);
          this.fx.damageVignette = Math.min(1, this.fx.damageVignette + 0.55);
          if (fromHack) {
            this.fx.glitch = Math.min(1, this.fx.glitch + 0.75);
          }
          this.player.addShake(fromHack ? 0.55 : 0.25);
          this.audio.playPlayerHurt(fromHack);
          if (inBossPhase2 && this.boss.state.shouldTriggerFinisherFromPlayerLowHp(this.player.state.hp)) {
            this.enterSamirDefeated();
          } else if (res.died) {
            this.triggerPlayerDeath();
          }
        },
      );
      this.hud.setOverheatProgress(maxOverheatProgress);
    } else {
      this.hud.setOverheatProgress(0);
    }

    switch (this.story.act) {
      case 'INTRO': {
        if (this.actTimer >= 2.2) {
          this.enterAtrium();
        }
        break;
      }

      case 'ATRIUM': {
        if (!this.atriumCleared && this.enemies.getAliveCount() === 0) {
          this.atriumCleared = true;
          this.level.elev1.state.unlock();
          this.level.elev1.syncVisuals();
          this.level.setDoorOpen('door_elev1_bottom', true, false);
          this.level.setInteractableEnabled('elev1_button', true);
          this.audio.playElevatorDing();
          this.hud.setQuest('Войдите в лифт и нажмите [E] → Этаж 42', 'ЭТАЖ 01 ЗАЧИЩЕН // ЛИФТ ОТКРЫТ');
          this.queueLine('samir', 'Атриум чист. Захожу в лифт — поднимаюсь в Серверный узел.', 3.2, true);
        }
        if (this.level.elev1.state.status === 'ARRIVED' && this.player.position.z <= -39.2) {
          this.enterServerRoom();
        }
        break;
      }

      case 'SERVER_ROOM': {
        if (!this.serverCleared && this.enemies.getAliveCount() === 0) {
          this.serverCleared = true;
          this.level.setInteractableEnabled('terminal_hack', true);
          this.hud.setQuest('Взломать терминал лазерного барьера [E]', 'ЭТАЖ 42 // ОХРАНА УСТРАНЕНА');
          this.queueLine(
            'samir',
            'Терминал справа от лазеров. Сниму защиту и вызову лифт на 95-й этаж.',
            3.6,
            true,
          );
        }
        if (this.level.elev2.state.status === 'ARRIVED' && this.player.position.z <= -91.2) {
          this.enterCouncilHall();
        }
        break;
      }

      case 'COUNCIL_HALL': {
        if (!this.councilCleared && this.enemies.getAliveCount() === 0) {
          this.councilCleared = true;
          this.audio.setMusicIntensity('ambient');
          this.hud.setQuest('Подойдите к дверям Зала Совета Родиона', 'СЕКТОР 03 // ПУТЬ ОТКРЫТ');
          this.queueLine('samir', 'Вот он — Зал Совета. Выходи, Родион!', 3.2, true);
        }
        // Trigger Lev Smasher ambush right before Rodion's doors (even if rushing past guards — Smasher will wreck them too!)
        if (this.player.position.z <= -131.5) {
          this.enterBossKnockback();
        }
        break;
      }

      case 'BOSS_KNOCKBACK': {
        // After brief terrifying reveal (0.45s), Lev Smasher slams Samir backwards across the hall!
        if (!this.knockbackSlamTriggered && this.actTimer >= 0.45) {
          this.knockbackSlamTriggered = true;
          this.audio.playExplosion(true);
          this.audio.playPlayerHurt(true);
          this.fx.damageVignette = 0.82;
          this.fx.glitch = 1.0;
          this.player.startKnockback(-113, 0);
          // Smasher's entry shockwave blasts any nearby surviving corporate guards
          this.enemies.applyAreaDamage(
            { x: 0, y: FLOOR_COUNCIL_Y + 1.0, z: -135.5 },
            11.0,
            70,
            () => this.story.recordKill(),
            true,
          );
        }
        if (this.actTimer >= 2.25) {
          this.enterBossFight();
        }
        break;
      }

      case 'BOSS_FIGHT': {
        this.boss.updateCombat(worldDt, this.player.position, playerEye, {
          onAutocannonShot: () => this.audio.playEnemyShot(true),
          onMissileExplode: () => {
            this.audio.playExplosion(false);
            this.player.addShake(0.45);
          },
          onRoar: () => this.audio.playSmasherRoar(),
          onPlayerDamaged: (dmg, shake) => {
            // In Phase 2, lethal hits trigger the scripted Samir Defeated story climax!
            const inPhase2 = this.boss.state.phase === 'PHASE_2';
            const res = this.player.state.takeDamage(dmg, !inPhase2);
            this.fx.damageVignette = Math.min(1, this.fx.damageVignette + 0.58);
            this.fx.glitch = Math.min(1, this.fx.glitch + 0.35);
            this.player.addShake(shake);
            this.audio.playPlayerHurt(true);

            if (inPhase2 && this.boss.state.shouldTriggerFinisherFromPlayerLowHp(this.player.state.hp)) {
              this.enterSamirDefeated();
            } else if (res.died) {
              this.triggerPlayerDeath();
            }
          },
          onProjectileHitEnemy: (from, to, dmg) =>
            this.enemies.checkBossProjectileHit(from, to, dmg, () => this.story.recordKill()),
          onAreaDamageEnemies: (center, radius, dmg, ignoreY) => {
            this.enemies.applyAreaDamage(center, radius, dmg, () => this.story.recordKill(), ignoreY);
          },
        });

        if (this.story.act === 'BOSS_FIGHT') {
          this.hud.setBossBar(
            true,
            this.boss.state.getHpRatio(),
            this.boss.state.phase === 'PHASE_2'
              ? 'ФАЗА II // САНДЕВИСТАН И УДАРНЫЕ ВОЛНЫ'
              : 'ФАЗА I // АВТОПУШКА И МИКРОРАКЕТЫ',
          );
        }
        break;
      }

      case 'SAMIR_DEFEATED': {
        this.boss.updateFinisherLoom(dt, this.player.position);
        this.fx.damageVignette = 0.85 + Math.sin(this.actTimer * 3.5) * 0.1;
        this.fx.glitch = Math.max(0.28, 1.0 - this.actTimer * 0.18);

        // Slow heavy eyelid droop & fade to unconsciousness
        if (this.actTimer > 3.0) {
          const fade = Math.min(1, (this.actTimer - 3.0) / 2.6);
          this.fx.eyelids = fade;
          this.fx.blackout = fade * 0.95;
        }
        if (this.actTimer >= 6.0) {
          this.enterOperatingTable();
        }
        break;
      }

      case 'OPERATING_TABLE': {
        this.tableStageTimer += dt;
        const rodionCloser = this.tableStage !== 'WAKING';
        this.operatingScene.update(dt, this.totalTime, rodionCloser);

        if (this.tableStage === 'WAKING') {
          // Cinematic slow blinking awake under surgical light
          const t = this.tableStageTimer;
          this.fx.blackout = Math.max(0, 0.85 - t * 0.32);
          const blink = t < 1.2 ? 0.9 - t * 0.45 : t < 1.8 ? 0.35 + (t - 1.2) * 0.9 : Math.max(0, 0.85 - (t - 1.8) * 0.8);
          this.fx.eyelids = Math.max(0, Math.min(1, blink));

          if (t >= 3.0) {
            this.fx.eyelids = 0;
            this.fx.blackout = 0;
            this.tableStage = 'MONOLOGUE_1';
            this.tableStageTimer = 0;
            this.queueLine(
              'rodion',
              'Проснулся, Самир? Добро пожаловать в лабораторию «Душегуба».',
              4.2,
              true,
            );
          }
        } else if (this.tableStage === 'MONOLOGUE_1') {
          if (this.tableStageTimer >= 4.4) {
            this.tableStage = 'MONOLOGUE_2';
            this.tableStageTimer = 0;
            this.queueLine(
              'rodion',
              'Ты пробился через всю Маракулин Тавер ради мести... Но Лев Смэшер принес мне идеальный приз — твоё сознание.',
              5.0,
              true,
            );
          }
        } else if (this.tableStage === 'MONOLOGUE_2') {
          if (this.tableStageTimer >= 5.2) {
            this.tableStage = 'AWAITING_CHOICE';
            this.tableStageTimer = 0;
            this.input.exitPointerLock();
            this.hud.showDialogueChoices(FINALE_CHOICES);
            this.hud.setQuest('Выберите ответ Родиону [1] / [2]', 'ФИНАЛ // ОПЕРАЦИОННЫЙ СТОЛ');
          }
        } else if (this.tableStage === 'AWAITING_CHOICE') {
          if (input.choiceKey === '1') {
            this.handleFinaleChoice('defiant');
          } else if (input.choiceKey === '2') {
            this.handleFinaleChoice('taunt');
          }
        } else if (this.tableStage === 'RESPONSE') {
          if (this.tableStageTimer >= 7.8) {
            this.enterSoulkiller();
          }
        }
        break;
      }

      case 'SOULKILLER': {
        this.soulkillerTimer += dt;
        const progress = Math.min(1, this.soulkillerTimer / this.soulkillerDuration);
        this.operatingScene.setSoulkillerProgress(progress);
        this.operatingScene.update(dt, this.totalTime, true);

        this.fx.soulkiller = progress;
        this.fx.glitch = 0.25 + progress * 0.9;
        this.player.setMinShake(0.08 + progress * 0.65);
        this.hud.setSoulkillerProgress(true, progress);

        if (this.soulkillerTimer >= this.soulkillerDuration + 1.2) {
          this.fx.blackout = Math.min(1, (this.soulkillerTimer - (this.soulkillerDuration + 1.2)) / 1.4);
        }
        if (this.soulkillerTimer >= this.soulkillerDuration + 2.8) {
          this.enterCredits();
        }
        break;
      }

      default:
        break;
    }
  }

  dispose(): void {
    this.hud.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.enemies.dispose();
    this.boss.dispose();
    this.weapon.dispose();
    this.level.dispose();
    this.operatingScene.dispose();
    this.textures.dispose();
  }
}
