/**
 * main.js — Three.js WebGPU entry point
 *
 * Light position coordinate system:
 *   xy = texture pixel space: mouse * vec2(tex.width, tex.height)
 *   z  = depth-space constant: 3.0  (above depth range [0,1])
 *
 * This matches DoverR's mixed coordinate system where
 * fragCoord.xy is in pixels but depth z is in [0,1].
 * Keeping z small ensures lightDir.xy >> lightDir.z so the
 * ray marches sideways across the image and samples real depth values.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DepthShaderMaterial } from './public/js/depth3.js';

// ─── Scene / Camera / Renderer ────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 5);

const renderer = new WebGPURenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// ─── Geometry — aspect matches cat image (832×1248) ──────────────────────────
const IMG_W = 832, IMG_H = 1248;
const planeH = 6.0;
const planeW = planeH * (IMG_W / IMG_H);
const planeGeometry = new THREE.PlaneGeometry(planeW, planeH);

// ─── State ────────────────────────────────────────────────────────────────────
const loader = new THREE.TextureLoader();
let shader   = null;

const mouse        = new THREE.Vector2(0.5, 0.5);
const targetShift  = new THREE.Vector2(0, 0);
const currentShift = new THREE.Vector2(0, 0);
const PARALLAX_SCALE  = 0.3;
const PARALLAX_SMOOTH = 0.06;

// Cached texture size — set once textures are loaded
let texW = 1333, texH = 2000;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    await renderer.init();

    const [diffuse, depth, background] = await Promise.all([
        loader.loadAsync('res/tex/diffuse.png'),
        loader.loadAsync('res/tex/depth.png'),
        loader.loadAsync('res/tex/bg_black.jpg'),
    ]).catch(err => { console.error('[depth3] texture load failed:', err); throw err; });

    shader = new DepthShaderMaterial();
    shader.setTextures(diffuse, depth, background);  // sets texSize from image

    // Cache tex dimensions for light position conversion
    texW = diffuse.image.width;
    texH = diffuse.image.height;

    const mat  = shader.createMaterial();
    const mesh = new THREE.Mesh(planeGeometry, mat);
    scene.add(mesh);

    await renderer.setAnimationLoop(animate);
    console.log(`[depth3] ready — texture ${texW}×${texH}`);
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function animate() {
    // Smooth parallax drift
    currentShift.lerp(targetShift, PARALLAX_SMOOTH);
    camera.position.x = currentShift.x;
    camera.position.y = currentShift.y;
    camera.lookAt(0, 0, 0);

    if (shader) {
        shader.updateCameraPosition(camera.position.x, camera.position.y, camera.position.z);
    }

    renderer.render(scene, camera);
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
window.addEventListener('mousemove', (e) => {
    mouse.set(
        e.clientX / window.innerWidth,
        1.0 - e.clientY / window.innerHeight  // flip Y: bottom=0, top=1
    );

    if (!shader) return;

    shader.updateMouse(mouse.x, mouse.y);

    // Light position:
    //   xy = texture pixel space (0..texW, 0..texH)
    //   z  = 3.0 (depth-space constant — do NOT scale by resolution)
    shader.updateLightPosition(
        mouse.x * texW,
        mouse.y * texH,
        3.0
    );

    // Parallax: camera drifts opposite to mouse
    targetShift.set(
        -(mouse.x - 0.5) * PARALLAX_SCALE,
         (mouse.y - 0.5) * PARALLAX_SCALE
    );
});

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Note: texSize is NOT updated on resize — it's the texture size, not screen size
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
