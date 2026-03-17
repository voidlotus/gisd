/**
 * depth3.js — depth-aware 2.5D shader (Three.js WebGPU / TSL)
 *
 * Shadow ported from DoverR.txt — verified correct by full numerical trace.
 *
 * Coordinate system (must be consistent throughout):
 *   fragCoord.xy  = uvP * texSize   (TEXTURE pixel space, not screen pixels)
 *   lightPos.xy   = mouse * texSize (same texture pixel space)
 *   lightPos.z    = 3.0             (depth-space, just above surface [0,1])
 *   shaderPoint.z = (1+d)*depth - d (DoverR formula, depth in [0,1])
 *   sUV           = pos.xy / texSize (back to [0,1] for texture sample)
 *
 * Bug history:
 *   v1 — ray in 2D UV space → lightDir.z≈0.92, shadow invisible
 *   v2 — lightPos.z = res_y*0.5 = 1000 → pos.z exits [0,1] after 0.1 steps
 *   v3 — resolution = screen size (1920×1080) not texture size (1333×2000)
 *        → aspect distortion, texelSize wrong, normalFromDepth broken
 *   v4 (this) — texSize = texture pixel dimensions, fixed throughout
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    texture,
    uv,
    uniform,
    vec2,
    vec3,
    vec4,
    float,
    int,
    mul,
    add,
    sub,
    div,
    dot,
    pow,
    clamp,
    mix,
    normalize,
    sqrt,
    sin,
    cos,
    negate,
    select,
    Loop,
    Fn,
} from 'three/tsl';

// ─── TSL helpers ──────────────────────────────────────────────────────────────

const remap01 = Fn(([a, b, x]) =>
    clamp(div(sub(x, a), sub(b, a)), float(0.0), float(1.0))
);

/**
 * Surface normal from depth map via central differences.
 * texelSize = vec2(1/texWidth, 1/texHeight).
 * z=0.3 gives visible tilt for diffuse shading on a smooth AI-estimated depth map.
 */
const normalFromDepth = Fn(([depthTex, uvCoord, texelSize]) => {
    const dR = texture(depthTex, add(uvCoord, vec2(texelSize.x, float(0.0)))).r;
    const dL = texture(depthTex, sub(uvCoord, vec2(texelSize.x, float(0.0)))).r;
    const dU = texture(depthTex, add(uvCoord, vec2(float(0.0),  texelSize.y))).r;
    const dD = texture(depthTex, sub(uvCoord, vec2(float(0.0),  texelSize.y))).r;
    const dzdx = mul(sub(dR, dL), float(0.5));
    const dzdy = mul(sub(dU, dD), float(0.5));
    return normalize(vec3(negate(dzdx), negate(dzdy), float(0.3)));
});

// ─── Main class ───────────────────────────────────────────────────────────────

export class DepthShaderMaterial {
    constructor() {
        this.mousePos = uniform(new THREE.Vector2(0.5, 0.5));

        // TEXTURE pixel dimensions — set from loaded texture in setTextures()
        // Used for: fragCoord, sUV, texelSize, lightPos mapping
        // Must NOT be screen/window size
        this.texSize  = uniform(new THREE.Vector2(1333, 2000));

        // lightPos.xy = texture pixel coords (0..texWidth, 0..texHeight)
        // lightPos.z  = depth-space value, slightly above surface max (1.0)
        //               3.0 keeps lightDir.z small → ray travels sideways ✓
        this.lightPos    = uniform(new THREE.Vector3(666, 1000, 3.0));
        this.cameraShift = uniform(new THREE.Vector2(0.0, 0.0));

        this.uParallaxStrength = uniform(0.06);
        this.uShadowStrength   = uniform(0.65);
        this.uAOStrength       = uniform(0.50);
        this.uSSSStrength      = uniform(0.40);
        this.uRimStrength      = uniform(0.50);
        this.uReflStrength     = uniform(0.06);
        this.uDOFStrength      = uniform(0.0);
        this.uLightColor       = uniform(new THREE.Color(1.0, 0.92, 0.75));
        this.uSSSColor         = uniform(new THREE.Color(1.0, 0.35, 0.15));
        this.uEnvColor         = uniform(new THREE.Color(0.12, 0.14, 0.22));
    }

