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
    min,
    sqrt,
    negate,
    Fn,
} from 'three/tsl';

// Module-level TSL helpers

// step2: linear remap [min,max] → [0,1], clamped
const step2 = Fn(([minVal, maxVal, x]) => {
    const t = div(sub(x, minVal), sub(maxVal, minVal));
    return clamp(t, float(0.0), float(1.0));
});

// Decode normal map sample [0,1] → [-1,1], normalized
const decodeNormal = Fn(([sample]) => {
    return normalize(sub(mul(sample.xyz, float(2.0)), vec3(1.0, 1.0, 1.0)));
});

// Schlick Fresnel
const fresnelSchlick = Fn(([n1, n2, normal, incident]) => {
    const r0raw = div(sub(n1, n2), add(n1, n2));
    const r0    = mul(r0raw, r0raw);
    const cosX  = negate(dot(normal, incident));
    const n_    = div(n1, n2);
    const sinT2 = mul(mul(n_, n_), sub(float(1.0), mul(cosX, cosX)));
    const isTIR = sinT2.greaterThan(float(1.0));
    const cosXt = sqrt(clamp(sub(float(1.0), sinT2), float(0.0), float(1.0)));
    const n1GtN2 = n1.greaterThan(n2);
    const cosEff = select(n1GtN2, cosXt, cosX);
    const x      = sub(float(1.0), cosEff);
    const schlick = add(r0, mul(sub(float(1.0), r0), pow(x, float(5.0))));
    return select(n1GtN2.and(isTIR), float(1.0), schlick);
});

// Class

export class CustomShaderMaterial {
    constructor() {
        this.mousePos   = uniform(new THREE.Vector2(0.5, 0.5));
        this.resolution = uniform(new THREE.Vector2(1024, 1024));
        this.lightPos   = uniform(new THREE.Vector3(0, 0, 2));
        this.cameraPos  = uniform(new THREE.Vector3(0, 0, 5));
    }

    setTextures(normal, env, diffuse, background) {
        this.normalMap     = normal;
        this.envMap        = env;
        this.diffuseMap    = diffuse;
        this.backgroundMap = background;
    }

