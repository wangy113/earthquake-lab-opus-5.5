// Phase 1 vertical slice: one soft-story building on a street corner, one quake, one collapse.
// URL options: ?sky=a (urban HDRI backdrop) or ?sky=b (pure sky, default), ?post=0, ?gl=1 (force
// WebGL2), ?csm=0 (single shadow map). Deep link: #test=1&run starts the quake on load.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, normalView, builtinAOContext, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { loadManifest, pbrMaterial, loadModel, assetUrl } from './world/assets';
import { loadHdri, sunDirection, groundedSky } from './render/lighting';
import { createRenderer } from './render/renderer';
import { Kit } from './world/kit';
import { buildSoftStoryVisual } from './world/softStoryVisual';
import { softStoryLayout, STORY_H } from './sim/building/softStory';
import { Scenario, type SimEvent } from './sim/scenario';
import { makeQuake } from './sim/quake/synthetic';
import { PHASE1_QUAKE } from './config/scenarios';
import { Dust } from './fx/dust';
import { Sound } from './audio/sound';
import { Hud } from './ui/hud';
import { installLab } from './debug/lab';

const params = new URLSearchParams(location.search);
const skyMode = params.get('sky') === 'a' ? 'a' : 'b';
const usePost = params.get('post') !== '0';
const useCsm = params.get('csm') !== '0';
const hud = new Hud();

const CAMERAS = {
  plaza: { pos: new THREE.Vector3(9, 1.7, 21), target: new THREE.Vector3(6, 5.5, -4), fov: 55 },
  corner: { pos: new THREE.Vector3(22, 3.2, 12), target: new THREE.Vector3(6, 4.5, -4), fov: 45 },
  above: { pos: new THREE.Vector3(26, 17, 24), target: new THREE.Vector3(6, 4, -4), fov: 40 },
};
type CamName = keyof typeof CAMERAS;

