// Phase 0 spike page: one kit-built facade on a street corner, lit by a Poly Haven sky,
// with cascaded sun shadows, GTAO and temporal AA. URL options:
//   ?sky=a  urban HDRI as backdrop (GroundedSkybox)     ?sky=b  pure sky (default)
//   ?post=0 turn post-processing off   ?gl=1 force the WebGL2 backend   ?stories=N facade height   ?csm=0 single shadow map
import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, normalView, builtinAOContext, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadManifest, pbrMaterial, loadModel, assetUrl } from './world/assets';
import { loadHdri, sunDirection, groundedSky } from './render/lighting';
import { Kit, buildTestFacade } from './world/kit';
import { installLab } from './debug/lab';
import { createRenderer } from './render/renderer';

const params = new URLSearchParams(location.search);
const skyMode = params.get('sky') === 'a' ? 'a' : 'b';
const usePost = params.get('post') !== '0';
const useCsm = params.get('csm') !== '0';
const stories = Math.max(1, Math.min(12, +(params.get('stories') ?? 3)));
const status = document.querySelector<HTMLElement>('#status')!;
const say = (msg: string) => { status.textContent = msg; };

async function boot() {
  const { renderer, backend } = await createRenderer({ antialias: !usePost, forceWebGL: params.get('gl') === '1' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
  camera.position.set(17, 1.7, 13);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(6, 4, -3);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;

  say('Loading Poly Haven assets');
  const m = await loadManifest();
  const skyId = skyMode === 'a' ? 'wide_street_01' : 'kloofendal_48d_partly_cloudy_puresky';
  const [hdr, asphalt, pavement, slab, plaster, kitScene, lamp, hydrant] = await Promise.all([
    loadHdri(assetUrl(m.hdris[skyId].url)),
    pbrMaterial(m, 'asphalt_02', 3),
    pbrMaterial(m, 'concrete_pavement', 1.8),
    pbrMaterial(m, 'concrete_floor_worn_001', 3),
    pbrMaterial(m, 'plastered_wall_04', 2),
    loadModel(m, 'modular_urban_apartments_facade'),
    loadModel(m, 'street_lamp_01'),
    loadModel(m, 'fire_hydrant'),
  ]);

  // Sky, image-based light and a sun placed at the HDRI's brightest spot.
  if (params.get('env') !== '0') scene.environment = hdr;
  if (skyMode === 'a') scene.add(groundedSky(hdr));
  else scene.background = hdr;
  const sun = new THREE.DirectionalLight(0xfff4e5, 3.2);
  const dir = sunDirection(hdr);
  sun.position.copy(dir).multiplyScalar(80);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  if (useCsm) {
    const csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 120, mode: 'practical' });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
  } else {
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 200 });
  }
  scene.add(sun, sun.target);

  // Street corner: sidewalk along the facade, road beyond it. Large planes with world-scaled UVs.
  const plane = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  plane(400, 400, pavement, 0, 0, 0);       // plaza and sidewalks
  plane(400, 10, asphalt, 0, 0.003, 9);     // a pedestrian-only street surface in front

  // The kit building.
  const kit = new Kit(kitScene);
  const building = buildTestFacade(kit, { bays: 4, depthBays: 3, stories }, plaster, slab);
  scene.add(building);

  for (const [obj, x, z, ry] of [[lamp, 2, 2.8, Math.PI], [lamp, 11, 2.8, Math.PI], [hydrant, 6.5, 2.4, 0]] as const) {
    const o = obj.clone(true);
    o.position.set(x, 0, z);
    o.rotation.y = ry;
    scene.add(o);
  }

  // Post: normals and depth from a pre-pass, GTAO fed back into lighting, then TRAA.
  let pipeline: THREE.RenderPipeline | null = null;
  if (usePost) {
    pipeline = new THREE.RenderPipeline(renderer);
    const prePass = pass(scene, camera);
    prePass.setMRT(mrt({ output: normalView }));
    const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    aoPass.resolutionScale = 0.5;
    const aoTex = aoPass.getTextureNode();
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, velocity }));
    scenePass.contextNode = builtinAOContext(aoTex.sample(screenUV).r);
    pipeline.outputNode = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const stats = { fps: 0, frameMs: 0, triangles: 0, drawCalls: 0, backend, sky: skyId, post: usePost, stories };
  let frames = 0, t0 = performance.now(), last = t0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    controls.update();
    if (pipeline) pipeline.render(); else renderer.render(scene, camera);
    frames++;
    stats.frameMs = stats.frameMs * 0.9 + (now - last) * 0.1;
    last = now;
    if (now - t0 > 1000) {
      stats.fps = Math.round(frames * 1000 / (now - t0));
      frames = 0; t0 = now;
      stats.triangles = renderer.info.render.triangles;
      stats.drawCalls = renderer.info.render.drawCalls;
      say(`${backend}  ${stats.fps} fps  ${(stats.triangles / 1e3).toFixed(0)}k tris  ${stats.drawCalls} draws  sky ${skyMode.toUpperCase()}`);
    }
  });
  installLab({ stats, camera, controls, ready: true });
}

boot().catch(err => {
  console.error(err);
  say(`Failed: ${err.message}`);
  installLab({ error: String(err) });
});
