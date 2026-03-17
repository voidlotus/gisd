import * as THREE from 'three';
import {WebGPURenderer} from 'three/webgpu';
import { CustomShaderMaterial } from './public/js/reflection3.js';

/*
* positive axis: x=right, y= top, z= toward the camera
* */

// 1. Create a scene
const scene = new THREE.Scene();
//scene.background.setColor(0x222222);

// 2. Create the camera
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000);
camera.position.z = 5;

// 3. Create the renderer
//const renderer = new THREE.WebGLRenderer({antialias: true});
const renderer = new WebGPURenderer({antialias: true, alpha: true});
renderer.setClearColor(0x000000, 0);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// 4. Create a Mesh (Geometry + Material)
// 992 * 1168 is the cat texture image
const aspectRatioPlane = 832.0/1248.0;
const heightPlan = 6.0;
const planeGeometry = new THREE.PlaneGeometry(heightPlan * aspectRatioPlane,heightPlan);

// texture
const textureLoader = new THREE.TextureLoader();

// load kiyuk texture
// const kiyukAlbedo = textureLoader.load(
//     'res/tex/albedo.png',
//     (kiyukAlbedo) => {
//         console.log('Kiyuk albedo loaded');
//     },
//     (xhr) => {
//         console.log( (xhr.loaded / xhr.total * 100) + '%loaded');
//     },
//     (error) => { console.error( 'Error loading kiyuk albedo',(error) ); }
// );

// const glassNormal = textureLoader.load(
//     'res/tex/glass-normal.png',
//     (kiyukNormal) => {
//         console.log('Kiyuk Normal loaded');
//     },
//     (xhr) => {
//         console.log( (xhr.loaded / xhr.total * 100) + '%loaded');
//     },
//     (error) => { console.error( 'Error loading kiyuk normal',(error) ); }
// );

// const kiyukSpecular = textureLoader.load(
//     'res/tex/roughness.png',
//     (kiyukNormal) => {
//         console.log('Kiyuk specular loaded');
//     },
//     (xhr) => {
//         console.log( (xhr.loaded / xhr.total * 100) + '%loaded');
//     },
//     (error) => { console.error( 'Error loading kiyuk specular',(error) ); }
// );



// materials
const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('skyblue') });
const lambert = new THREE.MeshLambertMaterial({ color: new THREE.Color('orange'), emissive: 'lavender', emissiveIntensity: 0.1 });
const phong = new THREE.MeshPhongMaterial({color: 'lavender', specular: 'white', shininess: 30, emissiveIntensity: 'orange'});
const pbr = new THREE.MeshStandardMaterial({color: 'blue', metalness: 0.1, roughness: 0.5, emissive: 0x000000, emissiveIntensity: 0});

// const loader = new THREE.CubeTextureLoader();
// // or use an HDR loader and PMREMGenerator
// const envMap = loader.load([
//     'px.png', 'nx.png',
//     'py.png', 'ny.png',
//     'pz.png', 'nz.png'
// ]);

// LIGHTING

// ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, .22);
// scene.add(ambientLight);

// directional light
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;

// point light
// Create point light
const pointLight = new THREE.PointLight(0xffffff, 10, 4000);
pointLight.position.set(0, 0, .4);
// scene.add(pointLight);

// Add a visible sphere to show where the light is
// const lightSphere = new THREE.Mesh(
//     new THREE.SphereGeometry(0.1, 16, 16),
//     new THREE.MeshBasicMaterial({ color: 0xffff00 })
// );
// pointLight.add(lightSphere);

// shadow quality settings
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = .5;
directionalLight.shadow.camera.far = 50;

// let there be light
// scene.add(directionalLight);

// visualise the light direction (helper)
const dirLightHelper = new THREE.DirectionalLightHelper(directionalLight,5, 'red');
//scene.add(dirLightHelper);

// 5. Animation Loop (UE: Tick function?)
// function animate() {
//     requestAnimationFrame(animate);
//     cube.rotation.x += 0.01;
//     cube.rotation.y += 0.01;
//     renderer.render(scene, camera);
// }
// animate();

// Mouse tracking
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

// Store custom shader reference globally so mouse handler can access it
let customShaderInstance = null;
function onMouseMove(event) {
    // Convert mouse position to normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mouse, camera);

    // Create a plane at z=0 to project the mouse position onto
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(planeZ, intersectPoint);

    if (intersectPoint) {
        pointLight.position.x = intersectPoint.x;
        pointLight.position.y = intersectPoint.y;
        pointLight.position.z = .4;
        // pointLight.position.z = intersectPoint.z;

        // FIX: Update custom shader light position with same 3D position
        if (customShaderInstance) {
            customShaderInstance.updateLightPosition(
                intersectPoint.x,
                intersectPoint.y,
                // intersectPoint.z,
                .4
            );
        }
    }
}

// (faster alternative) 5. using WEBGPU
// Initialize renderer before rendering
async function init(){
    await renderer.init();
    // Start animation loop after init

    // FIX: Create custom shader material AFTER renderer is initialized
    const customShader = new CustomShaderMaterial();
    customShaderInstance = customShader; // Store reference for mouse handler

    // Load textures
    Promise.all([
        textureLoader.loadAsync('res/tex/train-normal.png'),
        textureLoader.loadAsync('res/tex/flower.png').then(tex => { // env
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;  // ← force Three.js to re-upload with new settings
            return tex;
        }),
        // textureLoader.loadAsync('res/tex/building.jpg'),
        textureLoader.loadAsync('res/tex/train.png'),
        textureLoader.loadAsync('res/tex/building.jpg'), // background

    ]).then(([normal, env, diffuse, background]) => {
        customShader.setTextures(normal, env, diffuse, background);

        const glassMat = customShader.createMaterial();

        // const pbr = new THREE.MeshStandardMaterial({normalMap: glassNormal, color: 'blue', metalness: 0.1, roughness: 0.5, emissive: 0x000000, emissiveIntensity: 0});
        const myPlane = new THREE.Mesh(planeGeometry, glassMat);
        myPlane.rotation.x = -Math.PI / 2;
        myPlane.rotation.x = 0;
        myPlane.position.set(0,0,0);
        scene.add(myPlane);

        console.log('Custom shader plane added to scene');

        // FIX: Update resolution uniform to match window size
        customShader.updateResolution(window.innerWidth, window.innerHeight);

        // sync camera pos to shader every frame
        // customShader.updateCameraPosition(
        //     camera.position.x,
        //     camera.position.y,
        //     camera.position.z,
        // );

        // FIX: Set up mouse tracking for custom shader
        window.addEventListener('mousemove', (event) => {
            customShader.updateMouse(
                event.clientX / window.innerWidth,
                1.0 - (event.clientY / window.innerHeight)
            );
        });

        // Force pipeline recompile on next frame
        glassMat.needsUpdate = true;
    }).catch((error) => { console.log("Custom shader setup failed: "), error });

    function animate(){
        // plane.rotation.x += 0.01;
        //plane.rotation.y += 0.01;

        if (customShaderInstance) {
            customShaderInstance.updateCameraPosition(
                camera.position.x,
                camera.position.y,
                camera.position.z
            );
        }

        renderer.render(scene, camera);
    }
    await renderer.setAnimationLoop(animate);
}

init().then(r => {
    console.log('Renderer initialized.');

}); // call init to start

// 6. Handle window resize
window.addEventListener('resize', ()=> {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
})

window.addEventListener('mousemove', onMouseMove);