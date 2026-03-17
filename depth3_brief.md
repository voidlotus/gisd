# depth3.js — Brief Reference with Formula Sources

## What it does

A 2.5D depth-aware shader for Three.js WebGPU that takes a diffuse image and a depth map and produces: self-shadowing, ambient occlusion, subsurface scattering, rim light, parallax, depth of field, and a physically-based glass material.

---

## Effects and formulas

### 1. Parallax UV shift

Shifts UV coordinates by `depth × cameraShift × strength` before all other effects. Foreground pixels (high depth) shift more than background pixels, producing a 3D parallax effect on a flat quad.

No external formula — standard UV parallax offset technique.

---

### 2. Shadow — height-field ray march

**Source: DoverR (ShaderToy), adapted for Three.js TSL**

```glsl
shaderPoint = vec3(fragCoord.xy, (1+d)*h - d)
lightDir    = normalize(lightPos - shaderPoint)
pos         = shaderPoint + i * d * a * lightDir
occluded    = heightMap(pos.xy / texSize) > pos.z

t = clamp(2.0 * pow(d/R, 0.45), 0, 1)
```

The ray origin is placed in a mixed coordinate space where xy is texture pixels and z is depth value `[0,1]`. One hundred steps march toward the light; each step that is below the height surface increments accumulator `R`. The soft shadow ratio `d/R` is gamma-remapped with `pow(0.45)` to produce a smooth penumbra. The same `tShadow` darkens the background to produce a cast shadow.

### Limitations:
- if too few steps: makes the shadow appear jaggy or not noisy in which appear not realistic
- if too many: calculation will takes time which make the system lag
- the key is too balance between number of steps and shadow quality in this case 100 steps is good enough. 
> Reference: DoverR [VIZA-656] Height Map Shadow + SSS

---

### 3. Ambient Occlusion

```glsl
for 8 directions at 45° intervals:
    sample depth at uvP + direction * radius
    if neighbour_depth > current_depth → occluded
aoFactor = 1 - mean(occlusion) * strength
```

Screen-space approximation of ambient occlusion using a uniform ring of depth samples. Concave areas where neighbours are closer to the camera appear darker.

> Reference: Bavoil & Sainz, *Screen Space Ambient Occlusion*, NVIDIA Developer, 2008. https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-12-high-quality-ambient-occlusion

---

### 4. Diffuse shading — half-Lambert

**Source: DoverR (ShaderToy)**

```glsl
dif = clamp(0.5 * dot(lightDir, N) + 0.5, 0, 1)
```

Standard Lambert `dot(N,L)` remapped from `[-1,1]` to `[0,1]`. Prevents back-faces from going completely black and gives a softer, more organic light wrap appropriate for fur and skin.

> Reference: Valve Software, *Half-Lambert Lighting*, Valve Developer Community, 2006. https://developer.valvesoftware.com/wiki/Half_Lambert

---

### 5. Subsurface scattering (SSS)

**Source: DoverR (ShaderToy)**

```glsl
W        = pow(dif, 10.0)
sssColor = uSSSColor * W * (1 - tShadow) * uSSSStrength
```

`W = pow(dif, 10)` creates a tight forward-scatter lobe that glows on the shadow side of the surface where thin geometry (ears, paw edges) transmits backlight. Multiplying by `(1 - tShadow)` ensures the glow only appears in shadow, not on directly lit surfaces.

> Reference: DoverR [VIZA-656] *ShaderToy — Height Map Shadow + SSS*

---

### 6. Rim lighting

```glsl
gradMag = sqrt((dR-dL)² + (dU-dD)²)
rimFactor = clamp(gradMag, 0, 1) * uRimStrength
```

The depth gradient magnitude is large at silhouette edges — where depth transitions from the subject to background. Adding `lightColor * rimFactor` brightens these edges, maintaining subject-background separation and making glass mode visible.

> Reference: Standard graphics technique; see Akenine-Möller et al., *Real-Time Rendering*, 4th ed., Chapter 5 (Area and Environment Lighting).

---

### 7. Reflection direction

```glsl
reflDir = normalize(2 * dot(N, viewDir) * N - viewDir)
```

Standard mirror reflection of the view ray about the surface normal. The reflected direction is used to offset UV coordinates for a screen-space environment lookup.

