/*
This code creates refraction and refraction from a normal map. This is the data:
iChannel0: Normal Map
iChannel1: Diffuse Texture Map
iChannel2: Background Image (to be refracted)
iChannel3: Environment Image (to be reflected)
*/

const float pi=3.1416;

const int KEY_LEFT  = 37;
const int KEY_UP    = 38;
const int KEY_RIGHT = 39;
const int KEY_DOWN  = 40;


float random (vec2 st) {
    return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123);
}

float smooth_step( float min, float max, float x )
{
    float t =(x - min) / (max - min);
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t); // smoothstep formula
    return t;
}

float step2( float min, float max, float x )
{
    float t =(x - min) / (max - min);
    t = clamp(t, 0.0, 1.0);
    return t;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{

    vec2 uv = fragCoord/iResolution.xy; //Normalized pixel coordinates

    vec3 col = vec3(0.0);
    vec3 spec= vec3(1.0,1.0,0.9);
    vec3 ambi= vec3(0.10,0.10,0.60);
    vec3 diff= vec3(1.00,0.80,0.50);
    vec4 img0 = texture(iChannel0, uv); // normal
    vec4 img1=  texture(iChannel1, uv); // diffuse
    vec4 img2=  texture(iChannel2, uv); // background

    float Kt=img1.a;
    float a=img0.a;
    ambi = (0.1*ambi+img1.xyz)/1.1;
    diff = (0.1*diff+img1.xyz)/1.1;

    float F;
    float ior=2.0*iMouse.x/iResolution.x-1.0;
    ior=pow(2.0,ior);

    vec3 eye=vec3(0.0,0.0,10.0);
    // eye = eye-vec3(fragCoord,0.0); //Eye is a Position
    eye = eye/length(eye);


    vec3 normals;
    vec3 reflect, refract;
    float d=100.0;
    vec3 lightpos = vec3(iMouse.x,iMouse.y,d/2.0);
    //vec3 dir=lightpos/length(lightpos); // directional light
    vec3 dir = lightpos-vec3(fragCoord,0.0);
    dir=dir/length(dir); //Eye is a direction


    normals= 2.0*img0.rgb - vec3(1.0);
    normals = normals/length(normals);
    float C=dot(eye,normals);
    reflect = 2.0*C*normals-eye;
    refract = -eye;
    if(C*C-1.0+ior*ior>0.0) refract = 1.0/ior*(-eye+(C-sqrt(C*C-1.0+ior*ior))*normals) ;
    float t= 0.5*dot(dir,normals)+0.5;
    float s= 0.5*dot(reflect,dir)+0.5;
    float b=1.0;
    //Fake Fresnel
    F=fc[2]*(1.0-C)*(1.0-C)+fc[1]*2.0*C*(1.0-C)+fc[0]*C*C;
    F-clamp(F,0.0,1.0);
    /* //Real Fresnel
    float Ct=dot(refract,-normals);
    F=abs((Ct-ior*C)/(Ct+ior*C));
    F=pow(F,2.0);
    if(C*C-1.0+ior*ior<0.0) F=1.0;
    */


    vec2 reflected_uv= (reflect.xy*d/(reflect.z+0.01) +fragCoord+lightpos.xy)/iResolution.xy;
    vec4 reflected_env= texture(iChannel3, reflected_uv);
    vec2 refracted_uv= (refract.xy*d/(reflect.z+0.01) +fragCoord)/iResolution.xy;
    vec4 refracted_bg= texture(iChannel2, refracted_uv);
    vec3 Fresnel_mix=F*reflected_env.xyz+(1.0-F)*refracted_bg.xyz;



    t=step2(0.1,0.99,t);
    //t=t/0.99;
    //s=pow(s,4.0);
    s=step2(0.9,1.0,s);
    //t=smooth_step(0.1,0.9,t);
    //t=0.5*sin(2.0*pi*t/0.50)+0.5;


    col = ambi*(1.0-t)+diff*t;
    col= col*Kt+(1.0-Kt)*max(Fresnel_mix,spec*s) ;
    col = col*a+(1.0-a)*img2.xyz;

    fragColor = vec4(col,1.0);    // Output to screen
}