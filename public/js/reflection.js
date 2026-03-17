// import * as THREE from 'three';
// import {
//     MeshBasicNodeMaterial,
//     texture,
//     uv,
//     uniform,
//     vec2,
//     vec3,
//     vec4,
//     float,
//     mul,
//     add,
//     sub,
//     div,
//     dot,
//     pow,
//     abs,
//     clamp,
//     mix,
//     length,
//     normalize,
//     Fn
// } from 'three/tsl';
//
// // Load your textures
// const loader = new THREE.TextureLoader();
// const normalMap = loader.load('../res/tex/normal.png');      // iChannel0
// const albedoMap = loader.load('../res/tex/albedo.png');
// const specularMap = loader.load('../res/tex/specular');
// //const darkTexture = loader.load('dark.jpg');       // iChannel1
// //const lightTexture = loader.load('light.jpg');     // iChannel2
// //const background = loader.load('background.jpg');  // iChannel3
//
// // Create uniforms
// const mousePos = uniform(new THREE.Vector2(0.5, 0.5));
// const resolution = uniform(new THREE.Vector2(1024, 1024));
//
// // Helper function for step2
// const step2 = Fn(([min, max, x]) => {
//     const t = div(sub(x, min), sub(max, min));
//     return clamp(t, 0.0, 1.0);
// });
//
// // Main shader function
// const customShader = Fn(() => {
//     const uvCoord = uv();
//
//     // Sample textures
//     const normal = texture(normalMap, uvCoord);
//     const albedo = texture(albedoMap, uvCoord);
//     const specular = texture(specularMap, uvCoord);
//     //const ambi = texture(darkTexture, uvCoord);
//     //const diff = texture(lightTexture, uvCoord);
//     //const bgCol = texture(background, uvCoord);
//
//     // Colors
//     const spec = vec4(1.0, 1.0, 0.0, 1.0);
//     const lightCol = vec4(1.0, 0.8, 0.2, 1.0);
//
//     // Specular coefficient
//     const Ks = sub(1.0, ambi.w);
//
//     // Positions
//     const eye = vec3(0.0, 0.0, 10.0);
//     const fragCoord = mul(uvCoord, resolution);
//     const lightpos = vec3(mul(mousePos.x, resolution.x), mul(mousePos.y, resolution.y), 50.0);
//
//     // Direction vectors
//     const dir = normalize(sub(lightpos, vec3(fragCoord.x, fragCoord.y, 0.0)));
//     const eyeDir = normalize(sub(eye, vec3(fragCoord.x, fragCoord.y, 0.0)));
//
//     // Normals from normal map (convert from [0,1] to [-1,1])
//     const normals = normalize(sub(mul(img0.xyz, 2.0), vec3(1.0)));
//
//     // Reflection vector
//     const reflect = sub(mul(mul(dot(dir, normals), normals), 2.0), dir);
//
//     // Lighting calculations
//     const t_raw = add(mul(dot(dir, normals), 0.5), 0.5);
//     const s_raw = add(mul(dot(reflect, eyeDir), 0.5), 0.5);
//     const b = abs(dot(normals, eyeDir));
//
//     // Process lighting terms
//     const t = div(step2(0.1, 0.99, t_raw), 0.99);
//     const s = pow(s_raw, 10.0);
//     const b_processed = pow(b, 5.0);
//
//     // Combine lighting
//     const T = mul(t, lightCol);
//
//     // Diffuse + ambient
//     const diffuseAmbi = add(
//         mul(ambi, sub(1.0, T)),
//         mul(diff, T)
//     );
//
//     // Add specular
//     const withSpec = add(
//         mul(diffuseAmbi, sub(1.0, mul(s, Ks))),
//         mul(spec, mul(s, Ks))
//     );
//
//     // Alpha blend with background
//     const finalCol = add(
//         mul(sub(1.0, img0.w), bgCol),
//         mul(img0.w, withSpec)
//     );
//
//     return finalCol;
// });

import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
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
    length,
    normalize,
    positionWorld,
    positionView,
    fract,
    normalWorld,
    smoothstep,
    screenCoordinate,
    Fn, max, greaterThan, sqrt, lessThan
} from 'three/tsl';