> Reference: Shirley & Morley, *Realistic Ray Tracing*, 2nd ed., Chapter 4. Also GLSL built-in `reflect(I, N) = I - 2*dot(N,I)*N`.

---

### 8. Refraction direction — Snell's law (vector form)

```glsl
eta  = n_air / n_glass = 1.0 / IOR
disc = 1 - eta² * (1 - dot(N, I)²)
if disc < 0: TIR → use reflDir
else: refractDir = normalize(eta*I + (eta*dot(N,I) - sqrt(disc)) * N)
```

Vector form of Snell's law. `disc < 0` signals total internal reflection (TIR) — the angle of incidence exceeds the critical angle and no transmitted ray exists.

> Reference: Heckbert, P., *Writing a Ray Tracer*, in Glassner (ed.), *An Introduction to Ray Tracing*, Academic Press, 1989. Also: Shirley & Morley, *Realistic Ray Tracing*, 2nd ed.

---

### 9. Fresnel reflectance — Schlick approximation

**Source: reflection3.js (project file)**

```glsl
r0      = ((n1 - n2) / (n1 + n2))²
Fresnel = r0 + (1 - r0) * (1 - cosθ)^5
```

`r0` is the base reflectance at normal incidence. As the angle of incidence increases toward 90° (glancing view), `Fresnel → 1` (nearly total reflection). Returns 1.0 under TIR conditions.

> Reference: Schlick, C., *An Inexpensive BRDF Model for Physically-Based Rendering*, Computer Graphics Forum 13(3), 1994.

---

### 10. Fresnel blend

```glsl
fresnelMix = Fresnel * reflColor + (1 - Fresnel) * refractColor
```

Linearly blends the reflected and refracted background samples using the Fresnel factor as a weight. At glancing angles the surface looks like a mirror; head-on it shows a distorted view through the glass.

---

### 11. Glass transparency mask (KtAlpha)

```glsl
luma     = 0.299*R + 0.587*G + 0.114*B
KtAlpha  = clamp(1.0 - glassStrength * (1.0 + luma), 0, 1)
catColor = mix(glassColor, litSurface, KtAlpha)
```

Luminance-based transparency mask: at `glassStrength=0`, `KtAlpha=1` everywhere (fully opaque). At `glassStrength=1`, `KtAlpha=0` everywhere (fully glass). In between, bright pixels (high luma) stay opaque longer than dark pixels. ITU-R BT.601 luma coefficients are used.

> Reference: ITU-R Recommendation BT.601, *Studio Encoding Parameters of Digital Television for Standard 4:3 and Wide-Screen 16:9 Aspect Ratios*, 2011.

---

### 12. Final composite

```glsl
bgShadowed = bgFinal * tShadow
output     = mix(bgShadowed, catColor, objectMask)
```

**Source: DoverR (ShaderToy)** — `col = dark*(1-t) + bright*t`

The DoverR composite `col = img2*(1-t) + img3*t` is extended to colour output. `tShadow` drives the blend between the ambient-only dark side and the fully-lit bright side. The background receives the same `tShadow` to show the cast shadow from the subject.

---

## Normal from depth map

```glsl
dzdx = (depth(uv+Δx) - depth(uv-Δx)) / 2
dzdy = (depth(uv+Δy) - depth(uv-Δy)) / 2
N    = normalize(-dzdx, -dzdy, 0.3)
```

2nd-order central finite difference approximation of the depth surface gradient. The z-bias of 0.3 prevents degenerate normals in flat regions.

> Reference: Mikkelsen, M., *Bump Mapping Unparametrized Surfaces on the GPU*, Journal of Graphics, GPU, and Game Tools 15(1), 2010.

---

## Summary table

| Effect | Formula source |
|---|---|
| Parallax UV | Standard UV offset |
| Shadow (ray march) | DoverR ShaderToy |
| Soft shadow (d/R ratio) | DoverR ShaderToy |
| Ambient occlusion | Bavoil & Sainz (2008) |
| Half-Lambert diffuse | Valve Developer Community (2006) |
| SSS forward scatter | DoverR ShaderToy |
| Rim light (gradient mag) | Standard technique |
| Mirror reflection | GLSL `reflect()`, Shirley & Morley |
| Refraction (Snell's law) | Heckbert (1989), Shirley & Morley |
| Fresnel (Schlick) | Schlick (1994) |
| Luma coefficients | ITU-R BT.601 |
| Normal from depth | Mikkelsen (2010) |
