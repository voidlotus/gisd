# depth3.js — Comprehensive Technical Documentation

## Overview

`depth3.js` implements a **2.5D depth-aware shader** for Three.js WebGPU using the TSL (Three.js Shading Language) node-based API. It takes a diffuse colour image and an AI-estimated depth map as inputs and produces a rendered result that includes self-shadowing, ambient occlusion, subsurface scattering, rim lighting, parallax, depth of field, and a physically-based glass material — all without a full 3D scene or a normal map texture.

The shader is divided into eight sequential stages, each building on the outputs of the previous one.

---

## Architecture: the 2.5D coordinate system

A critical design constraint runs through the entire shader: it operates in a **mixed coordinate space** derived from the DoverR ShaderToy reference. The x and y axes are in **texture pixel space** (0 to image width/height), while the z axis is in **depth value space** (0.0 to 1.0, where 1.0 is closest to the camera). This mixed space is intentional — it keeps the light ray travelling laterally across the image rather than shooting straight toward the camera, which is what makes shadow casting work correctly.

```
fragCoord.xy  = uvP * texSize          (texture pixels)
shaderPoint.z = (1 + d) * depth - d    (depth value, DoverR formula)
lightPos.xy   = mouse * texSize        (texture pixels)
lightPos.z    = 3.0                    (just above depth range [0,1])
```

If `lightPos.z` were set to a large value (e.g. `window.innerHeight * 0.5 = 1000`), the z delta would dominate the light direction vector and `pos.z` would exit the valid depth range `[0,1]` after less than one step, making shadow computation impossible.

---

## Stage 0: Uniforms and textures

The class exposes all effect parameters as TSL `uniform` nodes, meaning they can be updated every frame from JavaScript without recompiling the shader.

| Uniform | Type | Purpose |
|---|---|---|
| `texSize` | `vec2` | Texture pixel dimensions — set from `diffuse.image.width/height` after load |
| `lightPos` | `vec3` | xy in texture pixel space, z in depth space (~3.0) |
| `cameraPos` | `vec3` | Three.js world space camera position, used for glass viewDir |
| `cameraShift` | `vec2` | Per-frame parallax offset derived from camera XY drift |
| `uParallaxStrength` | `float` | How far UVs shift per unit of depth during parallax |
| `uShadowStrength` | `float` | Scales the darkness of shadowed regions (0–1) |
| `uAOStrength` | `float` | Scales ambient occlusion darkening |
| `uSSSStrength` | `float` | Intensity of subsurface scattering glow |
| `uRimStrength` | `float` | Brightness of silhouette rim light |
| `uDOFStrength` | `float` | Depth-of-field blur radius on background (0 = off) |
| `uIOR` | `float` | Index of refraction for glass (1.0–2.5) |
| `uGlassStrength` | `float` | 0 = opaque cat, 1 = fully glass |
| `uReflStrength` | `float` | UV warp scale for reflection |
| `uRefrStrength` | `float` | UV warp scale for refraction |
| `uPlaneSize` | `vec2` | World-space plane dimensions for worldPos reconstruction |

---

## Stage 1: Parallax UV shift

```js
const depthRaw = texture(depthTex, uvRaw).r;
const uvP = clamp(add(uvRaw, mul(cameraShift, mul(depthRaw, uParallaxStrength))), 0, 1);
```

Before any other effect runs, the raw UV coordinates are shifted proportionally to the depth value at that pixel. Pixels with high depth (close to the camera, bright in the depth map) shift more; background pixels (depth ≈ 0) barely shift. This produces a **parallax scrolling effect** as the camera drifts: foreground elements appear to move faster than the background, simulating 3D depth on a flat quad.

`cameraShift` is updated every frame from the camera's XY position, which itself smoothly lerps toward the opposite of the mouse position.

All subsequent stages operate on `uvP` (the parallax-corrected UV) rather than the raw UV.

---

## Stage 2: Self-shadowing — DoverR height-field ray march

This is the core shadow algorithm, ported directly from the DoverR ShaderToy shader.

### Ray origin

```js
const spZ = (1 + d) * depth - d;    // d = 0.5
const shaderPoint = vec3(fragCoord, spZ);
```

