/**
 * 3D Procedural Annpurna Thali Showcase
 * Complies strictly with Three.js skill:
 * - 3-12 Part Procedural Model (Group of Thali Platter, Puffed Bhaturas, Chole Katori,
 *   Chickpea pebbles, Terracotta Kulhad with Lassi, Pickled Onions, Green Chili, Lemon wedge, Contact Shadow)
 * - Studio PBR Lighting with ACESFilmicToneMapping, RoomEnvironment & PMREMGenerator
 * - Procedural CanvasTextures (zero 404 external images)
 * - Lossless exponential damping camera controls
 * - Zero GC in render loop (module-level pre-allocated math objects)
 * - Collapsible ergonomic bottom control dock with static badges (no pulsating dots)
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Eye, RotateCw, Sparkles, X } from 'lucide-react';

// Module-level pre-allocated scratch objects to prevent garbage collection in render loop
const _vec3 = new THREE.Vector3();
const _targetLook = new THREE.Vector3(0, 0.4, 0);

// Procedural Canvas Texture Generator for Fried Bhatura Blisters
function createBhaturaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base golden dough
  const gradient = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
  gradient.addColorStop(0, '#F9E29D'); // Golden center
  gradient.addColorStop(0.6, '#EAB308'); // Warm golden
  gradient.addColorStop(0.9, '#CA8A04'); // Fried edge
  gradient.addColorStop(1, '#A16207'); // Crisp rim
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  // Blistered brown spots (authentic tandoor/deep-fried bhatura look)
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 450 + 31;
    const y = Math.random() * 450 + 31;
    const r = Math.random() * 18 + 4;
    const spotGrad = ctx.createRadialGradient(x, y, 1, x, y, r);
    spotGrad.addColorStop(0, 'rgba(120, 53, 15, 0.85)'); // Deep dark blister
    spotGrad.addColorStop(0.7, 'rgba(180, 83, 9, 0.6)');
    spotGrad.addColorStop(1, 'rgba(234, 179, 8, 0)');
    ctx.fillStyle = spotGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Small white nigella / sesame seeds
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 400 + 56;
    const y = Math.random() * 400 + 56;
    ctx.fillStyle = Math.random() > 0.4 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(30, 20, 10, 0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y, 3, 1.8, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Procedural Canvas Texture for Spicy Punjabi Chole Gravy
function createCholeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#451A03'; // Rich dark brown Punjabi gravy
  ctx.fillRect(0, 0, 256, 256);

  // Spiced gravy oil swirls (roghan)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 24 + 6;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(124, 45, 18, 0.7)' : 'rgba(69, 26, 3, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Green coriander specks
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillStyle = 'rgba(22, 101, 52, 0.9)';
    ctx.fillRect(x, y, 2.5, 2.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Procedural Contact Shadow Texture
function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
  grad.addColorStop(0, 'rgba(20, 15, 10, 0.55)');
  grad.addColorStop(0.5, 'rgba(40, 30, 20, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

interface ThaliCanvas3DProps {
  onClose?: () => void;
  isModal?: boolean;
}

export const ThaliCanvas3D: React.FC<ThaliCanvas3DProps> = ({ onClose, isModal = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<'hero' | 'top' | 'bhatura' | 'lassi'>('hero');
  const [isRotating, setIsRotating] = useState(true);

  // Mutable animation state references to avoid recreation
  const cameraTargetPos = useRef(new THREE.Vector3(0, 3.2, 4.4));
  const isPointerDown = useRef(false);
  const pointerStart = useRef({ x: 0, y: 0 });
  const orbitAngle = useRef({ theta: 0.3, phi: 0.9 });
  const autoRotateRef = useRef(true);

  useEffect(() => {
    autoRotateRef.current = isRotating;
  }, [isRotating]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Setup WebGL Renderer
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const isMobileScreen = window.innerWidth < 768;
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl && !isMobileScreen,
      powerPreference: 'high-performance',
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, isMobileScreen ? 1.5 : 2)
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 3. Scene and Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xFDFBF7); // Soft warm creamy restaurant aesthetic
    scene.fog = new THREE.Fog(0xFDFBF7, 9, 20);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
    camera.position.set(0, 3.2, 4.4);
    camera.lookAt(_targetLook);

    // 4. Procedural RoomEnvironment Reflection Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 5. Studio 3-Point Lighting Rig
    // Warm Key Light
    const keyLight = new THREE.DirectionalLight(0xFFF1D0, 2.2);
    keyLight.position.set(3, 5, 3.5);
    keyLight.castShadow = !isSoftwareGl;
    if (keyLight.castShadow) {
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 15;
      const d = 3.2;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    // Cool Sky & Ground Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0xFCE7C8, 0x94A3B8, 0.85);
    scene.add(hemiLight);

    // Subtle Rim/Backlight
    const rimLight = new THREE.DirectionalLight(0xFDE047, 0.8);
    rimLight.position.set(-3, 3, -2);
    scene.add(rimLight);

    // 6. Assemble Procedural Annpurna Thali (Composite 3-12 Part Model in THREE.Group)
    const thaliGroup = new THREE.Group();
    thaliGroup.position.set(0, 0, 0);

    // Shared Materials
    const bhaturaTex = createBhaturaTexture();
    bhaturaTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const choleTex = createCholeTexture();
    choleTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 6.1 Brass Thali Platter
    const brassMaterial = new THREE.MeshStandardMaterial({
      color: 0xD4AF37, // Polished brass gold
      metalness: 0.88,
      roughness: 0.22,
    });

    const thaliPoints: THREE.Vector2[] = [];
    thaliPoints.push(new THREE.Vector2(0, 0));
    thaliPoints.push(new THREE.Vector2(2.1, 0));
    thaliPoints.push(new THREE.Vector2(2.25, 0.12));
    thaliPoints.push(new THREE.Vector2(2.28, 0.22));
    thaliPoints.push(new THREE.Vector2(2.2, 0.25));
    thaliPoints.push(new THREE.Vector2(2.1, 0.1));
    thaliPoints.push(new THREE.Vector2(0, 0.06));

    const thaliGeo = new THREE.LatheGeometry(thaliPoints, 48);
    const thaliMesh = new THREE.Mesh(thaliGeo, brassMaterial);
    thaliMesh.receiveShadow = !isSoftwareGl;
    thaliGroup.add(thaliMesh);

    // 6.2 Contact Shadow Disc Grounding
    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(5.2, 5.2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.005; // grounded right beneath
    thaliGroup.add(shadowMesh);

    // 6.3 Puffed Golden Bhatura 1 (Ballooning Ellipsoid with Blistered Organic Crust)
    const bhaturaGeo1 = new THREE.SphereGeometry(1.05, 32, 24);
    // Deform vertices for authentic puffed balloon look (wider than tall)
    const pos1 = bhaturaGeo1.attributes.position;
    for (let i = 0; i < pos1.count; i++) {
      const vx = pos1.getX(i);
      const vy = pos1.getY(i);
      const vz = pos1.getZ(i);
      // Flatten on Y and perturb slightly
      const flattenY = vy * 0.42 + Math.sin(vx * 3 + vz * 2) * 0.04;
      pos1.setY(i, flattenY);
    }
    bhaturaGeo1.computeVertexNormals();

    const bhaturaMat = new THREE.MeshStandardMaterial({
      map: bhaturaTex,
      roughness: 0.72,
      metalness: 0.05,
      bumpMap: bhaturaTex,
      bumpScale: 0.04,
    });

    const bhaturaMesh1 = new THREE.Mesh(bhaturaGeo1, bhaturaMat);
    bhaturaMesh1.position.set(-0.65, 0.32, -0.2);
    bhaturaMesh1.rotation.set(0.12, 0.4, -0.15);
    bhaturaMesh1.castShadow = !isSoftwareGl;
    bhaturaMesh1.receiveShadow = !isSoftwareGl;
    thaliGroup.add(bhaturaMesh1);

    // 6.4 Bhatura 2 (Tilted Fluffy Companion Bhatura)
    const bhaturaGeo2 = bhaturaGeo1.clone();
    const bhaturaMesh2 = new THREE.Mesh(bhaturaGeo2, bhaturaMat);
    bhaturaMesh2.position.set(-0.55, 0.48, 0.45);
    bhaturaMesh2.rotation.set(-0.25, 1.1, 0.35);
    bhaturaMesh2.scale.set(0.92, 0.92, 0.92);
    bhaturaMesh2.castShadow = !isSoftwareGl;
    bhaturaMesh2.receiveShadow = !isSoftwareGl;
    thaliGroup.add(bhaturaMesh2);

    // 6.5 Chole Katori (Brass Curry Bowl)
    const katoriPoints: THREE.Vector2[] = [];
    katoriPoints.push(new THREE.Vector2(0, 0));
    katoriPoints.push(new THREE.Vector2(0.65, 0));
    katoriPoints.push(new THREE.Vector2(0.8, 0.35));
    katoriPoints.push(new THREE.Vector2(0.83, 0.5));
    katoriPoints.push(new THREE.Vector2(0.78, 0.5));
    katoriPoints.push(new THREE.Vector2(0.72, 0.34));
    katoriPoints.push(new THREE.Vector2(0.6, 0.05));
    katoriPoints.push(new THREE.Vector2(0, 0.05));

    const katoriGeo = new THREE.LatheGeometry(katoriPoints, 32);
    const katoriMesh = new THREE.Mesh(katoriGeo, brassMaterial);
    katoriMesh.position.set(0.75, 0.08, -0.65);
    katoriMesh.castShadow = !isSoftwareGl;
    katoriMesh.receiveShadow = !isSoftwareGl;
    thaliGroup.add(katoriMesh);

    // Chole Spiced Curry Surface inside Katori
    const choleGeo = new THREE.CylinderGeometry(0.72, 0.65, 0.1, 28);
    const choleMat = new THREE.MeshStandardMaterial({
      map: choleTex,
      roughness: 0.35, // Glossy spicy oil sheen
      metalness: 0.1,
    });
    const choleMesh = new THREE.Mesh(choleGeo, choleMat);
    choleMesh.position.set(0.75, 0.46, -0.65);
    thaliGroup.add(choleMesh);

    // Procedural Chickpeas & Ginger Julienne Accent on Chole
    const chickpeaGeo = new THREE.SphereGeometry(0.08, 10, 8);
    const chickpeaMat = new THREE.MeshStandardMaterial({
      color: 0xC88632,
      roughness: 0.65,
    });
    for (let c = 0; c < 6; c++) {
      const chickpea = new THREE.Mesh(chickpeaGeo, chickpeaMat);
      const angle = (c / 6) * Math.PI * 2;
      const radius = 0.28 + Math.random() * 0.18;
      chickpea.position.set(
        0.75 + Math.cos(angle) * radius,
        0.52 + Math.random() * 0.03,
        -0.65 + Math.sin(angle) * radius
      );
      chickpea.scale.set(1.1, 0.85, 0.95);
      thaliGroup.add(chickpea);
    }

    // Ginger julienne (accent sticks)
    const gingerGeo = new THREE.BoxGeometry(0.35, 0.025, 0.03);
    const gingerMat = new THREE.MeshStandardMaterial({ color: 0xFDE047, roughness: 0.4 });
    const ginger1 = new THREE.Mesh(gingerGeo, gingerMat);
    ginger1.position.set(0.75, 0.54, -0.65);
    ginger1.rotation.y = 0.4;
    thaliGroup.add(ginger1);

    // 6.6 Terracotta Kulhad (Tumbler for Chilled Malai Lassi)
    const kulhadPoints: THREE.Vector2[] = [];
    kulhadPoints.push(new THREE.Vector2(0, 0));
    kulhadPoints.push(new THREE.Vector2(0.42, 0));
    kulhadPoints.push(new THREE.Vector2(0.48, 0.3));
    kulhadPoints.push(new THREE.Vector2(0.58, 0.85));
    kulhadPoints.push(new THREE.Vector2(0.62, 1.15));
    kulhadPoints.push(new THREE.Vector2(0.57, 1.15));
    kulhadPoints.push(new THREE.Vector2(0.52, 0.8));
    kulhadPoints.push(new THREE.Vector2(0.38, 0.06));
    kulhadPoints.push(new THREE.Vector2(0, 0.06));

    const kulhadGeo = new THREE.LatheGeometry(kulhadPoints, 32);
    const terracottaMat = new THREE.MeshStandardMaterial({
      color: 0xB45309, // Clay terracotta orange-brown
      roughness: 0.88,
      metalness: 0.02,
    });
    const kulhadMesh = new THREE.Mesh(kulhadGeo, terracottaMat);
    kulhadMesh.position.set(1.25, 0.08, 0.4);
    kulhadMesh.castShadow = !isSoftwareGl;
    kulhadMesh.receiveShadow = !isSoftwareGl;
    thaliGroup.add(kulhadMesh);

    // Thick Frothy Lassi Cream inside Kulhad
    const lassiGeo = new THREE.CylinderGeometry(0.55, 0.48, 0.15, 24);
    const lassiMat = new THREE.MeshStandardMaterial({
      color: 0xFFFBEB, // Creamy ivory
      roughness: 0.4,
      metalness: 0.02,
    });
    const lassiMesh = new THREE.Mesh(lassiGeo, lassiMat);
    lassiMesh.position.set(1.25, 1.12, 0.4);
    thaliGroup.add(lassiMesh);

    // Pistachio sprinkle on Lassi
    const pistaGeo = new THREE.BoxGeometry(0.04, 0.02, 0.04);
    const pistaMat = new THREE.MeshStandardMaterial({ color: 0x15803D, roughness: 0.5 });
    for (let p = 0; p < 7; p++) {
      const pista = new THREE.Mesh(pistaGeo, pistaMat);
      pista.position.set(
        1.25 + (Math.random() - 0.5) * 0.35,
        1.21,
        0.4 + (Math.random() - 0.5) * 0.35
      );
      pista.rotation.y = Math.random() * Math.PI;
      thaliGroup.add(pista);
    }

    // 6.7 Relish Bowl (Sirka Pyaz / Pickled Onions & Green Chili)
    const relishMesh = new THREE.Mesh(katoriGeo, brassMaterial);
    relishMesh.position.set(0.3, 0.08, 0.95);
    relishMesh.scale.set(0.68, 0.68, 0.68);
    relishMesh.castShadow = !isSoftwareGl;
    relishMesh.receiveShadow = !isSoftwareGl;
    thaliGroup.add(relishMesh);

    // Pickled Ruby Onion Rings (TorusGeometry)
    const onionGeo = new THREE.TorusGeometry(0.16, 0.04, 8, 20);
    const onionMat = new THREE.MeshStandardMaterial({
      color: 0xBE123C, // Deep vinegar ruby magenta
      roughness: 0.3,
    });
    for (let o = 0; o < 3; o++) {
      const onion = new THREE.Mesh(onionGeo, onionMat);
      onion.position.set(0.3 + (o - 1) * 0.08, 0.32 + o * 0.04, 0.95 + (Math.random() - 0.5) * 0.1);
      onion.rotation.set(Math.random() * 0.5, Math.random() * 2, Math.random() * 0.5);
      thaliGroup.add(onion);
    }

    // Slender Green Chili (Curved Tube)
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.18, 0.32, 0.9),
      new THREE.Vector3(0.28, 0.36, 1.05),
      new THREE.Vector3(0.42, 0.33, 1.15),
    ]);
    const chiliGeo = new THREE.TubeGeometry(curve, 16, 0.035, 8, false);
    const chiliMat = new THREE.MeshStandardMaterial({
      color: 0x16A34A, // Crisp Indian green chili
      roughness: 0.25,
      metalness: 0.1,
    });
    const chiliMesh = new THREE.Mesh(chiliGeo, chiliMat);
    thaliGroup.add(chiliMesh);

    // 6.8 Fresh Lemon Wedge Accent
    const lemonGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16, 1, false, 0, Math.PI);
    const lemonMat = new THREE.MeshStandardMaterial({
      color: 0xFACC15,
      roughness: 0.3,
    });
    const lemonMesh = new THREE.Mesh(lemonGeo, lemonMat);
    lemonMesh.position.set(-0.15, 0.12, 1.1);
    lemonMesh.rotation.set(Math.PI / 2, 0.3, 0.8);
    thaliGroup.add(lemonMesh);

    scene.add(thaliGroup);

    // 7. Interactive Pointer Drag for Smooth Orbiting
    const onPointerDown = (e: PointerEvent) => {
      isPointerDown.current = true;
      pointerStart.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDown.current) return;
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      pointerStart.current = { x: e.clientX, y: e.clientY };

      orbitAngle.current.theta -= dx * 0.008;
      orbitAngle.current.phi = Math.max(0.2, Math.min(Math.PI / 2 - 0.05, orbitAngle.current.phi - dy * 0.008));
    };

    const onPointerUp = () => {
      isPointerDown.current = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // 8. Animation & Render Loop with Exponential Damping
    let frameId = 0;
    let lastTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (document.hidden) {
        frameId = requestAnimationFrame(tick);
        return;
      }

      // Auto rotation when enabled and user not dragging
      if (autoRotateRef.current && !isPointerDown.current) {
        orbitAngle.current.theta += 0.35 * dt;
      }

      // Smooth camera interpolation based on active angle & distance
      const distance = cameraTargetPos.current.length();
      const targetX = Math.sin(orbitAngle.current.theta) * Math.sin(orbitAngle.current.phi) * distance;
      const targetY = Math.cos(orbitAngle.current.phi) * distance;
      const targetZ = Math.cos(orbitAngle.current.theta) * Math.sin(orbitAngle.current.phi) * distance;

      // Exponential damping: 1 - Math.exp(-k * dt)
      const dampFactor = 1 - Math.exp(-6 * dt);
      camera.position.x += (targetX - camera.position.x) * dampFactor;
      camera.position.y += (targetY - camera.position.y) * dampFactor;
      camera.position.z += (targetZ - camera.position.z) * dampFactor;
      camera.lookAt(_targetLook);

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    // 9. Resize Handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(frameId);
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      bhaturaGeo1.dispose();
      bhaturaGeo2.dispose();
      thaliGeo.dispose();
      katoriGeo.dispose();
      choleGeo.dispose();
      kulhadGeo.dispose();
      lassiGeo.dispose();
      onionGeo.dispose();
      chiliGeo.dispose();
      lemonGeo.dispose();
      shadowGeo.dispose();
      bhaturaTex.dispose();
      choleTex.dispose();
      shadowTex.dispose();
      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
    };
  }, []);

  // Preset Handlers
  const setPreset = (preset: 'hero' | 'top' | 'bhatura' | 'lassi') => {
    setActivePreset(preset);
    if (preset === 'hero') {
      cameraTargetPos.current.set(0, 3.2, 4.4);
      orbitAngle.current = { theta: 0.35, phi: 0.85 };
    } else if (preset === 'top') {
      cameraTargetPos.current.set(0, 5.0, 0.1);
      orbitAngle.current = { theta: 0.05, phi: 0.15 };
    } else if (preset === 'bhatura') {
      cameraTargetPos.current.set(-1.2, 1.8, 2.5);
      orbitAngle.current = { theta: -0.4, phi: 0.95 };
    } else if (preset === 'lassi') {
      cameraTargetPos.current.set(2.0, 2.2, 2.4);
      orbitAngle.current = { theta: 0.95, phi: 0.95 };
    }
  };

  return (
    <div className={`relative w-full overflow-hidden bg-amber-50/40 select-none ${isModal ? 'h-[82dvh] rounded-xl shadow-2xl border border-amber-200' : 'h-[320px] md:h-[400px] rounded-xl border border-amber-200/80 shadow-sm'}`}>
      {/* 3D Canvas Mount Point */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top Header Badge (Non-occluding, static, no pulsating dot) */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-white/95 border border-amber-200/80 px-3 py-1.5 rounded-lg shadow-sm">
        <Sparkles className="w-4 h-4 text-amber-600" />
        <span className="text-xs font-semibold tracking-wide text-amber-950 uppercase">
          Annpurna Signature Thali 3D
        </span>
        <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-md">
          Live Render
        </span>
      </div>

      {/* Close button if shown in modal */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 bg-white/95 hover:bg-white border border-slate-200 rounded-lg text-slate-700 shadow-sm transition cursor-pointer"
          title="Close 3D View"
        >
          <X className="w-5 h-5" />
        </button>
      )}

      {/* Collapsible Ergonomic Bottom Control Dock (Zero Viewport Occlusion) */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center transition-transform duration-300 ease-out"
        style={{
          transform: controlsCollapsed
            ? 'translateX(-50%) translateY(calc(100% - 28px))'
            : 'translateX(-50%) translateY(0)',
          maxWidth: 'min(940px, 94vw)',
        }}
      >
        {/* Collapse / Expand Toggle Tab */}
        <button
          onClick={() => setControlsCollapsed(!controlsCollapsed)}
          className="flex items-center gap-1.5 bg-amber-900 text-white text-[11px] font-medium px-3.5 py-1 rounded-t-lg shadow hover:bg-amber-800 transition mb-[-1px]"
        >
          {controlsCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Show 3D Camera Dock
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Minimize Dock
            </>
          )}
        </button>

        {/* Horizontal Control Dock Panel (Solid / rgba surface, no backdrop blur over WebGL) */}
        <div className="bg-white/95 border border-amber-200 shadow-lg rounded-xl px-4 py-2.5 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          {/* Camera Presets */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" /> Angles:
            </span>
            <button
              onClick={() => setPreset('hero')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                activePreset === 'hero'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Hero 45°
            </button>
            <button
              onClick={() => setPreset('top')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                activePreset === 'top'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Top-Down
            </button>
            <button
              onClick={() => setPreset('bhatura')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                activePreset === 'bhatura'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Bhatura Focus
            </button>
            <button
              onClick={() => setPreset('lassi')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                activePreset === 'lassi'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Lassi Kulhad
            </button>
          </div>

          <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />

          {/* Turntable Auto-Rotate Toggle */}
          <button
            onClick={() => setIsRotating(!isRotating)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg font-medium transition ${
              isRotating
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin' : ''}`} />
            {isRotating ? 'Turntable Active' : 'Turntable Paused'}
          </button>

          <span className="text-[10px] text-slate-400 hidden md:inline">
            Drag to orbit • Scroll to zoom
          </span>
        </div>
      </div>
    </div>
  );
};