    createShader() {
        const { normalMap, envMap, diffuseMap, backgroundMap } = this;
        const mousePos    = this.mousePos;
        const resolution  = this.resolution;
        const lightPosU   = this.lightPos;
        const cameraPosU  = this.cameraPos;

        return Fn(() => {
            const uvCoord = uv();

            // Sample textures
            const normalSample  = texture(normalMap,     uvCoord);
            const diffuseSample = texture(diffuseMap,    uvCoord);
            const bgSample      = texture(backgroundMap, uvCoord); // unperturbed bg

            // Silhouette mask from normal map alpha
            // BUG FIX 1: Most normal maps have alpha=0 everywhere → glass invisible.
            // Use diffuse alpha first; fall back to a constant 1 if no alpha channel.
            // If your normal map DOES have a proper alpha silhouette, swap back to normalSample.a
            const objectAlpha = diffuseSample.a;
            // const objectAlpha = float(1.0); // ← use this if diffuse also has no alpha

            // Transparency mask (Kt): how much of the surface is "glass"
            // BUG FIX 2: luminance-based mask so solid-color diffuse images still work
            const luma    = add(add(mul(diffuseSample.r, float(0.299)),
                                    mul(diffuseSample.g, float(0.587))),
                                    mul(diffuseSample.b, float(0.114)));
            const KtAlpha = clamp(luma, float(0.0), float(1.0));

            // Surface colors (blended with diffuse texture)
            const ambi = div(add(mul(vec3(0.10, 0.10, 0.60), float(0.1)), diffuseSample.xyz), float(1.1));
            const diff = div(add(mul(vec3(1.00, 0.80, 0.50), float(0.1)), diffuseSample.xyz), float(1.1));
            const spec = vec3(1.0, 1.0, 0.9);

            // Decode normal map
            const N = decodeNormal(normalSample);

            // View & incident directions
            const worldPos = positionWorld;
            const viewDir  = normalize(sub(cameraPosU, worldPos)); // toward camera
            const incident = negate(viewDir);                       // toward surface

            // IOR from mouse.x [0,1] → IOR in [0.5, 2.0]
            const iorRaw = sub(mul(float(2.0), mousePos.x), float(1.0));
            const ior    = pow(float(2.0), iorRaw);
            const eta    = div(float(1.0), ior); // n1(air) /n2

            // Reflection direction
            // reflect(I, N) = I - 2*dot(N,I)*N
            // We want outgoing direction (away from surface), so negate incident:
            // reflDir = 2*(N·V)*N - V  — points toward environment
            const NdotV  = dot(N, viewDir);
            const reflDir = normalize(sub(mul(mul(float(2.0), NdotV), N), viewDir));

            // Refraction direction
            const NdotI = dot(N, incident);
            const disc  = sub(float(1.0), mul(mul(eta, eta),
                              sub(float(1.0), mul(NdotI, NdotI))));
            const isTIR = disc.lessThan(float(0.0));

            const refractValid = normalize(add(
                mul(eta, incident),
                mul(sub(mul(eta, NdotI), sqrt(max(disc, float(0.0)))), N)
            ));
            const refractDir = select(isTIR, reflDir, refractValid);

            // Fresnel
            const Fresnel = select(
                isTIR,
                float(1.0),
                fresnelSchlick(float(1.0), ior, N, incident)
            );

            // Light & Blinn-Phong specular
            const L        = normalize(sub(lightPosU, worldPos));
            const H        = normalize(add(L, viewDir));
            const specTerm = pow(max(dot(N, H), float(0.0)), float(64.0));
            const specColor = mul(spec, specTerm);

            // Diffuse / ambient scalars
            const tRaw = add(mul(float(0.5), dot(L, N)), float(0.5));
            const sRaw = add(mul(float(0.5), dot(reflDir, L)), float(0.5));
            const t    = step2(float(0.1), float(0.99), tRaw);
            const s    = step2(float(0.9),  float(1.0),  sRaw);

            // Reflected UV
            // BUG FIX 3: d/reflDirZ * reflStrength was producing UV offsets of
            // 35+ units (100/~1 * 0.35) — way off screen.
            // Correct scale: keep offset in [0,1] UV space, ~0.05–0.15 is visible.
            const reflDirZ   = max(reflDir.z, float(0.001));
            // BUG FIX 4: reflDir.z for a forward-facing plane is NEGATIVE
            // (it points behind the plane into the env). abs() makes it stable.
            const reflStrength = float(0.08);
            const reflOffset   = mul(reflDir.xy, mul(div(float(1.0), abs(reflDirZ)), reflStrength));
            const reflectedUV  = clamp(add(uvCoord, reflOffset), vec2(0.0, 0.0), vec2(1.0, 1.0));

            const reflectedColor = texture(envMap, reflectedUV).xyz;

            // Refracted UV
            // BUG FIX 5: same scale issue as reflection.
            // refractDir.z is near -1 for a front-facing plane, so negate it.
            const refractDirZ  = max(negate(refractDir.z), float(0.001));
            const refrStrength = float(0.08);
            const refractOffset = mul(refractDir.xy, mul(div(float(1.0), refractDirZ), refrStrength));
            const refractedUV   = clamp(add(uvCoord, refractOffset), vec2(0.0, 0.0), vec2(1.0, 1.0));

            const refractedColor = texture(backgroundMap, refractedUV).xyz;

            // Fresnel blend
            const fresnelMix = add(
                mul(Fresnel, reflectedColor),
                mul(sub(float(1.0), Fresnel), refractedColor)
            );

            // Surface shading
            const surfaceColor = add(
                mul(ambi, sub(float(1.0), t)),
                mul(diff, t)
            );

            // Glass composite
            // Opaque surface vs glass (KtAlpha), plus specular highlights
            const specHighlight = max(fresnelMix, mul(spec, s));
            const composited    = add(
                mul(surfaceColor, KtAlpha),
                mul(sub(float(1.0), KtAlpha), specHighlight)
            );

            // BUG FIX 6: Background composite
            // objectAlpha=0 → show background, objectAlpha=1 → show glass.
            // Previously objectAlpha came from normalSample.a which is 0 on most
            // normal maps, so the background term dominated and glass disappeared.
            // With objectAlpha = diffuseSample.a (or 1.0), glass is now visible.
            const finalColor = add(
                mul(composited, objectAlpha),
                mul(bgSample.xyz, sub(float(1.0), objectAlpha))
            );

            return vec4(finalColor, float(1.0));

            // Debug views (uncomment one at a time to diagnose)
            // return vec4(N.mul(0.5).add(0.5), 1.0);          // normals
            // return vec4(reflectedColor, 1.0);                // raw env sample
            // return vec4(refractedColor, 1.0);                // raw bg refracted
            // return vec4(float(Fresnel), float(Fresnel), float(Fresnel), 1.0); // fresnel mask
            // return vec4(reflectedUV, 0.0, 1.0);              // reflected UV coords
        });
    }

    createMaterial() {
        const material       = new MeshBasicNodeMaterial();
        material.colorNode   = this.createShader()();
        material.transparent = true;
        material.depthWrite  = false;
        return material;
    }

    updateLightPosition(x, y, z) { this.lightPos.value.set(x, y, z); }
    updateCameraPosition(x, y, z) { this.cameraPos.value.set(x, y, z); }
    updateMouse(x, y)             { this.mousePos.value.set(x, y); }
    updateResolution(w, h)        { this.resolution.value.set(w, h); }
}
