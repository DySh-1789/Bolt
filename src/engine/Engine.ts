import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { PostFxState } from '../types/game';

const CyberpunkPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uDamageVignette: { value: 0 },
    uSandevistan: { value: 0 },
    uSoulkiller: { value: 0 },
    uBlackout: { value: 0 },
    uEyelids: { value: 0 },
    uChromaticBoost: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlitch;
    uniform float uDamageVignette;
    uniform float uSandevistan;
    uniform float uSoulkiller;
    uniform float uBlackout;
    uniform float uEyelids;
    uniform float uChromaticBoost;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      // Horizontal glitch slicing (Relic malfunction / damage / Soulkiller)
      float glitchAmt = clamp(uGlitch + uSoulkiller * 0.65, 0.0, 1.5);
      if (glitchAmt > 0.01) {
        float slice = floor(uv.y * 42.0 + floor(uTime * 18.0));
        float rnd = hash(vec2(slice, floor(uTime * 22.0)));
        if (rnd > 0.72 - glitchAmt * 0.25) {
          uv.x += (rnd - 0.5) * 0.065 * glitchAmt;
        }
      }

      // Chromatic aberration
      vec2 centerVec = uv - 0.5;
      float distCenter = length(centerVec);
      float ca = 0.0012 + uChromaticBoost * 0.0065 + uSandevistan * 0.006 + glitchAmt * 0.01;
      vec2 caOffset = centerVec * ca * (0.6 + distCenter * 1.3);

      float r = texture2D(tDiffuse, clamp(uv + caOffset, 0.001, 0.999)).r;
      float g = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g;
      float b = texture2D(tDiffuse, clamp(uv - caOffset, 0.001, 0.999)).b;
      vec3 col = vec3(r, g, b);

      // Subtle cyberpunk CRT scanlines
      float scan = sin(uv.y * 720.0 + uTime * 3.0) * 0.012;
      col -= scan * (0.35 + glitchAmt * 1.4);

      // Sandevistan golden-cyan overdrive grading
      if (uSandevistan > 0.01) {
        vec3 sandyTint = vec3(0.08, 0.92, 1.0);
        float rim = smoothstep(0.25, 0.85, distCenter);
        col = mix(col, col * vec3(0.9, 1.08, 1.18) + sandyTint * rim * 0.22, uSandevistan * 0.7);
      }

      // Soulkiller digital matrix dissolution (red/cyan wireframe & scan grid)
      if (uSoulkiller > 0.01) {
        float gx = abs(fract(uv.x * 36.0) - 0.5);
        float gy = abs(fract(uv.y * 22.0 - uTime * 1.4) - 0.5);
        float grid = smoothstep(0.46, 0.5, max(gx, gy));
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 engramCol = mix(vec3(1.0, 0.02, 0.24), vec3(0.0, 0.95, 1.0), smoothstep(0.15, 0.75, luma + sin(uTime * 4.0 + uv.y * 8.0) * 0.2));
        vec3 matrixCol = engramCol * (0.4 + luma * 1.4) + vec3(0.0, 1.0, 1.0) * grid * 0.55;
        col = mix(col, matrixCol, clamp(uSoulkiller * 0.92, 0.0, 0.95));
        // Ascending white-cyan flash near 100% extraction
        float surge = smoothstep(0.82, 1.0, uSoulkiller);
        col = mix(col, vec3(0.75, 0.98, 1.0), surge * 0.85);
      }

      // Subtle cinematic vignette + crimson trauma overlay
      float baseVignette = smoothstep(0.55, 1.0, distCenter) * 0.20;
      col *= (1.0 - baseVignette);
      if (uDamageVignette > 0.01) {
        float dmgMask = smoothstep(0.22, 0.85, distCenter) * uDamageVignette;
        col = mix(col, vec3(0.85, 0.02, 0.08), clamp(dmgMask * 0.85, 0.0, 0.9));
      }

      // Eyelid blink / half-open vision on the operating table
      if (uEyelids > 0.01) {
        float dy = abs(vUv.y - 0.5) * 2.0;
        float openThreshold = clamp(1.0 - uEyelids, 0.0, 1.0);
        float lidMask = smoothstep(openThreshold - 0.14, openThreshold + 0.04, dy);
        col *= (1.0 - lidMask);
      }

      // Full blackout fade
      col *= (1.0 - clamp(uBlackout, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private outputPass: OutputPass;
  private postPass: ShaderPass;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private container: HTMLElement;
  private elapsed = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);
    this.scene.fog = new THREE.FogExp2(0x0c1224, 0.01);

    const width = Math.max(container.clientWidth, window.innerWidth, 1);
    const height = Math.max(container.clientHeight, window.innerHeight, 1);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.08, 220);

    // Subtle tactical rim/fill light on Samir without creating bright wall hotspots
    const cameraFill = new THREE.PointLight(0x9ec4e8, 1.8, 10, 1.6);
    cameraFill.position.set(0, 0.15, 0.2);
    this.camera.add(cameraFill);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Subtle Cyberpunk Neon IBL environment map for controlled metallic highlights
    this.envRenderTarget = this.createCyberpunkEnvironment();
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.36;

    // Post-processing pipeline: Render (linear) -> Bloom (HDR linear) -> OutputPass (ACES + sRGB) -> CyberpunkPostShader
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.32, 0.35, 0.94);
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.postPass = new ShaderPass(CyberpunkPostShader);
    this.composer.addPass(this.postPass);

    window.addEventListener('resize', this.handleResize);
  }

  private createCyberpunkEnvironment(): THREE.WebGLRenderTarget {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0c111e);

    const tempMeshes: THREE.Mesh[] = [];
    const addPanel = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      colorHex: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color: colorHex }),
      );
      m.position.set(x, y, z);
      envScene.add(m);
      tempMeshes.push(m);
    };

    // Soft studio reflection panels so chrome/armor has depth without harsh specular glare
    addPanel(0, 9, 0, 12, 0.5, 12, 0x455c82);
    addPanel(-9, 3, 0, 0.5, 4, 12, 0x166d80);
    addPanel(9, 3, 0, 0.5, 4, 12, 0x7a1632);
    addPanel(0, 4, -9, 10, 3, 0.5, 0x73632a);
    addPanel(0, 4, 9, 10, 3, 0.5, 0x2c4870);
    addPanel(0, -8, 0, 16, 0.5, 16, 0x131824);

    const rt = pmrem.fromScene(envScene, 0.06);
    for (const m of tempMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    pmrem.dispose();
    return rt;
  }

  private handleResize = (): void => {
    const width = Math.max(this.container.clientWidth, window.innerWidth, 1);
    const height = Math.max(this.container.clientHeight, window.innerHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
  };

  setFogDensity(density: number, colorHex = 0x070914): void {
    this.scene.fog = new THREE.FogExp2(colorHex, density);
  }

  render(dt: number, fx: PostFxState): void {
    this.elapsed += dt;
    const u = this.postPass.uniforms;
    u.uTime.value = this.elapsed;
    u.uGlitch.value = fx.glitch;
    u.uDamageVignette.value = fx.damageVignette;
    u.uSandevistan.value = fx.sandevistan;
    u.uSoulkiller.value = fx.soulkiller;
    u.uBlackout.value = fx.blackout;
    u.uEyelids.value = fx.eyelids;
    u.uChromaticBoost.value = fx.chromaticBoost;

    this.bloomPass.strength = 0.30 + fx.soulkiller * 0.55 + fx.sandevistan * 0.16;
    this.composer.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.envRenderTarget.dispose();
    this.bloomPass.dispose();
    this.postPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
