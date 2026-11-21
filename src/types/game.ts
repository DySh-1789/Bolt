export type GameAct =
  | 'TITLE'
  | 'INTRO'
  | 'ATRIUM'
  | 'SERVER_ROOM'
  | 'COUNCIL_HALL'
  | 'BOSS_KNOCKBACK'
  | 'BOSS_FIGHT'
  | 'SAMIR_DEFEATED'
  | 'OPERATING_TABLE'
  | 'SOULKILLER'
  | 'CREDITS';

export type SpeakerId = 'samir' | 'rodion' | 'smasher' | 'system';

export type EnemyArchetype = 'guard' | 'drone' | 'turret' | 'netrunner' | 'heavy';

export type BossPhase = 'DORMANT' | 'KNOCKBACK' | 'PHASE_1' | 'PHASE_2' | 'FINISHER' | 'FINISHED';

export type CameraMode = 'FREE' | 'INTRO' | 'KNOCKBACK' | 'FALLEN' | 'OPERATING_TABLE';

export type MusicIntensity = 'silent' | 'title' | 'ambient' | 'combat' | 'boss' | 'operating' | 'soulkiller';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  active: boolean;
  blocksSight?: boolean;
  blocksBullets?: boolean;
  isFloor?: boolean;
}

export interface InteractablePoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  enabled: boolean;
}

export interface SubtitleEvent {
  speaker: SpeakerId;
  speakerName: string;
  role: string;
  text: string;
  duration: number;
}

export interface DialogueChoice {
  id: string;
  key: '1' | '2';
  text: string;
}

export interface RunStats {
  elapsedSec: number;
  enemiesEliminated: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  damageDealtToSmasher: number;
  deaths: number;
  chosenFinaleLine: string;
}

export interface PostFxState {
  glitch: number;
  damageVignette: number;
  sandevistan: number;
  soulkiller: number;
  blackout: number;
  eyelids: number;
  chromaticBoost: number;
}

export interface CheckpointData {
  act: GameAct;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function createInitialRunStats(): RunStats {
  return {
    elapsedSec: 0,
    enemiesEliminated: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    damageDealtToSmasher: 0,
    deaths: 0,
    chosenFinaleLine: '',
  };
}

export function createDefaultPostFx(): PostFxState {
  return {
    glitch: 0,
    damageVignette: 0,
    sandevistan: 0,
    soulkiller: 0,
    blackout: 0,
    eyelids: 0,
    chromaticBoost: 0,
  };
}
