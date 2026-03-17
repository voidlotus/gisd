# refshading
 Project 03: Reflection + GI + Shadow w/ Depth Map

Submissions	Due: Feb.23

Normal decoding is the first must step where it will remap from 0,1 to -1,1 which is giving true surface normal N

Before calculating the reflection, refraction, and fresnel, in this case, index of reflection (IOR) need to be calculated first using the following formula:
- glass IOR can be manipulated dinamically according to the mouse X position
- the ratio of refractive indices (ETA) between two media the light ray is crossing can be calculated by dividing the first medium (in this case air which is close to 1) and second medium (glass)
- incident can be calculated by negating the view direction

Reflected ray direction is calculated using the following equation:
`ReflectRayDir = 2 * (N.V) * N - V`
where N is the surface normal, V is the view direction

Refraction ray direction using Snell's Law can be calculated as follows:
- the discriminant to indicates whether ray can pass through or not. For an example if the value is less than zero then we will have total internal reflection and ray cannot exit and fully reflect.
- if the discriminant more than zero, then Fresnel function will refract the ray

Fresnel function takes surface normal, incident vector, refractive index being left (n1) and the refractive index being entered (n2)
- Schlick's approximation decides how much of the light reflects vs. transmits. At grazing angles (edge-on view) nearly everything reflects. At straight-on view only a small fraction reflects

UV Offsetting:
- both reflection and refraction are faked by offsetting the UV coordinates used to sample the environment and background textures.
- The XY components of reflDir / refractDir push the sample point sideways, simulating where the ray would land on a virtual plane behind/in-front of the surface

Final compositing:
- Fresnel mixes reflection/refraction
- KtAlpha blends that with opaque surface shading
- objectAlpha composites the whole object over the scene background.


REFERENCE:
- VIZA 656 slides
- [Website Blog](https://blog.demofox.org/2017/01/09/raytracing-reflection-refraction-fresnel-total-internal-reflection-and-beers-law/)

HOW TO COMPILE:
- copy and paste the js files into the ThreeJS environment project


## Problem Description:

The goal of this project is to extend 2.5D image synthesis by incorporating depth maps to approximate spatial relationships and visibility. Unlike normal-map-only rendering, depth maps provide limited geometric information that enables effects such as shadows, occlusion, and approximate global illumination, while still do not provide full three-dimensional scene representation.

Through this project, students will gain hands-on experience with depth-aware shading techniques, learning how depth information can be used to estimate light transport phenomena such as shadows and subsurface scattering. The project emphasizes understanding the capabilities and limitations of depth-based approaches as an intermediate step between image-based rendering and full 3D rendering.


Summary of minimal requirements: Students must implement a WebGL-based shader (using either ShaderToy or WebGL with JavaScript) that uses a depth map (and, if desired, a normal map) to produce:

Shadows or self-shadowing effects
Approximate global illumination effects
Reflection and refraction effects
Subsurface scattering or translucency effects
The rendering remains 2.5D and does not include a full three-dimensional scene. But, a limited camera movement to obtain parallax effect is possible. Depth information is used only to approximate spatial relationships along the view direction. Emphasis should be placed on correct use of depth data, stable shading behavior, and a clear understanding of the limitations of depth-based rendering.


## Project Submission:

Projects must be submitted to both the class website and the shared Google Drive. Students must provide:
- The complete source code for the shader and supporting WebGL or ShaderToy setup.
- A short video or animated capture demonstrating dynamic effects such as shadows, global illumination, or light interaction changes.
- A brief written description explaining how depth maps are used to approximate spatial effects, including any assumptions or limitations.

Submissions should emphasize conceptual correctness, thoughtful approximation of light transport, and clear separation between depth-based effects and full 3D rendering.