    setTextures(diffuse, depth, background) {
        this.diffuseTex    = diffuse;
        this.depthTex      = depth;
        this.backgroundTex = background;

        // Pull real pixel dimensions from the loaded image
        const w = diffuse.image.width;
        const h = diffuse.image.height;
        this.texSize.value.set(w, h);

        // Default light = horizontal centre, top-third, above surface
        this.lightPos.value.set(w * 0.5, h * 0.3, 3.0);
    }

    createShader() {
        const {
            diffuseTex, depthTex, backgroundTex,
            mousePos, texSize, lightPos, cameraShift,
            uParallaxStrength, uShadowStrength, uAOStrength,
            uSSSStrength, uRimStrength, uReflStrength, uDOFStrength,
            uLightColor, uSSSColor, uEnvColor,
        } = this;

        return Fn(() => {
            // texelSize = one texture pixel in [0,1] UV space
            const texelSize = div(vec2(1.0, 1.0), texSize);
            const uvRaw     = uv();

            // ── 1. Parallax ──────────────────────────────────────────────────
            const depthRaw = texture(depthTex, uvRaw).r;
            const uvP      = clamp(
                add(uvRaw, mul(cameraShift, mul(depthRaw, uParallaxStrength))),
                vec2(0.0), vec2(1.0)
            );

            const depth      = texture(depthTex,   uvP).r;
            const diffuse    = texture(diffuseTex, uvP);
            const objectMask = diffuse.a;   // 1 = cat, 0 = transparent background

            // ── Surface normal ───────────────────────────────────────────────
            const N = normalFromDepth(depthTex, uvP, texelSize);

            // ── shaderPoint in DoverR mixed coordinate space ─────────────────
            // xy = texture pixel space,  z = depth [0,1] via (1+d)*h - d
            // lightPos.xy is also texture pixel space (set in updateLightPosition)
            // lightDir.xy >> lightDir.z  →  ray travels sideways across image ✓
            const d = float(0.5);   // DoverR: const float d = 0.5

            const fragCoord    = mul(uvP, texSize);                            // tex pixels
            const shaderPointZ = sub(mul(add(float(1.0), d), depth), d);       // DoverR formula
            const shaderPoint  = vec3(fragCoord, shaderPointZ);
            const lightDir     = normalize(sub(lightPos, shaderPoint));
            const NdotL        = clamp(dot(N, lightDir), float(0.0), float(1.0));

            // ── 2. Shadow — DoverR exact ─────────────────────────────────────
            // for i in 0..99:
            //   pos = shaderPoint + (i+1)*d*a*lightDir
            //   sUV = pos.xy / texSize
            //   H   = depthMap(sUV)
            //   if H > pos.z: R += d
            // tShadow = clamp(2 * pow(d/R, 0.45), 0, 1)
            const a       = float(5.0);
            const shadowN = int(100);
            const R       = d.toVar();  // starts at d (not 0) — prevents d/0

            Loop(shadowN, ({ i }) => {
                const stepF = add(float(i), float(1.0));
                const pos   = add(shaderPoint, mul(mul(mul(stepF, d), a), lightDir));
                const sUV   = clamp(div(pos.xy, texSize), vec2(0.0), vec2(1.0));
                const H     = texture(depthTex, sUV).r;
                R.addAssign(select(H.greaterThan(pos.z), d, float(0.0)));
            });

            const tShadow = clamp(
                mul(float(2.0), pow(div(d, R), float(0.45))),
                float(0.0), float(1.0)
            );

            // ── 3. AO ────────────────────────────────────────────────────────
            const aoRadius = mul(texelSize, float(6.0));
            const aoAcc    = float(0.0).toVar();
            Loop(int(8), ({ i }) => {
                const angle  = mul(float(i), float(0.7854));  // π/4 increments
                const sUV    = clamp(
                    add(uvP, mul(vec2(cos(angle), sin(angle)), aoRadius)),
                    vec2(0.0), vec2(1.0)
                );
                aoAcc.addAssign(clamp(sub(texture(depthTex, sUV).r, depth), float(0.0), float(1.0)));
            });
            const aoFactor = sub(float(1.0),
                mul(clamp(div(aoAcc, float(8.0)), float(0.0), float(1.0)), uAOStrength)
            );

            // ── 4. SSS — DoverR: W=pow(dif,10), glow on shadow side ──────────
            const dif      = clamp(
                add(mul(float(0.5), dot(lightDir, N)), float(0.5)),
                float(0.0), float(1.0)
            );
            const W        = pow(dif, float(10.0));
            const sssColor = mul(uSSSColor,
                mul(W, mul(sub(float(1.0), tShadow), uSSSStrength))
            );

            // ── 5. Rim ───────────────────────────────────────────────────────
            const dR2 = texture(depthTex, add(uvP, vec2(texelSize.x, float(0.0)))).r;
            const dL2 = texture(depthTex, sub(uvP, vec2(texelSize.x, float(0.0)))).r;
            const dU2 = texture(depthTex, add(uvP, vec2(float(0.0),  texelSize.y))).r;
            const dD2 = texture(depthTex, sub(uvP, vec2(float(0.0),  texelSize.y))).r;
            const rimFactor = mul(
                clamp(
                    sqrt(add(pow(sub(dR2, dL2), float(2.0)), pow(sub(dU2, dD2), float(2.0)))),
                    float(0.0), float(1.0)
                ),
                uRimStrength
            );

            // ── 6. Reflection ────────────────────────────────────────────────
            const reflDir   = normalize(
                sub(mul(mul(float(2.0), dot(N, lightDir)), N), lightDir)
            );
            const reflColor = texture(backgroundTex,
                clamp(add(uvP, mul(reflDir.xy, uReflStrength)), vec2(0.0), vec2(1.0))
            ).xyz;

            // ── 7. Background + DoF ──────────────────────────────────────────
            const bgSharp = texture(backgroundTex, uvP).xyz;
            const bgBlur  = div(
                add(add(add(add(
                    bgSharp,
                    texture(backgroundTex, add(uvP, vec2(uDOFStrength, float(0.0)))).xyz),
                    texture(backgroundTex, sub(uvP, vec2(uDOFStrength, float(0.0)))).xyz),
                    texture(backgroundTex, add(uvP, vec2(float(0.0),   uDOFStrength))).xyz),
                    texture(backgroundTex, sub(uvP, vec2(float(0.0),   uDOFStrength))).xyz),
                float(5.0)
            );
            const bgFinal = mix(bgBlur, bgSharp, remap01(float(0.0), float(0.4), depth));

            // ── Composite — DoverR: dark*(1-t) + light*t ─────────────────────
            const ambient   = mul(uEnvColor, float(0.25));
            const darkSide  = mul(diffuse.xyz, ambient);
            const lightSide = mul(diffuse.xyz, add(ambient, mul(uLightColor, dif)));
            const baseColor = add(
                mul(darkSide,  sub(float(1.0), tShadow)),
                mul(lightSide, tShadow)
            );

            const withAO   = mul(baseColor, aoFactor);
            const withSSS  = add(withAO,   sssColor);
            const withRim  = add(withSSS,  mul(uLightColor, rimFactor));
            const withRefl = mix(withRim,  add(withRim, reflColor), float(0.12));

            // return vec4(mix(bgFinal, withRefl, objectMask), float(1.0));

            // Apply tShadow to background too — makes the cat cast shadow onto the scene.
            // tShadow is already correctly computed for bg pixels: the ray marches
            // from the bg pixel toward the light and hits the cat body → occluded → dark.
            // Previously bgFinal was passed raw, so all shadow computation on bg was wasted.
            const bgShadowed = mul(bgFinal, tShadow);

            // bg pixel  (mask=0) → bgShadowed  (background darkened by cat shadow)
            // cat pixel (mask=1) → withRefl     (self-shadowed cat surface, unchanged)
            return vec4(mix(bgShadowed, withRefl, objectMask), float(1.0));
        });
    }

    createMaterial() {
        const mat       = new MeshBasicNodeMaterial();
        mat.colorNode   = this.createShader()();
        mat.transparent = true;
        mat.depthWrite  = false;
        return mat;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    // x, y must be in TEXTURE pixel space: mouse.x * tex.width, mouse.y * tex.height
    // z must be depth-space: 3.0 default (small value above depth range [0..1])
    updateLightPosition(x, y, z) { this.lightPos.value.set(x, y, z); }

    updateCameraPosition(x, y, _z) {
        this.cameraShift.value.set(x * 0.04, y * 0.04);
    }

    updateMouse(x, y) { this.mousePos.value.set(x, y); }

    setParallax(v) { this.uParallaxStrength.value = v; }
    setShadow(v)   { this.uShadowStrength.value   = v; }
    setAO(v)       { this.uAOStrength.value        = v; }
    setSSS(v)      { this.uSSSStrength.value       = v; }
    setRim(v)      { this.uRimStrength.value       = v; }
    setRefl(v)     { this.uReflStrength.value      = v; }
    setDOF(v)      { this.uDOFStrength.value       = v; }
}
