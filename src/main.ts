// Phase 2: the full street. Five buildings sway in one quake, building 2 (soft story) can collapse.
// URL options: ?time=midday|clear|golden|overcast, ?post=0, ?gl=1 (force WebGL2), ?csm=0 (single
// shadow map), ?shadows=full (every facade casts its own shadow instead of proxies), ?filler=0.
// Quake: ?quake=near|far (presets), or ?m=6.5&d=12&site=rock, plus ?seed=N. ?quake=phase1 plays
// the Phase 1 stopgap record. Deep link: #test=1&run starts the quake on load.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, normalView, builtinAOContext, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadManifest, pbrMaterial, loadModel, assetUrl } from './world/assets';
import { mergeStatic, simplifyModel } from './world/geometry';
import { loadHdri } from './render/lighting';
import { analyzeSky, skyRotation, SKIES, type SkyName, type SkyAnalysis } from './render/sky';
import { createRenderer } from './render/renderer';
import { Kit } from './world/kit';
import { buildSoftStoryVisual } from './world/softStoryVisual';
import { buildBuilding, type BuildingVisual } from './world/buildingGen';
import { buildStreet, pick } from './world/street';
import { buildFiller } from './world/filler';
import { softStoryLayout, STORY_H } from './sim/building/softStory';
import { streetBuildings, STREET_X } from './sim/street';
import { Scenario, type SimEvent } from './sim/scenario';
import { makeQuake } from './sim/quake/synthetic';
import { PHASE1_QUAKE, QUAKE_PRESETS, type QuakePreset } from './config/scenarios';
import { makeGroundMotion, type GroundMotion, type Site } from './sim/quake/groundMotion';
import { Seismograph } from './ui/seismograph';
import type { QuakeSettings } from './ui/hud';
import { Dust } from './fx/dust';
import { Sound } from './audio/sound';
import { Hud } from './ui/hud';
import { installLab } from './debug/lab';

const params = new URLSearchParams(location.search);
const timeParam = params.get('time') ?? 'midday';
const firstSky: SkyName = timeParam in SKIES ? timeParam as SkyName : 'midday';
const shadowProxies = params.get('shadows') !== 'full';
const usePost = params.get('post') !== '0';
const useCsm = params.get('csm') !== '0';
const hud = new Hud();

