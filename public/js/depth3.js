/**
 * depth3.js — depth-aware 2.5D shader with glass material
 *
 * Integrates reflection3.js glass pipeline into the DoverR depth-shadow system:
 *
 *   Shadow    — DoverR height-field ray march (100 steps, pixel space)
 *   AO        — 8-sample ring in depth space
 *   SSS       — DoverR W=pow(dif,10) forward scatter
 *   Rim       — depth gradient silhouette highlight
 *   Glass     — reflection3.js pipeline:
 *                 viewDir  from cameraPos (correct for 2.5D plane)
 *                 reflDir  = reflect(viewDir, N)       ← VIEW reflection, not light
 *                 refractDir = refract(viewDir, N, eta) with TIR fallback
 *                 Fresnel  = Schlick (n1=1, n2=IOR)
 *                 fresnelMix = Fresnel*reflColor + (1-Fresnel)*refractColor
 *                 KtAlpha  = luma(diffuse) → opaque where fur is bright, glass where dark
 *                 catColor = mix(glassColor, litSurface, KtAlpha * (1-uGlassStrength))
 *
 * Coordinate notes:
 *   fragCoord.xy  = uvP * texSize  (texture pixel space for DoverR shadow march)
 *   lightPos.xy   = mouse * texSize
 *   lightPos.z    = 3.0 (depth-space, above [0,1] range)
 *   reflDir/refractDir operate in view space (z=forward toward camera)
 *   UV warp = dir.xy / |dir.z| * strength  (perspective-correct screen-space lookup)
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
    abs,
    clamp,
    mix,
    normalize,
    max,
    sqrt,
    sin,
    cos,
    negate,
    select,
    Loop,
    Fn,
    positionWorld,
} from 'three/tsl';

// ─── TSL helpers ──────────────────────────────────────────────────────────────

const remap01 = Fn(([a, b, x]) =>
    clamp(div(sub(x, a), sub(b, a)), float(0.0), float(1.0))
);

/** Surface normal from depth map — central differences, z=0.3 for visible tilt */
const normalFromDepth = Fn(([depthTex, uvCoord, texelSize]) => {
    const dR = texture(depthTex, add(uvCoord, vec2(texelSize.x, float(0.0)))).r;
    const dL = texture(depthTex, sub(uvCoord, vec2(texelSize.x, float(0.0)))).r;
    const dU = texture(depthTex, add(uvCoord, vec2(float(0.0),  texelSize.y))).r;
    const dD = texture(depthTex, sub(uvCoord, vec2(float(0.0),  texelSize.y))).r;
    return normalize(vec3(
        negate(mul(sub(dR, dL), float(0.5))),
        negate(mul(sub(dU, dD), float(0.5))),
        float(0.3)
    ));
});

/**
 * Schlick Fresnel — ported verbatim from reflection3.js
 * n1 = IOR of incident medium (air = 1.0)
 * n2 = IOR of surface medium  (glass ≈ 1.5)
 * normal   = surface normal (toward camera)
 * incident = incident ray direction (toward surface = -viewDir)
 */
const fresnelSchlick = Fn(([n1, n2, normal, incident]) => {
    const r0raw  = div(sub(n1, n2), add(n1, n2));
    const r0     = mul(r0raw, r0raw);
    const cosX   = negate(dot(normal, incident));          // = dot(N, viewDir)
    const eta    = div(n1, n2);
    const sinT2  = mul(mul(eta, eta), sub(float(1.0), mul(cosX, cosX)));
    const isTIR  = sinT2.greaterThan(float(1.0));
    const cosXt  = sqrt(clamp(sub(float(1.0), sinT2), float(0.0), float(1.0)));
    const n1GtN2 = n1.greaterThan(n2);
    const cosEff = select(n1GtN2, cosXt, cosX);
    const x      = sub(float(1.0), cosEff);
    const schlick = add(r0, mul(sub(float(1.0), r0), pow(x, float(5.0))));
    return select(n1GtN2.and(isTIR), float(1.0), schlick);
});

