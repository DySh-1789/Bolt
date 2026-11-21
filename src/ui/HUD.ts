import type { DialogueChoice, RunStats, SpeakerId, SubtitleEvent } from '../types/game';

export interface HudCallbacks {
  onStartGame: () => void;
  onResumeGame: () => void;
  onRestartGame: () => void;
  onRetryCheckpoint: () => void;
  onSensitivityChange: (val: number) => void;
  onVolumeChange: (val: number) => void;
  onDialogueChoiceSelected: (choiceId: string) => void;
}

const PORTRAIT_SVGS: Record<SpeakerId, string> = {
  samir: `<svg viewBox="0 0 64 64" width="52" height="52">
    <polygon points="18,12 46,12 50,36 40,54 24,54 14,36" fill="#0d1b2a" stroke="#00f0ff" stroke-width="2"/>
    <rect x="18" y="24" width="28" height="8" fill="#00f0ff" opacity="0.85"/>
    <line x1="22" y1="42" x2="42" y2="42" stroke="#fcee0a" stroke-width="2"/>
    <path d="M16,18 L32,8 L48,18" fill="none" stroke="#ff003c" stroke-width="2"/>
  </svg>`,
  rodion: `<svg viewBox="0 0 64 64" width="52" height="52">
    <polygon points="18,10 46,10 48,34 38,54 26,54 16,34" fill="#170b14" stroke="#ff003c" stroke-width="2"/>
    <circle cx="24" cy="28" r="4.5" fill="#ff003c"/>
    <circle cx="40" cy="28" r="3" fill="#dce6f5"/>
    <line x1="20" y1="18" x2="20" y2="44" stroke="#fcee0a" stroke-width="1.5"/>
    <polygon points="20,54 32,45 44,54" fill="#ff003c" opacity="0.7"/>
  </svg>`,
  smasher: `<svg viewBox="0 0 64 64" width="52" height="52">
    <polygon points="12,12 52,12 56,42 42,56 22,56 8,42" fill="#1b1418" stroke="#ff003c" stroke-width="2.5"/>
    <rect x="16" y="23" width="12" height="6" fill="#ff003c"/>
    <rect x="36" y="23" width="12" height="6" fill="#ff003c"/>
    <rect x="20" y="39" width="24" height="8" fill="none" stroke="#fcee0a" stroke-width="2"/>
    <line x1="26" y1="39" x2="26" y2="47" stroke="#fcee0a" stroke-width="2"/>
    <line x1="32" y1="39" x2="32" y2="47" stroke="#fcee0a" stroke-width="2"/>
    <line x1="38" y1="39" x2="38" y2="47" stroke="#fcee0a" stroke-width="2"/>
  </svg>`,
  system: `<svg viewBox="0 0 64 64" width="52" height="52">
    <polygon points="32,6 58,32 32,58 6,32" fill="none" stroke="#fcee0a" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="10" fill="none" stroke="#00f0ff" stroke-width="2"/>
    <circle cx="32" cy="32" r="3.5" fill="#ff003c"/>
  </svg>`,
};

export class HUD {
  private rootHud: HTMLElement;
  private vitalsPanel: HTMLElement;
  private titleScreen: HTMLElement;
  private pauseScreen: HTMLElement;
  private deathScreen: HTMLElement;
  private creditsScreen: HTMLElement;
  private creditsStage: HTMLElement;
  private creditsCrawl: HTMLElement;
  private creditsFinale: HTMLElement;
  private creditsQuote: HTMLElement;
  private btnCreditsSpeed: HTMLElement;

  private hpFill: HTMLElement;
  private hpValue: HTMLElement;
  private armorFill: HTMLElement;
  private armorValue: HTMLElement;
  private sandyFill: HTMLElement;
  private sandyChip: HTMLElement;
  private maxDocCount: HTMLElement;
  private meleeStatus: HTMLElement;

  private holoPanel: HTMLElement;
  private holoPortrait: HTMLElement;
  private holoName: HTMLElement;
  private holoRole: HTMLElement;

  private bossBar: HTMLElement;
  private bossHpFill: HTMLElement;
  private bossPhaseTag: HTMLElement;

  private overheatWarning: HTMLElement;
  private overheatFill: HTMLElement;
  private traumaBanner: HTMLElement;
  private traumaSub: HTMLElement;

  private questObjective: HTMLElement;
  private questSub: HTMLElement;

  private crosshairWrap: HTMLElement;
  private hitmarker: HTMLElement;
  private interactPrompt: HTMLElement;
  private interactText: HTMLElement;

  private soulkillerHud: HTMLElement;
  private skFill: HTMLElement;
  private skPercent: HTMLElement;

  private weaponPanel: HTMLElement;
  private ammoCurrent: HTMLElement;
  private weaponState: HTMLElement;

