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
    positionWorld,
    normalWorld,
    screenCoordinate,
    select,
    max,
    sqrt,
    negate,
    sampler,
    Fn,
} from 'three/tsl';

// ─── Module-level TSL helpers ────────────────────────────────────────────────

// step2: linear remap then clamp to [0,1]
const step2 = Fn(([minVal, maxVal, x]) => {
    const t = div(sub(x, minVal), sub(maxVal, minVal));
    return clamp(t, float(0.0), float(1.0));
});

// Decode normal map sample [-1,1]
const decodeNormal = Fn(([sample]) => {
    return normalize(sub(mul(sample.xyz, float(2.0)), vec3(1.0, 1.0, 1.0)));
});

// ─── Class ───────────────────────────────────────────────────────────────────

export class CustomShaderMaterial {
    constructor() {
        this.mousePos  = uniform(new THREE.Vector2(0.5, 0.5));
        this.resolution = uniform(new THREE.Vector2(1024, 1024));
        this.lightPos  = uniform(new THREE.Vector3(0, 0, 50));
        this.cameraPos = uniform(new THREE.Vector3(0, 0, 10));

        this.textures = {
            normalMap: null,
            envMap:    null,
            diffuseMap: null,
            background: null,
        };
    }

    setTextures(normal, env, diffuse, background) {
        this.textures.normalMap  = normal;
        this.textures.envMap     = env;
        this.textures.diffuseMap = diffuse;
        this.textures.background = background;
    }

