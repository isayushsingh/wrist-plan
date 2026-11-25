// Maps dataset exercises to movements. A movement listed in RENDERED has a 3D animation in
// tools/render3d/render.html (EX[key]); other keys fall back to the original raster animation.
// Keys here must match the EX keys there.

export const MOTIONS = {
  bench: 'Bench press', 'bench-incline': 'Incline press', chestpress: 'Machine chest press',
  ohp: 'Shoulder press', arnold: 'Arnold press', lateral: 'Lateral raise', frontraise: 'Front raise',
  fly: 'Chest fly', crossover: 'Cable crossover', 'crossover-up': 'Low-to-high crossover',
  pushdown: 'Triceps pushdown', ohext: 'Overhead triceps extension', skull: 'Skull crusher',
  curl: 'Biceps curl', 'curl-hammer': 'Hammer curl', preacher: 'Preacher curl',
  legext: 'Leg extension', legcurl: 'Leg curl', legpress: 'Leg press',
  calfseated: 'Seated calf raise', calfstand: 'Standing calf raise',
  pulldown: 'Lat pulldown', pullup: 'Pull-up', cablerow: 'Seated cable row', row: 'Bent-over row',
  facepull: 'Rear-delt row', 'face-pull': 'Face pull', shrug: 'Shrug (dumbbells)', 'shrug-bb': 'Shrug (barbell)',
  'shrug-smith': 'Shrug (Smith machine)', 'upright-row': 'Upright row',
  rdl: 'Romanian deadlift', deadlift: 'Deadlift', squat: 'Squat (barbell)', 'squat-front': 'Squat',
  lunge: 'Lunge', bridge: 'Glute bridge',
  hangraise: 'Hanging leg raise', crunch: 'Crunch', deadbug: 'Dead bug', twist: 'Russian twist',
  plank: 'Plank', pushup: 'Push-up', dip: 'Dip',
};

// first match wins: [regex on the cleaned exercise name, motion key or fn(name, equipment) → key]
const RULES = [
  // cardio, stretches and explosive lifts have no fitting movement: they keep the original animation
  [/(?<!out)stretch|mobility|foam|\broll(er|ing)?\b|\bjump|\brun\b|\brunning\b|sprint|\bbike\b|cycl|\bwalk(?!ing lunge)|\bskip|burpee|\bjacks?\b|climber|\bswing|\bclean\b|snatch|\bthrow|\bslam|windmill|abduction|adduction/, null],
  [/leg press|sled .*press|hack squat/, 'legpress'],
  [/leg extension/, 'legext'],
  [/leg curl|hamstring curl/, 'legcurl'],
  [/calf|heel raise/, (n) => (/seated/.test(n) ? 'calfseated' : 'calfstand')],
  [/romanian|stiff[- ]?leg|good morning|single leg deadlift/, 'rdl'],
  [/deadlift|rack pull/, 'deadlift'],
  [/hip thrust|bridge|hip raise|hip lift|pelvic tilt|hip extension/, 'bridge'],
  [/lunge|split squat|step[- ]?up/, 'lunge'],
  [/squat/, (n, eq) => (eq === 'bb' ? 'squat' : 'squat-front')],
  [/pulldown|pull-down|pull down/, 'pulldown'],
  [/pull[- ]?up|chin[- ]?up|muscle up/, 'pullup'],
  [/face pull/, 'face-pull'],
  [/rear delt|reverse fly|rear lateral/, 'facepull'],
  [/upright row/, 'upright-row'],
  [/(seated|cable|machine|lever|low).*row|row.*(seated|cable|machine)/, 'cablerow'],
  [/row/, 'row'],
  [/smith.*shrug|shrug.*smith/, 'shrug-smith'],
  [/shrug/, (n, eq) => (eq === 'bb' ? 'shrug-bb' : 'shrug')],
  [/skull|lying.*(triceps|tricep) extension|lying extension/, 'skull'],
  [/push ?down|press ?down/, 'pushdown'],
  [/overhead.*(triceps|extension)|triceps extension|tricep extension|french press|kickback/, 'ohext'],
  [/preacher|spider curl|concentration curl/, 'preacher'],
  [/hammer curl/, 'curl-hammer'],
  [/curl/, 'curl'],
  [/lateral raise|side raise|lateral delt/, 'lateral'],
  [/front raise/, 'frontraise'],
  [/arnold/, 'arnold'],
  [/shoulder press|military press|overhead press|push press|landmine press/, 'ohp'],
  [/low to high|low-to-high|upper chest crossover|low cable fly|incline.*cable fly/, 'crossover-up'],
  [/crossover|cable fly|cable chest fly|pec deck|chest fly machine|standing fly/, 'crossover'],
  [/fly|flye/, 'fly'],
  [/incline.*press/, 'bench-incline'],
  [/(lever|machine).*chest press|chest press/, 'chestpress'],
  [/bench press|floor press|decline.*press|close[- ]grip press|chest press/, 'bench'],
  [/push[- ]?up|press[- ]?up/, 'pushup'],
  [/dip/, 'dip'],
  [/hanging.*(leg|knee) raise|captains chair|toes to bar/, 'hangraise'],
  [/dead bug|bird dog|lying leg raise|leg raise|flutter|scissor/, 'deadbug'],
  [/twist|woodchop|wood chop|russian/, 'twist'],
  [/crunch|sit[- ]?up|jackknife|v[- ]up|pull[- ]in|knee tuck/, 'crunch'],
  [/plank|hollow|hold/, 'plank'],
  [/\bpress\b/, 'ohp'],
];