  private subtitleBox: HTMLElement;
  private subtitleSpeaker: HTMLElement;
  private subtitleText: HTMLElement;
  private dialogueChoices: HTMLElement;

  private hitmarkerTimer = 0;
  private activeSubtitleTimer = 0;
  private creditsY = 0;
  private creditsFastToggle = false;
  private creditsFastHold = false;
  private creditsRunning = false;
  private callbacks: HudCallbacks;
  private cleanups: Array<() => void> = [];

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;

    this.rootHud = this.el('hud');
    this.vitalsPanel = this.el('vitals-panel');
    this.titleScreen = this.el('title-screen');
    this.pauseScreen = this.el('pause-screen');
    this.deathScreen = this.el('death-screen');
    this.creditsScreen = this.el('credits-screen');
    this.creditsStage = this.el('credits-stage');
    this.creditsCrawl = this.el('credits-crawl');
    this.creditsFinale = this.el('credits-finale');
    this.creditsQuote = this.el('credits-quote');
    this.btnCreditsSpeed = this.el('btn-credits-speed');

    this.hpFill = this.el('hp-fill');
    this.hpValue = this.el('hp-value');
    this.armorFill = this.el('armor-fill');
    this.armorValue = this.el('armor-value');
    this.sandyFill = this.el('sandy-fill');
    this.sandyChip = this.el('sandevistan-chip');
    this.maxDocCount = this.el('maxdoc-count');
    this.meleeStatus = this.el('melee-status');

    this.holoPanel = this.el('holo-panel');
    this.holoPortrait = this.el('holo-portrait');
    this.holoName = this.el('holo-name');
    this.holoRole = this.el('holo-role');

    this.bossBar = this.el('boss-bar');
    this.bossHpFill = this.el('boss-hp-fill');
    this.bossPhaseTag = this.el('boss-phase-tag');

    this.overheatWarning = this.el('overheat-warning');
    this.overheatFill = this.el('overheat-fill');
    this.traumaBanner = this.el('trauma-banner');
    this.traumaSub = this.el('trauma-sub');

    this.questObjective = this.el('quest-objective');
    this.questSub = this.el('quest-sub');

    this.crosshairWrap = this.el('crosshair-wrap');
    this.hitmarker = this.el('hitmarker');
    this.interactPrompt = this.el('interact-prompt');
    this.interactText = this.el('interact-text');

    this.soulkillerHud = this.el('soulkiller-hud');
    this.skFill = this.el('sk-fill');
    this.skPercent = this.el('sk-percent');

    this.weaponPanel = this.el('weapon-panel');
    this.ammoCurrent = this.el('ammo-current');
    this.weaponState = this.el('weapon-state');

    this.subtitleBox = this.el('subtitle-box');
    this.subtitleSpeaker = this.el('subtitle-speaker');
    this.subtitleText = this.el('subtitle-text');
    this.dialogueChoices = this.el('dialogue-choices');