// Helper function for step2 - must be defined at module level with Fn()
// const step2 = Fn(([min, max, x]) => {
//     const t = div(sub(x, min), sub(max, min));
//     return clamp(t, 0.0, 1.0);
// });

// Helper to calculate tangent-space normal
const calculateWorldNormal = Fn(([normalMapSample, normalWorld]) => {
    // Convert normal map from [0,1] to [-1,1]
    const normalTS = sub(mul(normalMapSample.xyz, 2.0), vec3(1.0));

    // For now, just use the normal map directly
    // In a full implementation, you'd need tangent/bitangent for proper tangent-space conversion
    return normalize(normalTS);
});

export class CustomShaderMaterial {
    constructor() {
        this.mousePos = uniform(new THREE.Vector2(0.5, 0.5));
        this.resolution = uniform(new THREE.Vector2(1024, 1024));

        // FIX: Use 3D light position instead of 2D mouse coordinates
        this.lightPos = uniform(new THREE.Vector3(0, 0, 50)); // light position
        this.cameraPos = uniform(new THREE.Vector3(0, 0, 10)); //eye/camera pos

        this.textures = {
            normalMap: null,
            albedoMap: null,
            specularMap: null,
            backgroundMap: null,
            envMap: null,
            diffuseMap: null,
        };
    }



    random (st) {

        const randVector = new THREE.Vector2(12.9898, 78.233);
        const randConstant = 43758.5453123;
        return fract(Math.sin( st.xy.dot( randVector ) * randConstant ));
    }

    step2(min, max, val){
        let t = (val - min) / (max - min);
        return clamp(t, 0.0, 1.0);
    }

    setTextures(normal, env, diffuse) {
        this.textures.normalMap = normal;
        this.textures.envMap = env;
        this.textures.diffuseMap = diffuse;
        // this.textures.albedoMap = albedo;
        // this.textures.specularMap = specular;
        //this.textures.backgroundMap = background;
    }

    // Helper function for step2
    // const step2 = Fn(([min, max, x]) => {
    //     const t = div(sub(x, min), sub(max, min));
    //     return clamp(t, 0.0, 1.0);
    // });