The ray origin is placed at the fragment's position in the mixed coordinate space. The z formula `(1+d)*h - d` elevates the origin slightly above the height surface — at `d=0.5` and `h=1.0` (maximum depth) this gives `spZ = 1.0`, and at `h=0` it gives `spZ = -0.5`. This prevents the ray from immediately self-intersecting at step zero.

### Ray direction

```js
const lightDir = normalize(sub(lightPos, shaderPoint));
```

A true 3D normalised direction vector from the fragment toward the light. Because `lightPos.xy` is in pixel space (hundreds of units) and `lightPos.z` is only 3.0, the resulting direction is nearly horizontal — `lightDir.xy` dominates `lightDir.z`. This is essential: without it the ray shoots almost vertically and exits the valid depth range immediately.

### March loop

```js
Loop(int(100), ({ i }) => {
    pos = shaderPoint + (i+1) * d * a * lightDir;
    H   = depthMap(pos.xy / texSize);
    if (H > pos.z) R += d;
});
```

One hundred steps, each advancing `d * a = 0.5 * 5.0 = 2.5` units in the light direction. At each step the depth map is sampled at the ray's current XY position. If the sampled depth value `H` is greater than the ray's current Z height (`pos.z`), the ray is below the surface — it is occluded. The accumulator `R` starts at `d` (not zero, to prevent division by zero) and grows by `d` per hit.

### Soft shadow formula

```js
tShadow = clamp(2.0 * pow(d / R, 0.45), 0, 1);
```

- `d/R` is the ratio of the step size to the total accumulated occluded distance. With no hits, `R = d` and `t = clamp(2 * 1, 0, 1) = 1.0` (fully lit).
- With many hits, `R >> d` and `t → 0` (fully shadowed).
- `pow(t, 0.45)` applies a gamma-like curve that softens the shadow edge, producing a smooth penumbra rather than a hard cut-off.
- The factor of 2.0 ensures that even with a few hits the result stays bright unless heavily occluded.

### Background shadow

`tShadow` is also applied to background pixels. The ray marches from a background pixel toward the light and passes through the cat's body (high depth values). The resulting `tShadow < 1` darkens the background, producing a cast shadow from the cat onto the environment.

---

## Stage 3: Ambient Occlusion

```js
Loop(int(8), ({ i }) => {
    angle = i * π/4;
    sUV = uvP + vec2(cos(angle), sin(angle)) * texelSize * 6.0;
    aoAcc += clamp(depth(sUV) - depth, 0, 1);
});
aoFactor = 1.0 - clamp(aoAcc / 8.0, 0, 1) * uAOStrength;
```

Eight depth samples are taken at equal angular intervals around the current pixel in a small ring (radius = 6 texels). If a neighbour's depth value is higher (closer to camera), it is "above" the current pixel and partially occludes it from ambient light. The occlusion amount is averaged and used to darken the pixel. This approximates the soft darkening that occurs in concave areas like the neck, ear creases, and armpits.

---

## Stage 4: Diffuse shading and SSS

### Diffuse term

```js
dif = clamp(0.5 * dot(lightDir, N) + 0.5, 0, 1);
```

This is the **half-Lambert** diffuse formula, which remaps the standard `dot(N, L)` from `[-1, 1]` to `[0, 1]`. Standard Lambert shading cuts to black on back-facing surfaces; half-Lambert wraps light around the surface, giving a softer, more organic result appropriate for fur and skin.

### Subsurface scattering

```js
W = pow(dif, 10.0);
sssColor = uSSSColor * W * (1 - tShadow) * uSSSStrength;
```

`W = pow(dif, 10)` is a tight forward-scatter lobe — it is large only when `dif ≈ 1.0`, meaning when the light direction aligns closely with the surface normal. Multiplying by `(1 - tShadow)` ensures the SSS glow only appears on the **shadow side** — areas that are lit face-on do not glow because they are already bright from direct diffuse. Thin areas (ear tips, paw edges) which happen to face the light produce an orange warm-light glow simulating light transmitting through thin tissue.

---

## Stage 5: Rim lighting

```js
gradMag = sqrt((dR - dL)² + (dU - dD)²);
rimFactor = clamp(gradMag, 0, 1) * uRimStrength;
```

The gradient magnitude of the depth map is large at silhouette edges — where depth transitions sharply from the cat (high) to the background (low). These edges are brightened by adding `uLightColor * rimFactor` to the final colour. This produces a characteristic rim light that makes the subject's silhouette visible against the background and is especially important for the glass mode, where the cat would otherwise be invisible without surface features.