    this.bindButtons();
  }

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing required HUD element #${id}`);
    return node;
  }

  private addListener(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private bindButtons(): void {
    this.addListener(this.el('btn-start'), 'click', () => this.callbacks.onStartGame());
    this.addListener(this.el('btn-resume'), 'click', () => this.callbacks.onResumeGame());
    this.addListener(this.el('btn-restart'), 'click', () => this.callbacks.onRestartGame());
    this.addListener(this.el('btn-retry'), 'click', () => this.callbacks.onRetryCheckpoint());
    this.addListener(this.el('btn-replay'), 'click', () => this.callbacks.onRestartGame());

    this.addListener(this.btnCreditsSpeed, 'click', () => {
      this.creditsFastToggle = !this.creditsFastToggle;
      this.syncCreditsSpeedButton();
    });
    this.addListener(this.el('btn-credits-skip'), 'click', () => this.skipCreditsToFinale());

    this.addListener(window, 'keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (!this.creditsRunning) return;
      if (ke.code === 'Space' || ke.code === 'ArrowDown') {
        this.creditsFastHold = true;
        this.syncCreditsSpeedButton();
        ke.preventDefault();
      }
    });
    this.addListener(window, 'keyup', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.code === 'Space' || ke.code === 'ArrowDown') {
        this.creditsFastHold = false;
        this.syncCreditsSpeedButton();
      }
    });
    this.addListener(this.creditsStage, 'wheel', (e) => {
      if (!this.creditsRunning) return;
      const we = e as WheelEvent;
      this.creditsY -= we.deltaY * 0.7;
      this.clampCreditsPosition();
      this.applyCreditsTransform();
    });

    const sensSlider = this.el('slider-sens') as HTMLInputElement;
    const sensVal = this.el('sens-val');
    this.addListener(sensSlider, 'input', () => {
      const v = Number(sensSlider.value);
      sensVal.textContent = `${v.toFixed(1)}x`;
      this.callbacks.onSensitivityChange(v);
    });

    const volSlider = this.el('slider-vol') as HTMLInputElement;
    const volVal = this.el('vol-val');
    this.addListener(volSlider, 'input', () => {
      const v = Number(volSlider.value);
      volVal.textContent = `${v}%`;
      this.callbacks.onVolumeChange(v / 100);
    });
  }

  private syncCreditsSpeedButton(): void {
    const fast = this.creditsFastToggle || this.creditsFastHold;
    this.btnCreditsSpeed.classList.toggle('active', fast);
    this.btnCreditsSpeed.textContent = fast ? 'СКОРОСТЬ 3x' : 'УСКОРИТЬ 3x';
  }

  private getCreditsStopY(): number {
    const stageH = this.creditsStage.clientHeight || window.innerHeight || 720;
    const finaleTop = this.creditsFinale.offsetTop;
    const finaleH = this.creditsFinale.offsetHeight || 220;
    return stageH * 0.5 - (finaleTop + finaleH * 0.5);
  }

  private clampCreditsPosition(): void {
    const stageH = this.creditsStage.clientHeight || window.innerHeight || 720;
    const stopY = this.getCreditsStopY();
    this.creditsY = Math.max(stopY, Math.min(stageH + 40, this.creditsY));
  }

  private applyCreditsTransform(): void {
    this.creditsCrawl.style.transform = `translate3d(0, ${this.creditsY}px, 0)`;
  }

  startCreditsRoll(): void {
    const stageH = this.creditsStage.clientHeight || window.innerHeight || 720;
    this.creditsRunning = true;
    this.creditsFastToggle = false;
    this.creditsFastHold = false;
    this.syncCreditsSpeedButton();
    // Start hero block right at the lower edge of the cinema viewport
    this.creditsY = stageH * 0.88;
    this.applyCreditsTransform();
  }

  skipCreditsToFinale(): void {
    this.creditsY = this.getCreditsStopY();
    this.applyCreditsTransform();
  }

  updateCredits(dt: number): void {
    if (!this.creditsRunning) return;
    const stopY = this.getCreditsStopY();
    if (this.creditsY > stopY) {
      const speed = this.creditsFastToggle || this.creditsFastHold ? 210 : 58;
      this.creditsY = Math.max(stopY, this.creditsY - speed * dt);
      this.applyCreditsTransform();
    }
  }

  showScreen(screen: 'title' | 'playing' | 'pause' | 'death' | 'credits'): void {
    this.titleScreen.classList.toggle('hidden', screen !== 'title');
    this.pauseScreen.classList.toggle('hidden', screen !== 'pause');
    this.deathScreen.classList.toggle('hidden', screen !== 'death');
    this.creditsScreen.classList.toggle('hidden', screen !== 'credits');
    this.rootHud.classList.toggle('hidden', screen === 'title' || screen === 'credits');
    if (screen === 'credits') {
      this.startCreditsRoll();
    } else {
      this.creditsRunning = false;
      this.creditsFastHold = false;
    }
  }

  setCombatHudVisible(visible: boolean): void {
    this.vitalsPanel.classList.toggle('hidden', !visible);
    this.crosshairWrap.classList.toggle('hidden', !visible);
    this.weaponPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      this.crosshairWrap.classList.remove('aiming');
    }
  }

  setAiming(aiming: boolean): void {
    this.crosshairWrap.classList.toggle('aiming', aiming);
  }

  updateVitals(
    hp: number,
    maxHp: number,
    armor: number,
    maxArmor: number,
    sandyEnergy: number,
    sandyActive: boolean,
    maxDoc: number,
    meleeCooldown: number,
  ): void {
    const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const armorPct = Math.max(0, Math.min(100, (armor / maxArmor) * 100));
    this.hpFill.style.width = `${hpPct}%`;
    this.hpValue.textContent = String(Math.ceil(hp));
    this.armorFill.style.width = `${armorPct}%`;
    this.armorValue.textContent = String(Math.ceil(armor));
    this.sandyFill.style.width = `${Math.max(0, Math.min(100, sandyEnergy))}%`;
    this.sandyChip.classList.toggle('active', sandyActive);
    this.maxDocCount.textContent = String(maxDoc);
    this.meleeStatus.textContent = meleeCooldown <= 0.05 ? 'RDY' : `${meleeCooldown.toFixed(1)}s`;
  }

  updateWeapon(ammo: number, reloading: boolean): void {
    this.ammoCurrent.textContent = String(ammo);
    this.weaponState.textContent = reloading ? 'ПЕРЕЗАРЯДКА...' : ammo <= 2 ? 'МАЛО ПАТРОНОВ [R]' : 'ГОТОВ К ОГНЮ';
  }

  setQuest(objective: string, sublabel: string): void {
    this.questObjective.textContent = objective;
    this.questSub.textContent = sublabel;
  }

  setBossBar(visible: boolean, hpRatio = 1, phaseLabel = 'КИБОРГ-ДЖАГГЕРНАУТ // КЛАСС S'): void {
    this.bossBar.classList.toggle('hidden', !visible);
    if (visible) {
      this.bossHpFill.style.width = `${Math.max(0, Math.min(100, hpRatio * 100))}%`;
      this.bossPhaseTag.textContent = phaseLabel;
    }
  }

  setOverheatProgress(progress: number): void {
    const active = progress > 0.02;
    this.overheatWarning.classList.toggle('hidden', !active);
    if (active) {
      this.overheatFill.style.width = `${Math.min(100, progress * 100)}%`;
    }
  }

  setTraumaBanner(visible: boolean, subtext = 'ПОТЕРЯ СОЗНАНИЯ...'): void {
    this.traumaBanner.classList.toggle('hidden', !visible);
    this.traumaSub.textContent = subtext;
  }

  setInteractPrompt(label: string | null): void {
    if (!label) {
      this.interactPrompt.classList.add('hidden');
    } else {
      this.interactPrompt.classList.remove('hidden');
      this.interactText.textContent = label;
    }
  }

  setSoulkillerProgress(visible: boolean, progress = 0): void {
    this.soulkillerHud.classList.toggle('hidden', !visible);
    if (visible) {
      const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
      this.skFill.style.width = `${pct}%`;
      this.skPercent.textContent =
        pct >= 100 ? 'ЭНГРАММА САМИРА ЗАХВАЧЕНА — 100%' : `ИЗВЛЕЧЕНИЕ ДУШИ: ${pct}%`;
    }
  }

  flashHitmarker(headshot: boolean): void {
    this.hitmarkerTimer = 0.14;
    this.hitmarker.classList.add('show');
    this.hitmarker.classList.toggle('headshot', headshot);
  }

  showSubtitle(evt: SubtitleEvent): void {
    this.activeSubtitleTimer = evt.duration;
    this.subtitleBox.classList.remove('hidden');
    this.subtitleSpeaker.textContent = `${evt.speakerName}:`;
    this.subtitleSpeaker.className = `subtitle-speaker ${evt.speaker}`;
    this.subtitleText.textContent = evt.text;

    this.holoPanel.classList.remove('hidden');
    this.holoPortrait.innerHTML = PORTRAIT_SVGS[evt.speaker];
    this.holoName.textContent = evt.speakerName;
    this.holoRole.textContent = evt.role;
  }

  clearSubtitle(): void {
    this.activeSubtitleTimer = 0;
    this.subtitleBox.classList.add('hidden');
    this.holoPanel.classList.add('hidden');
  }

  showDialogueChoices(choices: DialogueChoice[]): void {
    this.dialogueChoices.innerHTML = '';
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `<span class="choice-key">${c.key}</span><span>${c.text}</span>`;
      btn.addEventListener('click', () => {
        this.hideDialogueChoices();
        this.callbacks.onDialogueChoiceSelected(c.id);
      });
      this.dialogueChoices.appendChild(btn);
    }
    this.dialogueChoices.classList.remove('hidden');
  }

  hideDialogueChoices(): void {
    this.dialogueChoices.classList.add('hidden');
    this.dialogueChoices.innerHTML = '';
  }

  populateCredits(stats: RunStats): void {
    const mins = Math.floor(stats.elapsedSec / 60);
    const secs = Math.floor(stats.elapsedSec % 60);
    this.el('stat-time').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.el('stat-kills').textContent = String(stats.enemiesEliminated);
    const acc = stats.shotsFired > 0 ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    this.el('stat-accuracy').textContent = `${acc}%`;
    this.el('stat-headshots').textContent = String(stats.headshots);
    this.el('stat-boss-dmg').textContent = String(Math.round(stats.damageDealtToSmasher));
    if (stats.chosenFinaleLine) {
      this.creditsQuote.textContent = `Последняя реплика Самира: ${stats.chosenFinaleLine}`;
      this.creditsQuote.classList.remove('hidden');
    } else {
      this.creditsQuote.classList.add('hidden');
    }
  }

  update(dt: number): void {
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) {
        this.hitmarker.classList.remove('show', 'headshot');
      }
    }

    if (this.activeSubtitleTimer > 0) {
      this.activeSubtitleTimer -= dt;
      if (this.activeSubtitleTimer <= 0) {
        this.clearSubtitle();
      }
    }
  }

  dispose(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
  }
}