// ─── Main class ───────────────────────────────────────────────────────────────

export class DepthShaderMaterial {
    constructor() {
        this.mousePos = uniform(new THREE.Vector2(0.5, 0.5));

        // Texture pixel dimensions — set from image in setTextures()
        this.texSize  = uniform(new THREE.Vector2(1333, 2000));

        // lightPos: xy = texture pixel space, z = depth-space (~3.0)
        this.lightPos    = uniform(new THREE.Vector3(666, 1000, 3.0));

        // cameraPos: Three.js world space (plane at z=0, camera default at z=5)
        // Used to compute viewDir for reflection/refraction
        this.cameraPos   = uniform(new THREE.Vector3(0.0, 0.0, 5.0));

        this.cameraShift = uniform(new THREE.Vector2(0.0, 0.0));

        // ── Depth / shadow / lighting ──
        this.uParallaxStrength = uniform(0.06);
        this.uShadowStrength   = uniform(0.65);
        this.uAOStrength       = uniform(0.50);
        this.uSSSStrength      = uniform(0.40);
        this.uRimStrength      = uniform(0.50);
        this.uDOFStrength      = uniform(0.0);
        this.uLightColor       = uniform(new THREE.Color(1.0, 0.92, 0.75));
        this.uSSSColor         = uniform(new THREE.Color(1.0, 0.35, 0.15));
        this.uEnvColor         = uniform(new THREE.Color(0.12, 0.14, 0.22));

        // ── Glass / reflection / refraction (from reflection3.js) ──
        this.uIOR           = uniform(2.0);   // glass IOR (1.0=no refract, 2.5=diamond)
        this.uGlassStrength = uniform(1.0);   // 0=fully opaque cat, 1=fully glass
        // Warp strength: direct N.xy * strength, no /z division
        // 0.3 = ±0.3 UV offset = ~400 texture pixels — clearly visible
        this.uReflStrength  = uniform(0.3); // default: 0.3
        this.uRefrStrength  = uniform(0.3); // default: 0.3
        // Plane half-size in world units — needed to reconstruct worldPos from UV
        // Match planeGeometry dimensions in main.js (planeH=6, planeW=6*(832/1248))
        this.uPlaneSize     = uniform(new THREE.Vector2(4.0, 6.0));
    }

    setTextures(diffuse, depth, background) {
        this.diffuseTex    = diffuse;
        this.depthTex      = depth;
        this.backgroundTex = background;

        const w = diffuse.image.width;
        const h = diffuse.image.height;
        this.texSize.value.set(w, h);
        this.lightPos.value.set(w * 0.5, h * 0.3, 3.0);
    }