    createShader() {
        const { normalMap, envMap,diffuseMap } = this.textures;
        const mousePos = this.mousePos;
        const resolution = this.resolution;
        const lightPos = this.lightPos;
        const cameraPos = this.cameraPos;

        return Fn(() => {
            const uvCoord = uv();
            // Normalized screen coordinates (0.0 to 1.0)
            const fragCoord = div(screenCoordinate.xy, resolution.xy);

            // textures
            const normal = texture(normalMap, uvCoord);
            const env = texture(envMap, uvCoord);
            const Kt = texture(diffuseMap, uvCoord);
            const KtAlpha = Kt.a;

            // Get world position of this fragment
            const worldPos = positionWorld;

            // Colors
            const spec = vec4(1.0, 1.0, 0.9, 1.0);
            // const lightCol = vec4(1.0, 0.8, 0.2, 1.0);
            // const specColor = vec4(0.3, 0.3, 0.25, 1);
            const lightCol = vec4(1.0, 0.9, 0.7, 1.0);   // Warm light
            let ambi = vec4(0.2, 0.2, 0.3, 1.0); // Cool ambient
            let diff = vec3(1.0, 0.8, 0.5);
            // Calculate normal from normal map
            const normals = calculateWorldNormal(normal, normalWorld);

            // Specular coefficient
            // const Ks = sub(1.0, albedo.w);

            // Positions
            // const fragCoord = mul(uvCoord, resolution);

            // Direction vectors
            //const dir = normalize(sub(lightpos, vec3(fragCoord.x, fragCoord.y, 0.0)));
            //const eyeDir = normalize(sub(eye, vec3(fragCoord.x, fragCoord.y, 0.0)));

            // Light direction (from surface to light)
            const lightDir = normalize(sub(lightPos, worldPos));

            // View direction (from surface to camera)
            const viewDir = normalize(sub(cameraPos, worldPos));

            // Combine lighting
            // Ambient
            // const ambient = mul(albedo, ambientColor);

            // Normals from normal map (convert from [0,1] to [-1,1])
            //const normals = normalize(sub(mul(normal.xyz, 2.0), vec3(1.0)));
            //const normals = normal;

            // Calculate diffuse term (Lambert) / t
            const a = normals.a;
            const diffuseFactor = clamp(dot(normals, lightDir), 0.0, 1.0);
            //let diffuseFactor = add(mul(dot(lightDir, normals), 0.5), 0.5); // (dot(L, N) * 0.5) + 0.5)
            //diffuseFactor = div(step2(0.1, 0.99, diffuseFactor), 0.99);

            // Diffuse
            // const diffuse = mul(mul(albedo, lightCol), diffuseFactor);
            //const diffuse = mul(diffuseFactor, lightCol);
            //  const diffuseAmbi = add(
            //     mul(albedo, sub(1.0, diffuse)),
            //     mul(albedo, diffuse)
            // );

            // Calculate specular term (Phong)

            let ior = div( mul(2.0, mousePos.x), sub(resolution.x, 1.0) );
            ior = pow(2.0, ior);

            const d = 100.0;


            // Reflection vector
            //const reflect = sub(mul(mul(dot(dir, normals), normals), 2.0), dir);
            // const reflectDir = sub(mul(mul(dot(lightDir, normals), normals), 2.0), lightDir);
            // const specFactor = pow(clamp(dot(reflectDir, viewDir), 0.0, 1.0), 8.0);
            const C = dot(viewDir, normals);
            const reflect = sub(mul(mul(2.0, C), normals), viewDir);
            let refract = -viewDir;

            if ( greaterThan( add(sub(mul(C,C), 1.0), ior), 0.0 ) )
            {
                refract = mul(div(1.0, ior), ( add(-viewDir, mul(( sub(C, sqrt(  add(sub(mul(C,C),1.0), mul(ior,ior) )) )), normals)) ));
            }

            let t = add(mul(0.5, dot(viewDir, normals)), 0.5);
            let s = add(mul(0.5, dot(reflect, viewDir)), 0.5);
            const b = 1.0;

            // Fresnel
            const Ct = dot(refract, -normals);
            let Fresnel = abs( ( sub(Ct, mul(ior,C)) ) / ( add(Ct, mul(ior,C)) ) );
            Fresnel = pow(Fresnel, 2.0);
            if ( lessThan( mul(add(sub(mul(C,C),1.0), ior), ior), 0.0 ) )
            {
                Fresnel = 1.0;
            }

            let reflectedUV = vec2(div(( mul(reflect.xy, d) / add(add( ( add(reflect.z, 0.01)), fragCoord), lightPos.xy) ), resolution.xy ));
            let reflected_env = texture(env, reflectedUV);
            // sementara refracted bg gelap
            const refractedBackground = vec4(0.0,0.0,0.0,1.0);
            let Fresnel_Mix = add( mul(Fresnel, reflected_env.xyz), mul((sub(1.0,Fresnel)), refractedBackground.xyz));

            t = this.step2(0.1, 0.99, t);
            s = this.step2(0.9, 1.0, s);



            // Specular (use specular map to control intensity)
            // const s = mul(mul(specColor, specFactor), sub(1.0, specular.r)); // convert roughness to specular
            // const s = mul(mul(specColor, specFactor), specular.r);

            // Kt : diffuseMap.a (opacity)
            let finalColor = add(mul(ambi, ( sub(1.0, t))), mul(diff, t));
            finalColor = add(mul(finalColor, KtAlpha), mul(( sub(1.0, KtAlpha) ) * max(Fresnel_Mix, mul(spec, s))));
            finalColor = mul(mul(finalColor, ( sub(1.0, normals.a) )), vec3(0.0, 0.0, 0.0));


            return finalColor;
        });
    }

    createMaterial() {
        const material = new MeshBasicNodeMaterial();
        material.colorNode = this.createShader()();
        return material;
    }

    updateLightPosition(x, y, z) {
        this.lightPos.value.set(x, y, z);
    }

    updateCameraPosition(x, y, z) {
        this.cameraPos.value.set(x, y, z);
    }

    updateMouse(x, y) {
        this.mousePos.value.set(x, y);
    }

    updateResolution(width, height) {
        this.resolution.value.set(width, height);
    }
}