---

## Stage 6: Glass — reflection, refraction, Fresnel

This stage implements physically-based glass using the pipeline from `reflection3.js`.

### Amplified normal for glass

```js
const Ng = normalFromDepth(depthTex, uvP, texelSize * 0.5);
const NgAmped = normalize(vec3(Ng.x * 4.0, Ng.y * 4.0, Ng.z));
```

The standard depth-derived normal has a z-bias of 0.3, which keeps lighting stable but produces very small xy components on a smooth depth map. For glass distortion, small N.xy means small reflDir.xy means tiny UV offsets — invisible to the eye. A separate, more aggressive normal is derived by amplifying the xy components by 4× before renormalising. This is used exclusively for reflection, refraction, and Fresnel — not for shadow or diffuse shading.

### View direction

```js
worldPos = vec3((uvP - 0.5) * planeSize, 0);
viewDir = normalize(cameraPos - worldPos);
```

The fragment's world position is reconstructed from its UV coordinates and the known plane dimensions. This gives a per-fragment view direction that accounts for perspective (edge fragments have a slightly oblique viewDir rather than the same straight-ahead direction as the centre).

### Reflection direction

```js
reflDir = normalize(2 * dot(NgAmped, viewDir) * NgAmped - viewDir);
```

Standard mirror reflection formula: the view ray is reflected off the surface normal. The reflected direction points into the environment — it is used to look up what the glass surface "shows" when viewed from that angle.

### Refraction direction (Snell's law)

```js
eta = 1.0 / IOR;
NdotI = dot(NgAmped, incident);
disc = 1 - eta² * (1 - NdotI²);
refractDir = normalize(eta*incident + (eta*NdotI - sqrt(disc)) * NgAmped);
```

This is the vector form of Snell's law. `eta = n_air / n_glass = 1/IOR`. The discriminant `disc` can go negative when the angle of incidence exceeds the critical angle — this is **total internal reflection (TIR)**. When TIR occurs, `refractDir` falls back to `reflDir`.

### Fresnel — Schlick approximation

```js
r0 = ((n1 - n2) / (n1 + n2))²;
Fresnel = r0 + (1 - r0) * (1 - cosθ)^5;
```

The Schlick approximation models how much light is reflected vs refracted at a surface boundary as a function of the angle of incidence. At normal incidence (head-on, `cosθ = 1`), `Fresnel = r0` — a small base reflectance (about 4% for air-to-glass with IOR 1.5). At glancing angles (`cosθ → 0`), `Fresnel → 1` — nearly total reflection. The formula handles total internal reflection by returning 1.0 when TIR is active.

### UV warp

```js
reflOffset  = reflDir.xy  * uReflStrength;
refrOffset  = refractDir.xy * uRefrStrength;
```

Both reflection and refraction are implemented as **screen-space UV warps** rather than actual ray intersections with geometry. The direction vectors' XY components encode how much the surface normal deflects the view ray laterally, and this deflection is applied as an offset to the UV coordinates used to sample the background texture. The perspective-correction division by `dir.z` (common in full 3D environments) is omitted here because for a flat quad viewed head-on, `dir.z ≈ 1.0` and the xy components are already the only useful signal.

### Fresnel blend

```js
fresnelMix = Fresnel * reflColor + (1 - Fresnel) * refractColor;
```

The final glass colour is a weighted blend of the reflected and refracted background samples. At glancing angles (edge of the cat), reflection dominates. At head-on angles (centre of the body), refraction dominates, showing a distorted view of what is behind.

---

## Stage 7: Depth of field and background

```js
bgBlur = average of 5 samples at uvP ± uDOFStrength offset;
bgFinal = mix(bgBlur, bgSharp, remap(0, 0.4, depth));
```

A simple 5-tap cross blur is applied to the background texture. Pixels with low depth (far from camera) receive more blur; pixels with high depth (close to camera, i.e. the cat itself) receive the sharp version. This simulates a shallow depth-of-field lens effect where objects outside the focal plane are soft.

---

## Stage 8: Final composite