const CAMERAS = {
  plaza: { pos: new THREE.Vector3(20, 1.7, 33), target: new THREE.Vector3(22, 11, -6), fov: 62 },
  corner: { pos: new THREE.Vector3(19, 1.7, 15), target: new THREE.Vector3(6, 5, -4), fov: 50 },
  street: { pos: new THREE.Vector3(-13, 1.7, 3.2), target: new THREE.Vector3(30, 7, -3), fov: 55 },
  station: { pos: new THREE.Vector3(70, 1.7, 7), target: new THREE.Vector3(60, 2.5, -3), fov: 50 }, // lab only, no button yet
  drone: { pos: new THREE.Vector3(STREET_X.center + 8, 38, 62), target: new THREE.Vector3(STREET_X.center, 14, -8), fov: 50 },
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
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Eye-level views look up at the buildings, so the camera may sit below its target.
  controls.maxPolarAngle = Math.PI * 0.64;
  controls.minDistance = 2;
  controls.maxDistance = 220;
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
  const L = softStoryLayout();
  const others = streetBuildings();
  const propModels = [...new Set([...L.props.map(p => p.model), 'metal_office_desk', 'Sofa_01', 'potted_plant_02', 'steel_frame_shelves_01', 'plastic_monobloc_chair_01', 'wooden_crate_01', 'cardboard_box_01'])];
  const tex = (id: string, tile: number) => pbrMaterial(m, id, tile);
  const model = (id: string) => loadModel(m, id);
  const [hdr0, asphalt, pavement, plaza, curb, slabMat, plaster, metal, brickMat, fillerMats, aptScene, brickScene, shutter,
    lamp, lamp2, hydrant, trash, utility, manhole, poles, bench, planter1, planter2, ...propScenes] = await Promise.all([
    loadHdri(assetUrl(m.hdris[SKIES[firstSky].hdri].url)),
    tex('asphalt_02', 3), tex('concrete_pavement', 1.8), tex('patterned_paving', 2.5), tex('rough_concrete', 1.5),
    tex('concrete_floor_worn_001', 3), tex('plastered_wall_04', 2), tex('metal_plate', 1.5), tex('red_brick_03', 1.6),
    Promise.all([['grey_plaster', 3], ['red_brick_03', 2], ['rectangular_facade_tiles', 3], ['concrete_wall_008', 3]].map(([id, t]) => tex(id as string, t as number))),
    model('modular_urban_apartments_facade'), model('modular_factory_facade'), model('rollershutter_door'),
    model('street_lamp_01'), model('street_lamp_02'), model('fire_hydrant'), model('metal_trash_can'), model('utility_box_01'),
    model('water_manhole_cover'), model('modular_electricity_poles'), model('painted_wooden_bench'), model('planter_box_01'), model('planter_box_02'),
    ...propModels.map(id => model(id)),
  ]);
  const propScene = new Map(propModels.map((id, i) => [id, propScenes[i]]));
  // Strip millimeter bevels from every model (docs/DECISIONS.md, Phase 2 budget).
  await MeshoptSimplifier.ready;
  const simplifyMm = +(params.get('simplify') ?? 3) / 1000;
  const simplified = { before: 0, after: 0 };
  if (simplifyMm > 0) {
    for (const o of [aptScene, brickScene, shutter, lamp, lamp2, hydrant, trash, utility, manhole, poles, bench, planter1, planter2, ...propScenes]) {
      const r = simplifyModel(MeshoptSimplifier, o, simplifyMm);
      simplified.before += r.before; simplified.after += r.after;
    }
  }
  hud.loading('Starting the physics engine');
  await RAPIER.init();

  // Sky and light (render/sky.ts): the sun is measured from the HDRI and clamped out of the
  // environment map, so it lights the scene once, through the directional light.
  const sun = new THREE.DirectionalLight(0xffffff, 4);
  const sunTarget = new THREE.Vector3(STREET_X.center, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  if (useCsm) {
    const csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 220, mode: 'practical' });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
  } else {
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  }
  scene.add(sun, sun.target);
  const fog = new THREE.FogExp2(0xb8c2cc, 0.0024);
  scene.fog = fog;
  const skies = new Map<SkyName, { hdr: THREE.DataTexture; a: SkyAnalysis }>();
  let skyName = firstSky;
  const applySky = async (name: SkyName) => {
    skyName = name;
    let entry = skies.get(name);
    if (!entry) {
      const hdr = name === firstSky && hdr0 ? hdr0 : await loadHdri(assetUrl(m.hdris[SKIES[name].hdri].url));
      entry = { hdr, a: analyzeSky(hdr, SKIES[name].minElevation) };
      skies.set(name, entry);
    }
    if (skyName !== name) return; // another choice arrived while this one loaded
    const { hdr, a } = entry;
    scene.background = hdr;
    scene.environment = a.env;
    scene.environmentIntensity = 1;
    sun.color.copy(a.sunColor);
    sun.intensity = a.sunIrradiance;
    sun.castShadow = a.sunIrradiance > 0.2;
    const rot = skyRotation(a.sunDir, SKIES[name].sunFrom);
    scene.backgroundRotation.set(0, rot, 0);
    scene.environmentRotation.set(0, rot, 0);
    sun.position.copy(a.sunDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).multiplyScalar(160).add(sunTarget);
    sun.target.position.copy(sunTarget);
    fog.color.copy(a.horizon).multiplyScalar(1 / Math.max(a.horizon.r, a.horizon.g, a.horizon.b, 1e-3)).multiplyScalar(0.78);
    // Light on the street is sun plus sky. Exposure follows it partway, so golden hour and
    // overcast still look darker than noon, as they do to the eye.
    const ground = a.sunIrradiance * Math.max(0.1, a.sunDir.y) + Math.PI * a.skyMean;
    renderer.toneMappingExposure = 1.05 * SKIES[name].exposure * Math.pow(4.6 / ground, 0.7);
  };
  await applySky(firstSky);

  // Street: everything fixed to the ground moves with the ground body.
  const groundGroup = new THREE.Group();
  scene.add(groundGroup);
  const street = buildStreet({ sidewalk: pavement, road: asphalt, plaza, curb, metal }, {
    lamp1: lamp, lamp2,
    hydrant: pick(hydrant, n => !n.includes('aged')),
    trash: pick(trash, n => !n.includes('rust')),
    utility, manhole,
    poles: pick(poles, n => n.startsWith('preset_02_')),
    bench, planter1, planter2,
  }, others);
  // Manhole covers lie flat: keep them out of the shadow maps.
  street.traverse(o => { if (o.name.includes('manhole')) o.traverse(c => { c.castShadow = false; }); });
  groundGroup.add(mergeStatic(street));

  // Filler city around the street, fading into aerial haze.
  let fillerTris = 0;
  if (params.get('filler') !== '0') {
    const avoid = [{ x0: STREET_X.min - 4, x1: STREET_X.max + 4, z0: -24, z1: 44 }];
    // Filler textures are pale: tone them down so the street buildings stay the subject.
    const tones = [0xb3ab9f, 0xa08a80, 0x8e959c, 0x9c958b];
    (fillerMats as THREE.MeshStandardNodeMaterial[]).forEach((mt, i) => mt.color.setHex(tones[i]));
    const filler = buildFiller(fillerMats as THREE.MeshStandardNodeMaterial[], avoid);
    scene.add(filler.root);
    fillerTris = filler.triangles;
  }

  // The building.
  const aptKit = new Kit(aptScene), brickKit = new Kit(brickScene);
  const vis = buildSoftStoryVisual(L, aptKit, shutter, { plaster, slab: slabMat, column: slabMat });
  scene.add(vis.root);

  // The other four buildings.
  hud.loading('Building the street');
  const lodOn = params.get('lod') !== '0';
  const neighborVis: BuildingVisual[] = others.map(b => buildBuilding(b, {
    apt: aptKit, brick: brickKit,
    mats: { plaster, slab: slabMat, concrete: curb, metal, brick: brickMat },
    models: propScene, shadowProxies,
    lod: lodOn ? { simplifier: MeshoptSimplifier, near: +(params.get('lodNear') ?? 0), far: +(params.get('lodFar') ?? 0.04), farFrom: 70 } : undefined,
  }));
  for (const v of neighborVis) scene.add(v.root);

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
  const sim = new Scenario(RAPIER, L, others);
  for (let i = 0; i < 60; i++) sim.step(); // furniture settles before anyone looks
  let eventIndex = sim.events.length;
  let block: THREE.Group | null = null;
  let kick = 0;
  const floorRest = (i: number) => new THREE.Vector3(...sim.floorRest(i));
  const pieceMat = slabMat;

  // Quake settings: a preset, or magnitude, distance and ground from the URL or the controls.
  const preset = (params.get('quake') ?? 'near') as QuakePreset | 'phase1';
  const legacyQuake = preset === 'phase1';
  const base: QuakeSettings = { ...QUAKE_PRESETS[preset in QUAKE_PRESETS ? preset as QuakePreset : 'near'] };
  if (params.has('m')) base.magnitude = Math.min(8, Math.max(5.5, +params.get('m')!));
  if (params.has('d')) base.distanceKm = Math.min(200, Math.max(5, +params.get('d')!));
  if (['rock', 'firm', 'soft'].includes(params.get('site') ?? '')) base.site = params.get('site') as Site;
  const seed = params.has('seed') ? +params.get('seed')! : undefined;
  hud.setQuake(base);
  hud.select('#segPreset', preset in QUAKE_PRESETS && !params.has('m') && !params.has('d') && !params.has('site') ? preset : '');
  const seismo = new Seismograph(document.querySelector<HTMLCanvasElement>('#seis')!);
  let waveNotes = { p: false, s: false };

  const startQuake = () => {
    if (sim.quake) return;
    sound.init();
    const rec = legacyQuake ? makeQuake(PHASE1_QUAKE) : makeGroundMotion({ ...hud.quake, seed });
    sim.startQuake(rec);
    seismo.setRecord(rec);
    waveNotes = { p: false, s: false };
    hud.setQuakeLocked(true);
    hud.setRunning(true);
  };

  const handle = (e: SimEvent) => {
    switch (e.kind) {
      case 'crack': {
        sound.crack(e.building ? 0.35 : 0.6);
        const nb = e.building ? others.find(o => o.id === e.building) : null;
        hud.note(nb ? `${nb.label}: story ${e.story + 1} is cracking` : `${L.structure.stories[e.story].label} is cracking`);
        break;
      }
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
      case 'moat': {
        const nb = others.find(o => o.id === e.building);
        sound.impact(Math.min(1, e.speed / 0.6), e.speed > 0.3);
        dust.puff(e.pos[0], 0.2, e.pos[2], 10, 0.8, 3);
        hud.note(`${nb?.label ?? 'Building'} hit the edge of its moat at ${(e.speed * 100).toFixed(0)} cm per second`);
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
    groundGroup.position.set(g.x, g.y, g.z);
    // Neighbors: floor offsets straight from their structure models.
    for (let n = 0; n < sim.neighbors.length; n++) {
      const { model: md } = sim.neighbors[n], arr = neighborVis[n].offsets.array as THREE.Vector3[];
      arr[0].set(g.x + md.bx, g.y, g.z + md.bz); // the isolated base slides, a fixed one is 0
      for (let i = 0; i < md.n; i++) arr[i + 1].set(g.x + md.ux[i], g.y, g.z + md.uz[i]);
    }
    // After a collapse the upper floors are one rigid block (attached in the 'collapse' event).
    if (block || sim.failedAt !== null) return;
    // Story skinning: each upper story shears between the floor below and the floor above.
    const off = (i: number) => i === 0 ? new THREE.Vector3(g.x, g.y, g.z)
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
  hud.onSky = name => { applySky(name as SkyName).catch(err => console.error(err)); };
  hud.select('#segSky', firstSky);
  hud.setPeriod(sim.building.periods[0]);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stats = { fps: 0, backend, get sky() { return skyName; }, post: usePost, shadowProxies, triangles: 0, drawCalls: 0, fillerTris, simplified, buildingTris: neighborVis.map(v => Math.round(v.triangles)), farTris: neighborVis.map(v => Math.round((v.root.userData as { farTriangles?: number }).farTriangles ?? 0)) };
  renderer.info.autoReset = false;
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
    seismo.draw(sim.quakeTime);
    sound.tick(sim.groundAccelG());
    controls.update();
    if (camera.position.y < 0.6) camera.position.y = 0.6;
    // Camera shake on a tripod near the street: small, from the ground motion plus a kick on impact.
    shake.set(0, 0, 0);
    if (!reduceMotion) {
      const k = sim.groundAccelG() * 0.04 + kick * 0.12;
      if (k > 0.0005) shake.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    kick *= 0.9;
    camera.position.add(shake);
    renderer.info.reset();
    if (pipeline) pipeline.render(); else renderer.render(scene, camera);
    camera.position.sub(shake);

    frames++;
    if (now - fpsT > 1000) {
      stats.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now;
      stats.triangles = renderer.info.render.triangles;
      stats.drawCalls = renderer.info.render.drawCalls;
    }
    if (now - uiT > 100) {
      uiT = now;
      const rep = sim.report();
      hud.update({ t: rep.quakeTime, g: sim.groundAccelG(), stories: rep.stories, failedAt: rep.failedAt, fps: stats.fps, backend });
      const gm = sim.quake as GroundMotion | null;
      if (gm?.tP !== undefined) {
        if (!waveNotes.p && rep.quakeTime >= gm.tP) {
          waveNotes.p = true;
          hud.note(`P wave: a light up-and-down rattle. The S wave follows in ${(gm.tS - gm.tP).toFixed(1)} s`);
        }
        if (!waveNotes.s && rep.quakeTime >= gm.tS) { waveNotes.s = true; hud.note('S wave: the strong side-to-side shaking'); }
      }
      hud.neighbors(rep.neighbors.map((n, i) => ({ label: n.isolated ? `${others[i].label}, isolated` : others[i].label, period: n.period, roof: n.roof, damage: n.damage })));
      if (sim.quake && rep.quakeTime > sim.quake.n * sim.quake.dt) hud.setRunning(false);
    }
  });

  installLab({
    ready: true,
    stats,
    report: () => sim.report(),
    scene,
    start: startQuake,
    /** Choose the quake before starting: { magnitude, distanceKm, site }. */
    setQuake: (q: QuakeSettings) => hud.setQuake(q),
    get quake() { const q = sim.quake as GroundMotion | null; return q ? { peakG: q.peakG, tP: q.tP, tS: q.tS, seconds: q.n * q.dt, opts: q.opts } : null; },
    /** Step the simulation directly (headless tests run far below real time). */
    fastForward(seconds: number) {
      for (let i = 0; i < Math.round(seconds * 120); i++) sim.step();
      while (eventIndex < sim.events.length) handle(sim.events[eventIndex++]);
      sync();
    },
    camera: (name: CamName) => setCam(name),
    sky: (name: SkyName) => applySky(name),
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