function equipmentKey(eq) {
  eq = (eq || '').toLowerCase();
  if (/barbell|smith|trap bar/.test(eq)) return 'bb';
  if (/dumbbell/.test(eq)) return 'db';
  if (/kettlebell/.test(eq)) return 'kb';
  if (/cable|rope|band/.test(eq)) return 'cable';
  if (/machine|lever|sled|assisted/.test(eq)) return 'machine';
  return 'bw';
}

// movements with a 3D render (EX in tools/render3d/render.html)
export const RENDERED = new Set(['bench', 'bench-incline', 'chestpress', 'ohp', 'arnold', 'lateral', 'frontraise', 'fly',
  'crossover-up', 'pushdown', 'ohext', 'skull', 'curl', 'curl-hammer', 'preacher', 'legext', 'legcurl', 'legpress',
  'calfseated', 'pulldown', 'cablerow', 'row', 'facepull', 'face-pull', 'shrug', 'shrug-bb', 'shrug-smith', 'upright-row', 'rdl', 'squat', 'lunge', 'bridge', 'hangraise', 'deadbug',
  'pushup', 'twist']);

export function motionFor(name, equipment) {
  const n = name.toLowerCase(), eq = equipmentKey(equipment);
  for (const [re, m] of RULES) if (re.test(n)) return typeof m === 'function' ? m(n, eq) : m;
  return null;
}

// dataset muscle names → the figure's muscle groups
const MUSCLE = {
  pectorals: 'chest', chest: 'chest', 'upper chest': 'chest', 'serratus anterior': 'chest',
  delts: 'delts', shoulders: 'delts', deltoids: 'delts', 'rear deltoids': 'delts', 'rotator cuff': 'delts',
  triceps: 'triceps', biceps: 'biceps', brachialis: 'biceps',
  forearms: 'forearms', wrists: 'forearms', 'wrist flexors': 'forearms', 'wrist extensors': 'forearms', 'grip muscles': 'forearms', hands: 'forearms',
  lats: 'lats', 'latissimus dorsi': 'lats', back: 'lats',
  'upper back': 'traps', traps: 'traps', trapezius: 'traps', rhomboids: 'traps', 'levator scapulae': 'traps', sternocleidomastoid: 'traps',
  spine: 'lowerback', 'lower back': 'lowerback',
  abs: 'abs', core: 'abs', obliques: 'abs', abdominals: 'abs', 'lower abs': 'abs',
  glutes: 'glutes', abductors: 'glutes',
  quads: 'quads', quadriceps: 'quads', 'hip flexors': 'quads', adductors: 'quads', 'inner thighs': 'quads', groin: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves', soleus: 'calves',
};

export function musclesFor(e) {
  const p = [...new Set([e.target].map((m) => MUSCLE[(m || '').toLowerCase()]).filter(Boolean))];
  const s = [...new Set((e.secondary_muscles || []).map((m) => MUSCLE[(m || '').toLowerCase()]).filter((m) => m && !p.includes(m)))].slice(0, 3);
  return { p, s };
}

export function motionInfo(e) {
  return { m: motionFor(e.name, e.equipment), eq: equipmentKey(e.equipment), ...musclesFor(e) };
}