async function boot() {
  hud.loading('Starting the renderer');
  const { renderer, backend } = await createRenderer({ antialias: !usePost, forceWebGL: params.get('gl') === '1' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 2;
  controls.maxDistance = 90;
  const setCam = (name: CamName) => {
    const c = CAMERAS[name];
    camera.position.copy(c.pos);
    controls.target.copy(c.target);
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  };
  setCam('plaza');

  hud.loading('Loading Poly Haven assets');
  const m = await loadManifest();
  const skyId = skyMode === 'a' ? 'wide_street_01' : 'kloofendal_48d_partly_cloudy_puresky';
  const L = softStoryLayout();
  const propModels = [...new Set(L.props.map(p => p.model))];
  const [hdr, asphalt, pavement, slabMat, plaster, kitScene, shutter, lamp, hydrant, ...propScenes] = await Promise.all([
    loadHdri(assetUrl(m.hdris[skyId].url)),
    pbrMaterial(m, 'asphalt_02', 3),
    pbrMaterial(m, 'concrete_pavement', 1.8),
    pbrMaterial(m, 'concrete_floor_worn_001', 3),
    pbrMaterial(m, 'plastered_wall_04', 2),
    loadModel(m, 'modular_urban_apartments_facade'),
    loadModel(m, 'rollershutter_door'),
    loadModel(m, 'street_lamp_01'),
    loadModel(m, 'fire_hydrant'),
    ...propModels.map(id => loadModel(m, id)),
  ]);
  const propScene = new Map(propModels.map((id, i) => [id, propScenes[i]]));
  hud.loading('Starting the physics engine');
  await RAPIER.init();

  // Sky and light. The sun sits at the HDRI's brightest spot. The environment is turned down a
  // little so the direct sun and its shadows carry the form (Phase 2 clamps the sun out of the
  // HDRI properly).
  scene.environment = hdr;
  scene.environmentIntensity = 0.75;
  if (skyMode === 'a') scene.add(groundedSky(hdr));
  else { scene.background = hdr; scene.backgroundIntensity = 1; }
  const sun = new THREE.DirectionalLight(0xfff1de, 4.2);
  sun.position.copy(sunDirection(hdr)).multiplyScalar(90).add(new THREE.Vector3(6, 0, -4));
  sun.target.position.set(6, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  if (useCsm) {
    const csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 140, mode: 'practical' });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
  } else {
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
  }
  scene.add(sun, sun.target);

  // Street: everything fixed to the ground moves with the ground body.
  const groundGroup = new THREE.Group();
  scene.add(groundGroup);
  const plane = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    groundGroup.add(mesh);
  };
  plane(400, 400, pavement, 6, 0, 0);
  plane(400, 7, asphalt, 6, 0.004, 13.5);
  for (const [obj, x, z, ry] of [[lamp, -1.2, 3.2, Math.PI], [lamp, 13.2, 3.2, Math.PI], [hydrant, 15.0, 2.6, -0.4]] as const) {
    const o = obj.clone(true);
    o.position.set(x, 0, z);
    o.rotation.y = ry;
    groundGroup.add(o);
  }

  // The building.
  const kit = new Kit(kitScene);
  const vis = buildSoftStoryVisual(L, kit, shutter, { plaster, slab: slabMat, column: slabMat });
  scene.add(vis.root);

  // Furniture and plaza props, centered on their colliders.
  const synced = new Map<string, THREE.Object3D>();
  for (const p of L.props) {
    const src = propScene.get(p.model)!.clone(true);
    let box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    // Some Poly Haven files carry a unit scale (steel_frame_shelves_01 loads 10x too big).
    // Fit the model to its real height, which is what the collider uses.
    const fit = p.size[1] / size.y;
    if (Math.abs(fit - 1) > 0.15) {
      src.scale.multiplyScalar(fit);
      box = new THREE.Box3().setFromObject(src);
      console.info(`prop ${p.model}: scaled by ${fit.toFixed(3)} to its real size`);
    }
    src.position.sub(box.getCenter(new THREE.Vector3()));
    const g = new THREE.Group();
    g.add(src);
    scene.add(g);
    synced.set(p.id, g);
  }
  for (const [id, o] of vis.pieces) synced.set(id, o);
  for (const [id, o] of vis.slabs) synced.set(id, o);

  const dust = new Dust(scene);
  const sound = new Sound();

  // Simulation.
  const sim = new Scenario(RAPIER, L);
  for (let i = 0; i < 60; i++) sim.step(); // furniture settles before anyone looks
  let eventIndex = sim.events.length;
  let block: THREE.Group | null = null;
  let kick = 0;
  const floorRest = (i: number) => new THREE.Vector3(...sim.floorRest(i));
  const pieceMat = slabMat;

  const startQuake = () => {
    if (sim.quake) return;
    sound.init();
    sim.startQuake(makeQuake(PHASE1_QUAKE));
    hud.setRunning(true);
  };

  const handle = (e: SimEvent) => {
    switch (e.kind) {
      case 'crack':
        sound.crack(0.6);
        hud.note(`${L.structure.stories[e.story].label} is cracking`);
        break;
      case 'fail':
        sound.crack(1);
        sound.impact(1, true);
        dust.puff(e.pos[0], 1.5, e.pos[2] + 1, 70, 2.6, 10);
        kick = 1;
        hud.note(`${L.structure.stories[e.story].label} failed ${(e.t - sim.quakeT0).toFixed(1)} s into the quake`);
        break;
      case 'collapse': {
        // Start the block where floor 1 is drawn now, before the fall, so the upper stories
        // attach with their real offsets. sync() then moves it with the body.
        block = new THREE.Group();
        scene.add(block);
        const slab1 = vis.slabs.get(e.block)!;
        slab1.updateMatrixWorld();
        slab1.matrixWorld.decompose(block.position, block.quaternion, new THREE.Vector3());
        block.updateMatrixWorld();
        for (const [id, slab] of vis.slabs) { block.attach(slab); synced.delete(id); }
        for (const s of vis.stories) block.attach(s.group);
        synced.set(e.block, block);
        break;
      }
      case 'remove':
        synced.get(e.id)?.removeFromParent();
        synced.delete(e.id);
        break;
      case 'spawn': {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(e.half[0] * 2, e.half[1] * 2, e.half[2] * 2), e.role === 'chunk' ? pieceMat : vis.columnMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        scene.add(mesh);
        synced.set(e.id, mesh);
        break;
      }
      case 'impact':
        sound.impact(e.p, e.heavy);
        if (e.heavy) dust.puff(e.pos[0], Math.max(0.3, e.pos[1] - 1), e.pos[2], 40, 2.2, 8);
        else if (e.p > 0.5) dust.puff(e.pos[0], e.pos[1], e.pos[2], 4, 0.6);
        break;
      default:
        break;
    }
  };

  const sync = () => {
    for (const [id, o] of synced) {
      const b = sim.bodies.get(id);
      if (!b) continue;
      const t = b.body.translation(), r = b.body.rotation();
      o.position.set(t.x, t.y, t.z);
      o.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const g = sim.bodies.get('ground')!.body.translation();
    groundGroup.position.set(g.x, 0, g.z);
    // After a collapse the upper floors are one rigid block (attached in the 'collapse' event).
    if (block || sim.failedAt !== null) return;
    // Story skinning: each upper story shears between the floor below and the floor above.
    const off = (i: number) => i === 0 ? new THREE.Vector3(g.x, 0, g.z)
      : new THREE.Vector3().copy(sim.bodies.get(`floor:${i}`)!.body.translation() as THREE.Vector3Like).sub(floorRest(i));
    for (let s = 2; s <= L.stories; s++) {
      const u = vis.stories[s - 2].u;
      u.bottom.value.copy(off(s - 1));
      u.top.value.copy(off(s));
    }
  };
  sync();

  // Post: GTAO from a normal pre-pass, fed back into lighting, then temporal AA.
  let pipeline: THREE.RenderPipeline | null = null;
  if (usePost) {
    pipeline = new THREE.RenderPipeline(renderer);
    const prePass = pass(scene, camera);
    prePass.setMRT(mrt({ output: normalView }));
    const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    aoPass.resolutionScale = 0.5;
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, velocity }));
    scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    pipeline.outputNode = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Controls.
  let slow = false;
  hud.onStart = startQuake;
  hud.onReset = () => { location.hash = ''; location.reload(); };
  hud.onSlow = on => { slow = on; sound.slow = on; };
  hud.onSound = on => { sound.init(); sound.setEnabled(on); };
  hud.onCamera = name => setCam(name as CamName);
  hud.setPeriod(sim.building.periods[0]);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stats = { fps: 0, backend, sky: skyId, post: usePost };
  const shake = new THREE.Vector3();
  let frames = 0, fpsT = performance.now(), last = fpsT, uiT = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (sim.advance(dt * (slow ? 0.25 : 1)) > 0) {
      // Events first: 'collapse' needs the drawn pose from before this step.
      while (eventIndex < sim.events.length) handle(sim.events[eventIndex++]);
      sync();
    }
    dust.update(dt * (slow ? 0.25 : 1));
    sound.tick(sim.groundAccelG());
    controls.update();
    // Camera shake on a tripod near the street: small, from the ground motion plus a kick on impact.
    shake.set(0, 0, 0);
    if (!reduceMotion) {
      const k = sim.groundAccelG() * 0.04 + kick * 0.12;
      if (k > 0.0005) shake.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    kick *= 0.9;
    camera.position.add(shake);
    if (pipeline) pipeline.render(); else renderer.render(scene, camera);
    camera.position.sub(shake);

    frames++;
    if (now - fpsT > 1000) { stats.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
    if (now - uiT > 100) {
      uiT = now;
      const rep = sim.report();
      hud.update({ t: rep.quakeTime, g: sim.groundAccelG(), stories: rep.stories, failedAt: rep.failedAt, fps: stats.fps, backend });
      if (sim.quake && rep.quakeTime > sim.quake.n * sim.quake.dt) hud.setRunning(false);
    }
  });

  installLab({
    ready: true,
    stats,
    report: () => sim.report(),
    scene,
    start: startQuake,
    /** Step the simulation directly (headless tests run far below real time). */
    fastForward(seconds: number) {
      for (let i = 0; i < Math.round(seconds * 120); i++) sim.step();
      while (eventIndex < sim.events.length) handle(sim.events[eventIndex++]);
      sync();
    },
    camera: (name: CamName) => setCam(name),
    get storyHeight() { return STORY_H; },
  });
  hud.ready();
  if (/run/.test(location.hash)) setTimeout(startQuake, 1200);
}

boot().catch(err => {
  console.error(err);
  hud.loading(`Something failed to load: ${err.message}`);
  installLab({ error: String(err) });
});