    createShader() {
        const { normalMap, envMap, diffuseMap, backgroundMap } = this.textures;
        const mousePos  = this.mousePos;
        const resolution = this.resolution;
        const lightPos  = this.lightPos;
        const cameraPos = this.cameraPos;

        return Fn(() => {
            const uvCoord = uv();
            // fragCoord in pixel space
            // const fragCoordPx = mul(uvCoord, resolution);

            // Normalized screen coordinates (0.0 to 1.0)
            const fragCoordPx = div(screenCoordinate, resolution.xy);
            // const uvCoord = div(fragCoordPx,  resolution.xy);
            const d = float(100.0);

            // ── Sample textures ──────────────────────────────────────────────
            const normalSample  = texture(normalMap,  uvCoord);
            // const envSample     = texture(envMap,     uvCoord);
            const backgroundSample  = texture(backgroundMap,  uvCoord);
            const diffuseSample = texture(diffuseMap, uvCoord);

            // ── Mask: use luminance of diffuse as alpha (black bg → 0) ───────
            // If your PNG has a real alpha channel, replace with: diffuseSample.a
            const KtAlpha = clamp(
                add(add(diffuseSample.r, diffuseSample.g), diffuseSample.b),
                float(0.0), float(1.0)
            );

            // ── Colors ───────────────────────────────────────────────────────
            const spec = vec3(1.0, 1.0, 0.9);
            const ambi = vec3(0.2, 0.2, 0.3);
            const diff = vec3(1.0, 0.8, 0.5);

            // ── Normals ──────────────────────────────────────────────────────
            const normals = decodeNormal(normalSample);

            // ── Directions ───────────────────────────────────────────────────
            const worldPos = positionWorld;
            const viewDir  = normalize(sub(cameraPos, worldPos));
            // const lightPos = vec3(mousePos.x, mousePos.y, div(d,float(2.0)));
            // let dir = sub( lightPos, vec3(fragCoordPx, 0.0) );
            // const dirLength = dot(dir,dir);
            // dir = div( dir, dirLength  );

            // ── IOR from mouse ───────────────────────────────────────────────
            // Maps mouse.x across screen to ior in [0.5, 2.0]
            // const iorRaw = sub(div(mul(float(2.0), mousePos.x), resolution.x), float(1.0));
            // FIXED - mousePos is already [0,1], just remap to [-1,1]
            const iorRaw = sub(mul(float(2.0), mousePos.x), float(1.0));
            const ior    = pow(float(2.0), iorRaw);

            // ── Reflection & Refraction ──────────────────────────────────────
            const C       = dot(viewDir, normals);                          // cos(theta)
            const reflDir = sub(mul(mul(float(2.0), C), normals), viewDir); // R = 2(N·V)N - V

            // Discriminant for refraction: C²- 1 + ior²
            const disc = add(sub(mul(C, C), float(1.0)), mul(ior, ior));

            // Refracted direction (only valid when disc > 0)
            const refractValid = mul(
                div(float(1.0), ior),
                add(
                    negate(viewDir),
                    mul(sub(C, sqrt(disc)), normals)
                )
            );
            // When total internal reflection (disc <= 0), use -viewDir
            const refractDir = select(
                disc.greaterThan(float(0.0)),
                refractValid,
                negate(viewDir)
            );

            // ── Diffuse / specular scalars ───────────────────────────────────
            const tRaw = add(mul(float(0.5), dot(viewDir, normals)), float(0.5));
            const sRaw = add(mul(float(0.5), dot(reflDir, viewDir)), float(0.5));

            const t = step2(float(0.1), float(0.99), tRaw);
            const s = step2(float(0.9),  float(1.0),  sRaw);

            // ── Real Fresnel ─────────────────────────────────────────────────
            const Ct = dot(refractDir, negate(normals));
            const fresnelRaw = pow(
                abs(div(sub(Ct, mul(ior, C)), add(Ct, mul(ior, C)))),
                float(2.0)
            );
            // Total internal reflection → Fresnel = 1
            const Fresnel = select(
                disc.greaterThan(float(0.0)),
                fresnelRaw,
                float(1.0)
            );

            // ── Reflected UV (screen-space) ──────────────────────────────────

            // const reflectedUV = div(
            //     add(
            //         add(
            //             mul(reflDir.xy, div(d, add(reflDir.z, float(0.01)))),
            //             fragCoordPx
            //         ),
            //         lightPos.xy
            //     ),
            //     resolution
            // );

            // BROKEN - divides by full resolution, offset becomes nearly invisible
            // const reflOffset = div(
            //     mul(reflDir.xy, div(d, add(reflDir.z, float(0.01)))),
            //     resolution
            // );

            // FIXED - use a strength multiplier instead, tune to taste
            const reflStrength = float(0.35); //0.05
            // const reflOffset = mul(
            //     reflDir.xy,
            //     mul(div(d, add(reflDir.z, float(0.01))), reflStrength)
            // );

            const reflDirZ = max(reflDir.z, float(0.01)); // never negative
            const reflOffset = mul(
                reflDir.xy,
                mul(div(d, reflDirZ), reflStrength)
            );
            const reflectedUV = add(uvCoord, reflOffset);

            // Check if UV is within [0,1] bounds
            const inBoundsX = reflectedUV.x.greaterThanEqual(float(0.0)).and(reflectedUV.x.lessThanEqual(float(1.0)));
            const inBoundsY = reflectedUV.y.greaterThanEqual(float(0.0)).and(reflectedUV.y.lessThanEqual(float(1.0)));
            const inBounds = inBoundsX.and(inBoundsY);

            // const reflectedUV = clamp(
            //     add(uvCoord, reflOffset),
            //     vec2(0.0, 0.0),
            //     vec2(1.0, 1.0)
            // );

            // Fade reflection near edges
            // const edgeFadeX = mul(reflectedUV.x, sub(float(1.0), reflectedUV.x));
            // const edgeFadeY = mul(reflectedUV.y, sub(float(1.0), reflectedUV.y));
            // const edgeFade = clamp(mul(mul(edgeFadeX, edgeFadeY), float(20.0)), float(0.0), float(1.0));
            //
            // const reflectedColorRaw = texture(envMap, reflectedUV).xyz;
            // const reflectedColor = mul(reflectedColorRaw, edgeFade); // fades to black at edges


            // Or use the texture node's updateMatrix:
            // envMap.wrapS = THREE.RepeatWrapping;
            // envMap.wrapT = THREE.RepeatWrapping;
            // envMap.needsUpdate = true;

            let reflectedColorRaw = texture(envMap, reflectedUV).xyz;
            // envTex.sampler = true;
            // const reflectedColor = envTex;

            // Only use reflection color when UV is in bounds, otherwise black
            // const reflectedColor = select(inBounds, envTex, vec3(0.0, 0.0, 0.0));

            // Background is black for now (no background texture loaded)
            const refractedColor = vec3(0.0, 0.0, 0.0);


            const fresnelMix = add(
                mul(Fresnel, reflectedColorRaw),
                mul(sub(float(1.0), Fresnel), refractedColor)
            );

            // ── Final composite (mirrors original Shadertoy logic) ───────────
            // col = ambi*(1-t) + diff*t
            const surfaceColor = add(
                mul(ambi, sub(float(1.0), t)),
                mul(diff, t)
            );

            // col = col*Kt + (1-Kt)*max(fresnelMix, spec*s)
            const specHighlight = max(fresnelMix, mul(spec, s));
            const composited = add(
                mul(surfaceColor, KtAlpha),
                mul(sub(float(1.0), KtAlpha), specHighlight)
            );

            return vec4(composited, float(1.0));
            // return vec4(composited, KtAlpha);
        });
    }

    createMaterial() {
        const material = new MeshBasicNodeMaterial();
        material.colorNode = this.createShader()();
        material.transparent = true;   // ← add this
        material.depthWrite = false;   // ← and this
        return material;
    }

    updateLightPosition(x, y, z) { this.lightPos.value.set(x, y, z); }
    updateCameraPosition(x, y, z) { this.cameraPos.value.set(x, y, z); }
    updateMouse(x, y)             { this.mousePos.value.set(x, y); }
    updateResolution(w, h)        { this.resolution.value.set(w, h); }
}