    createShader() {
        let {
            diffuseTex, depthTex, backgroundTex,
            mousePos, texSize, lightPos, cameraPos, cameraShift,
            uParallaxStrength, uShadowStrength, uAOStrength,
            uSSSStrength, uRimStrength, uDOFStrength,
            uLightColor, uSSSColor, uEnvColor,
            uIOR, uGlassStrength, uReflStrength, uRefrStrength, uPlaneSize,
        } = this;

        return Fn(() => {


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
            const objectMask = diffuse.a;

            // ── Surface normal (from depth map) ──────────────────────────────
            const N = normalFromDepth(depthTex, uvP, texelSize);

            // ── DoverR shaderPoint (texture pixel + depth space) ─────────────
            const d          = float(0.5);
            const fragCoord  = mul(uvP, texSize);
            const spZ        = sub(mul(add(float(1.0), d), depth), d);
            const shaderPoint = vec3(fragCoord, spZ);
            const lightDir   = normalize(sub(lightPos, shaderPoint));

            // ── 2. Shadow — DoverR 100-step height-field march ───────────────
            const a       = float(5.0);
            const R       = d.toVar();
            Loop(int(100), ({ i }) => {
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
            const aoAcc = float(0.0).toVar();
            Loop(int(8), ({ i }) => {
                const angle = mul(float(i), float(0.7854));
                const sUV   = clamp(
                    add(uvP, mul(vec2(cos(angle), sin(angle)), mul(texelSize, float(6.0)))),
                    vec2(0.0), vec2(1.0)
                );
                aoAcc.addAssign(clamp(sub(texture(depthTex, sUV).r, depth), float(0.0), float(1.0)));
            });
            const aoFactor = sub(float(1.0),
                mul(clamp(div(aoAcc, float(8.0)), float(0.0), float(1.0)), uAOStrength)
            );

            // ── 4. SSS — DoverR W=pow(dif,10) ────────────────────────────────
            const dif      = clamp(add(mul(float(0.5), dot(lightDir, N)), float(0.5)),
                                   float(0.0), float(1.0));
            const sssColor = mul(uSSSColor,
                mul(pow(dif, float(10.0)), mul(sub(float(1.0), tShadow), uSSSStrength))
            );

            // ── 5. Rim — depth gradient ───────────────────────────────────────
            const dR2 = texture(depthTex, add(uvP, vec2(texelSize.x, float(0.0)))).r;
            const dL2 = texture(depthTex, sub(uvP, vec2(texelSize.x, float(0.0)))).r;
            const dU2 = texture(depthTex, add(uvP, vec2(float(0.0),  texelSize.y))).r;
            const dD2 = texture(depthTex, sub(uvP, vec2(float(0.0),  texelSize.y))).r;
            const rimFactor = mul(
                clamp(sqrt(add(pow(sub(dR2,dL2), float(2.0)), pow(sub(dU2,dD2), float(2.0)))),
                      float(0.0), float(1.0)),
                uRimStrength
            );

            // ── 6. Glass — viewDir, reflection, refraction, Fresnel ──────────
            //
            // For glass we use a separate, more amplified normal so that even
            // flat areas of the cat show visible distortion.
            // normalFromDepth gives N.z=0.3 (tilted) but on the smooth AI depth
            // map most of the body has tiny N.xy → reflDir.xy ≈ 0 → no warp.
            //
            // Solution: re-derive N for glass with a SMALLER z-bias (0.05),
            // which gives bigger N.xy components → more distortion.
            // Shadow/diffuse keep the gentler N (z=0.3) for stable lighting.
            const Ng = normalFromDepth(depthTex, uvP, mul(texelSize, float(0.5)));
            // normalFromDepth uses z=0.3 — for glass we want more aggressive tilt.
            // Re-normalize with smaller z so xy dominates more:
            const NgAmped = normalize(vec3(
                mul(Ng.x, float(4.0)),   // amplify x tilt
                mul(Ng.y, float(4.0)),   // amplify y tilt
                Ng.z                     // keep z as-is
            ));

            // viewDir: from surface toward camera.
            // worldPos.xy = (uvP - 0.5) * planeSize, worldPos.z = 0
            const worldPosXY = mul(sub(uvP, vec2(0.5, 0.5)), uPlaneSize);
            const worldPos3  = vec3(worldPosXY, float(0.0));
            const viewDir    = normalize(sub(cameraPos, worldPos3));
            const incident   = negate(viewDir);

            // Reflection off amplified normal
            const NdotV   = dot(NgAmped, viewDir);
            const reflDir = normalize(sub(mul(mul(float(2.0), NdotV), NgAmped), viewDir));

            // Refraction (Snell's law) off amplified normal

            // this.setIOR(sub(mul(float(2.0), mousePos.x), float(1.0))) ;
            const ior    = clamp(mul(uIOR, mousePos.x), 1.0, 2.5);
            const eta    = div(float(1.0), ior);
            const NdotI  = dot(NgAmped, incident);
            const disc   = sub(float(1.0),
                               mul(mul(eta, eta), sub(float(1.0), mul(NdotI, NdotI))));
            const isTIR  = disc.lessThan(float(0.0));
            const refractValid = normalize(add(
                mul(eta, incident),
                mul(sub(mul(eta, NdotI), sqrt(max(disc, float(0.0)))), NgAmped)
            ));
            const refractDir = select(isTIR, reflDir, refractValid);

            // Fresnel (Schlick) — uses amplified normal for consistent IOR response
            const Fresnel = select(
                isTIR,
                float(1.0),
                fresnelSchlick(float(1.0), ior, NgAmped, incident)
            );

            // ── UV warp — WHY /z was removed ─────────────────────────────────
            // For a flat plane viewed head-on: viewDir=(0,0,1), N≈(0,0,1)
            // → reflDir=(0,0,1), reflDir.z=1, reflDir.xy=(0,0)
            // → offset = (0,0)/1 * strength = (0,0)  → no visible effect!
            // The /z "perspective correction" makes sense for a tilted surface
            // or a full 3D scene, but on a flat quad it cancels the only signal
            // we have (N.xy from depth gradients) because dividing by z≈1
            // doesn't amplify anything while dividing by |reflDir.z| actually
            // REDUCES the offset compared to just using reflDir.xy directly.
            //
            // Fix: drop the /z, use reflDir.xy directly * strength.
            // With uReflStrength=0.3 this gives ±0.3 UV offset (≈400 tex pixels)
            // which is clearly visible. The N.xy from depth gradients provides
            // all the spatial variation needed.

            // Reflection UV — direct xy warp by reflect direction
            uReflStrength = clamp( mul(uReflStrength, mousePos.x), 0.0, 1.0);
            uRefrStrength = clamp( mul(uRefrStrength, mousePos.x), 0.0, 1.0);
            uGlassStrength = clamp( mul(uGlassStrength, mousePos.y), 0.0, 1.0);

            const reflOffset = mul(reflDir.xy, uReflStrength);
            const reflUV     = clamp(add(uvP, reflOffset), vec2(0.0), vec2(1.0));
            const reflColor  = texture(backgroundTex, reflUV).xyz;

            // Refraction UV — direct xy warp by refract direction
            // refractDir.xy encodes the lateral bend from Snell's law
            const refrOffset   = mul(refractDir.xy, uRefrStrength);
            const refractUV    = clamp(add(uvP, refrOffset), vec2(0.0), vec2(1.0));
            const refractColor = texture(backgroundTex, refractUV).xyz;

            // Fresnel blend: glancing → reflect, head-on → refract
            const fresnelMix = add(
                mul(Fresnel,                     reflColor),
                mul(sub(float(1.0), Fresnel),    refractColor)
            );

            // Blinn-Phong specular highlight (on top of glass)
            const H_spec  = normalize(add(lightDir, viewDir));
            const specTerm = pow(max(dot(N, H_spec), float(0.0)), float(64.0));
            const specColor = mul(vec3(1.0, 1.0, 0.95), specTerm);

            // ── 7. DoF + Background ──────────────────────────────────────────
            const bgSharp = texture(backgroundTex, uvP).xyz;
            const bgBlur  = div(add(add(add(add(
                bgSharp,
                texture(backgroundTex, add(uvP, vec2(uDOFStrength, float(0.0)))).xyz),
                texture(backgroundTex, sub(uvP, vec2(uDOFStrength, float(0.0)))).xyz),
                texture(backgroundTex, add(uvP, vec2(float(0.0),   uDOFStrength))).xyz),
                texture(backgroundTex, sub(uvP, vec2(float(0.0),   uDOFStrength))).xyz),
                float(5.0)
            );
            const bgFinal = mix(bgBlur, bgSharp, remap01(float(0.0), float(0.4), depth));

            // ── 8. Composite ─────────────────────────────────────────────────

            // DoverR base lighting (dark*(1-t) + light*t)
            const ambient   = mul(uEnvColor, float(0.25));
            const darkSide  = mul(diffuse.xyz, ambient);
            const lightSide = mul(diffuse.xyz, add(ambient, mul(uLightColor, dif)));
            const litSurface = add(
                mul(darkSide,  sub(float(1.0), tShadow)),
                mul(lightSide, tShadow)
            );
            const withAO  = mul(litSurface, aoFactor);
            const withSSS = add(withAO, sssColor);
            const withRim = add(withSSS, mul(uLightColor, rimFactor));

            // KtAlpha: luminance of diffuse → opaque where fur is bright, glassy where dark
            // from reflection3.js: "luminance-based mask"
            const luma    = clamp(
                add(add(mul(diffuse.r, float(0.299)),
                         mul(diffuse.g, float(0.587))),
                         mul(diffuse.b, float(0.114))),
                float(0.0), float(1.0)
            );

            // KtAlpha: controls glass vs opaque blend.
            //
            // OLD: KtAlpha = clamp(luma - glassStrength, 0, 1)
            //   Problem: luma of orange fur ≈ 0.65, so at glassStrength=0,
            //   KtAlpha = 0.65 — still 35% glass bleeds through. Never fully opaque.
            //
            // FIX: remap so that:
            //   glassStrength=0.0 → KtAlpha=1.0 everywhere on cat (fully opaque)
            //   glassStrength=1.0 → KtAlpha=0.0 everywhere on cat (fully glass)
            //   In between → luma modulates within that range
            //
            // Formula: KtAlpha = clamp(1.0 - glassStrength * (1.0 + luma), 0, 1)
            //   At glassStrength=0: KtAlpha = 1.0  ✓ fully opaque
            //   At glassStrength=1, luma=1: KtAlpha = clamp(1-2, 0,1) = 0 fully glass
            //   At glassStrength=0.5, luma=0.7: KtAlpha = clamp(1-0.85, 0,1) = 0.15
            //     → bright fur slightly glassy, dark areas fully glass

            const KtAlpha = clamp(
                // sub(luma, uGlassStrength),
                sub(float(1.0), mul(uGlassStrength, add(float(1.0), luma))),
                float(0.0), float(1.0)
            );

            // Glass color = Fresnel(reflect, refract) + specular highlight
            const glassColor = add(fresnelMix, mul(specColor, float(0.3)));

            // Blend: glass where dark/thin, opaque lit surface where bright/thick
            const catColor = mix(glassColor, withRim, KtAlpha);

            // Apply cat shadow onto background
            const bgShadowed = mul(bgFinal, tShadow);

            // Final: background (with shadow) vs cat (glass + lit surface)
            return vec4(mix(bgShadowed, catColor, objectMask), float(1.0));
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

    // xy in texture pixel space, z in depth-space (3.0 default)
    updateLightPosition(x, y, z) { this.lightPos.value.set(x, y, z); }

    // Pass Three.js camera.position directly
    updateCameraPosition(x, y, z) {
        this.cameraPos.value.set(x, y, z);
        this.cameraShift.value.set(x * 0.04, y * 0.04);
    }

    updateMouse(x, y) { this.mousePos.value.set(x, y); }

    // Effect controls
    setParallax(v)      { this.uParallaxStrength.value = v; }
    setShadow(v)        { this.uShadowStrength.value   = v; }
    setAO(v)            { this.uAOStrength.value        = v; }
    setSSS(v)           { this.uSSSStrength.value       = v; }
    setRim(v)           { this.uRimStrength.value       = v; }
    setDOF(v)           { this.uDOFStrength.value       = v; }

    // Glass controls
    setIOR(v)           { this.uIOR.value           = v; }  // 1.0–2.5
    setGlassStrength(v) { this.uGlassStrength.value = v; }  // 0=opaque, 1=glass
    setReflStrength(v)  { this.uReflStrength.value  = v; }
    setRefrStrength(v)  { this.uRefrStrength.value  = v; }
}