```js
// Luminance
luma = 0.299*R + 0.587*G + 0.114*B;

// Glass transparency mask
KtAlpha = clamp(1.0 - glassStrength * (1.0 + luma), 0, 1);

// Glass colour with specular
glassColor = fresnelMix + specColor * 0.3;

// Cat colour blends glass and lit surface
catColor = mix(glassColor, withRim, KtAlpha);

// Background with cast shadow
bgShadowed = bgFinal * tShadow;

// Final output
output = mix(bgShadowed, catColor, objectMask);
```

### KtAlpha transparency mask

`KtAlpha` controls how opaque or transparent each pixel is. It is derived from the diffuse luminance and the global `glassStrength` parameter:

- At `glassStrength = 0`: `KtAlpha = clamp(1 - 0, 0, 1) = 1.0` everywhere — the cat is fully opaque regardless of fur brightness.
- At `glassStrength = 1`: `KtAlpha = clamp(1 - (1+luma), 0, 1) = 0.0` everywhere — the cat is fully glass regardless of fur brightness.
- In between, dark areas (low luma) become glassy before bright areas do, since `1 - glassStrength*(1+0.3)` stays positive longer than `1 - glassStrength*(1+0.9)`.

### Object mask

`objectMask = diffuse.a` — the alpha channel of the diffuse PNG. On the cat body it is 1.0; in the transparent background area it is 0.0. The final `mix(bgShadowed, catColor, objectMask)` composites the cat over the shadowed background.

---

## Helper functions

### `normalFromDepth`

Computes a surface normal from the depth map using 2nd-order central finite differences:

```
dzdx = (depth(uv + Δx) - depth(uv - Δx)) / 2
dzdy = (depth(uv + Δy) - depth(uv - Δy)) / 2
N    = normalize(-dzdx, -dzdy, 0.3)
```

The z-bias of 0.3 ensures the normal always has a significant forward-facing component, preventing degenerate normals in flat regions of the depth map.

### `remap01`

A simple linear remap `clamp((x - a) / (b - a), 0, 1)` used to map depth ranges to blend factors.

### `fresnelSchlick`

The full Schlick Fresnel approximation with TIR handling. When `n1 > n2` (exiting a denser medium) and `sinT² > 1`, the function returns 1.0 (total internal reflection). Otherwise it returns the standard Schlick polynomial.

---

## Coordinate system summary

| Space | Used for | Units |
|---|---|---|
| Raw UV | Texture sampling | [0,1] × [0,1] |
| Parallax UV (uvP) | All effects after stage 1 | [0,1] × [0,1] |
| Texture pixel (fragCoord) | DoverR shadow ray march | [0, texW] × [0, texH] |
| Depth value | Z axis of shadow ray, shaderPoint.z | [0, 1] |
| Three.js world | Camera position, viewDir reconstruction | metres (plane = 4×6 units) |

---

## Effect interaction diagram

```
uvRaw
  │
  ▼ [Stage 1: Parallax]
uvP ──────────────────────────────────────────────────────────────────┐
  │                                                                    │
  ├─ depth sample                                                      │
  ├─ diffuse sample → objectMask                                       │
  ├─ normalFromDepth → N                                               │
  │                                                                    │
  ▼ [Stage 2: DoverR Shadow]                                           │
tShadow ──────────────────────────────────────────────┐               │
  │                                                   │               │
  ▼ [Stage 3: AO]                                     │               │
aoFactor                                              │               │
  │                                                   │               │
  ▼ [Stage 4: SSS + diffuse]                          │               │
dif, sssColor                                         │               │
  │                                                   │               │
  ▼ [Stage 5: Rim]                                    │               │
rimFactor                                             │               │
  │                                                   │               │
  ▼ [Stage 6: Glass]                                  │               │
fresnelMix, specColor                                 │               │
  │                                                   │               │
  ▼ [Stage 7: Background]                             │               │
bgFinal                                               │               │
  │                                                   │               │
  ▼ [Stage 8: Composite]                              │               │
litSurface = dark*(1-tShadow) + light*tShadow ◄───────┘               │
withAO     = litSurface * aoFactor                                     │
withSSS    = withAO + sssColor                                         │
withRim    = withSSS + uLightColor * rimFactor                         │
catColor   = mix(glassColor, withRim, KtAlpha)                         │
bgShadowed = bgFinal * tShadow                                         │
output     = mix(bgShadowed, catColor, objectMask) ◄───────────────────┘
```
