// [emoji, searchable name]
type E = [string, string]

export const EMOJI_CATEGORIES: Array<{ label: string; emojis: E[] }> = [
  { label: 'Smileys', emojis: [
    ['😀','grinning'],['😁','grin'],['😂','tears of joy'],['🤣','rolling laughing'],['😃','smiley'],
    ['😄','smile'],['😅','sweat smile'],['😆','laughing'],['😉','wink'],['😊','blush'],
    ['😋','yum'],['😎','sunglasses cool'],['😍','heart eyes love'],['🥰','smiling hearts love'],['😘','kiss'],
    ['😗','kissing'],['🤩','star struck excited'],['🥳','partying celebration'],['😏','smirk'],['😒','unamused'],
    ['😞','disappointed'],['😟','worried'],['😔','pensive'],['😢','cry sad'],['😭','sob loud crying'],
    ['😤','steam nose'],['😠','angry'],['😡','rage furious'],['🤬','symbols angry'],['🤯','exploding head'],
    ['😳','flushed'],['🥺','pleading eyes'],['😱','scream'],['😨','fearful'],['😰','anxious sweat'],
    ['😴','sleeping'],['🥱','yawning'],['😷','mask sick'],['🤒','thermometer sick'],['🤧','sneezing'],
    ['🥴','woozy'],['😵','dizzy'],['🤠','cowboy'],['🥸','disguise'],['🤡','clown'],
    ['👻','ghost'],['💀','skull death'],['☠️','skull crossbones'],['👽','alien'],['🤖','robot'],
    ['😈','devil smiling'],['👿','angry devil'],['🙃','upside down'],['🫠','melting'],['🤥','lying'],
  ]},
  { label: 'People', emojis: [
    ['👋','wave hello'],['🤚','raised back hand'],['✋','raised hand'],['🖐️','hand splayed'],['👌','ok'],
    ['🤌','pinched fingers'],['🤏','pinching hand'],['✌️','peace victory'],['🤞','fingers crossed luck'],
    ['🖖','vulcan salute'],['🤙','call me shaka'],['💪','flexed bicep strong'],['🦾','mechanical arm'],
    ['👏','clapping hands'],['🙌','raised hands'],['🤲','open hands'],['🙏','folded hands pray'],
    ['👍','thumbs up'],['👎','thumbs down'],['👊','oncoming fist punch'],['🤛','left fist'],['🤜','right fist'],
    ['👁️','eye'],['👀','eyes look'],['🫶','heart hands'],['🫂','people hugging'],
    ['👶','baby'],['🧒','child'],['👦','boy'],['👧','girl'],['👨','man'],['👩','woman'],
    ['🧑','person'],['🧔','beard'],['👴','old man'],['👵','old woman'],
  ]},
  { label: 'Nature', emojis: [
    ['🐶','dog'],['🐱','cat'],['🐭','mouse'],['🐹','hamster'],['🐰','rabbit'],
    ['🦊','fox'],['🐻','bear'],['🐼','panda'],['🐨','koala'],['🐯','tiger'],
    ['🦁','lion'],['🐮','cow'],['🐷','pig'],['🐸','frog'],['🐵','monkey'],
    ['🦄','unicorn'],['🐔','chicken'],['🐧','penguin'],['🐦','bird'],['🦅','eagle'],
    ['🦆','duck'],['🦉','owl'],['🐺','wolf'],['🐗','boar'],['🦋','butterfly'],
    ['🐌','snail'],['🐢','turtle'],['🐍','snake'],['🦎','lizard'],['🦕','dinosaur'],
    ['🌸','cherry blossom'],['🌺','hibiscus'],['🌻','sunflower'],['🌹','rose'],['🌷','tulip'],
    ['🍀','four leaf clover luck'],['🌿','herb'],['🌱','seedling'],['🌵','cactus'],['🎋','bamboo'],
    ['🌊','wave ocean'],['🔥','fire'],['⭐','star'],['🌙','moon'],['☀️','sun'],
    ['⛄','snowman'],['🌈','rainbow'],['⚡','lightning'],['❄️','snowflake'],['🌍','earth globe'],
  ]},
  { label: 'Food', emojis: [
    ['🍎','apple'],['🍊','tangerine orange'],['🍋','lemon'],['🍇','grapes'],['🍓','strawberry'],
    ['🫐','blueberries'],['🍑','peach'],['🍒','cherries'],['🍌','banana'],['🍉','watermelon'],
    ['🍕','pizza'],['🍔','hamburger burger'],['🌮','taco'],['🌯','burrito'],['🍜','ramen noodles'],
    ['🍝','spaghetti pasta'],['🍣','sushi'],['🍱','bento'],['🥗','salad'],['🥪','sandwich'],
    ['🍩','doughnut donut'],['🍪','cookie'],['🎂','birthday cake'],['🍰','cake slice'],['🍫','chocolate'],
    ['☕','coffee'],['🍵','tea'],['🧃','juice'],['🥤','cup'],['🧋','bubble tea boba'],
    ['🍺','beer'],['🥂','champagne toast'],['🍷','wine'],['🍸','cocktail'],['🍾','bottle celebration'],
  ]},
  { label: 'Activities', emojis: [
    ['⚽','soccer football'],['🏀','basketball'],['🏈','football'],['⚾','baseball'],['🎾','tennis'],
    ['🏐','volleyball'],['🎮','video game controller'],['🕹️','joystick'],['🎲','dice game'],['🃏','joker card'],
    ['🎵','music note'],['🎶','musical notes'],['🎸','guitar'],['🎹','piano'],['🥁','drum'],
    ['🎨','art palette'],['✏️','pencil'],['🖊️','pen'],['📝','memo writing'],['📚','books'],
    ['🏆','trophy'],['🥇','gold medal first'],['🎯','target bullseye'],['🎪','circus'],['🎭','theatre performing arts'],
  ]},
  { label: 'Travel', emojis: [
    ['🚗','car'],['🚕','taxi'],['🚙','suv'],['🚌','bus'],['🏎️','racing car'],
    ['🚂','train locomotive'],['✈️','airplane plane'],['🚀','rocket'],['🛸','flying saucer ufo'],['🛶','canoe boat'],
    ['🏠','house'],['🏰','castle'],['🗽','statue of liberty'],['🗼','tokyo tower'],['🏔️','mountain'],
    ['🌋','volcano'],['🏝️','island beach'],['🌃','night city'],['🌉','bridge night'],['🗺️','map'],
  ]},
  { label: 'Objects', emojis: [
    ['💡','lightbulb idea'],['🔦','flashlight torch'],['💻','laptop computer'],['⌨️','keyboard'],['🖥️','desktop computer'],
    ['📱','mobile phone'],['📷','camera'],['🎥','video camera'],['📺','television tv'],['📻','radio'],
    ['🔑','key'],['🔒','locked'],['🔓','unlocked'],['🔧','wrench tool'],['🔨','hammer'],
    ['⚙️','gear settings'],['🧲','magnet'],['💊','pill medicine'],['🩺','stethoscope medical'],['🧪','test tube science'],
    ['📦','package box'],['📬','mailbox post'],['🎁','gift present'],['💰','money bag'],['💳','credit card'],
    ['🕯️','candle'],['💎','diamond gem'],['👑','crown'],['🎩','top hat'],['👓','glasses'],
  ]},
  { label: 'Symbols', emojis: [
    ['❤️','heart love red'],['🧡','orange heart'],['💛','yellow heart'],['💚','green heart'],['💙','blue heart'],
    ['💜','purple heart'],['🖤','black heart'],['🤍','white heart'],['💔','broken heart'],['❣️','heart exclamation'],
    ['💯','hundred percent'],['✅','check mark'],['❌','cross x no'],['⚠️','warning'],['❗','exclamation'],
    ['❓','question'],['💬','speech bubble'],['💭','thought bubble'],['💤','zzz sleeping'],['♾️','infinity'],
    ['🔴','red circle'],['🟠','orange circle'],['🟡','yellow circle'],['🟢','green circle'],['🔵','blue circle'],
    ['⬆️','up arrow'],['⬇️','down arrow'],['⬅️','left arrow'],['➡️','right arrow'],['🔄','repeat arrows'],
  ]},
]

// [text, name]
type Em = [string, string]

export const EMOTICONS: Em[] = [
  // Classic ASCII
  [':)',   'smile happy'],
  [':D',  'big smile grin'],
  ['XD',  'laughing xd'],
  [':P',  'tongue playful'],
  [';)',   'wink'],
  [':(',   'sad frown'],
  [':/',  'unsure skeptical'],
  ['>:(',  'angry grumpy'],
  ['>:)',  'evil grin'],
  [':O',  'surprised shocked'],
  ['B)',   'cool sunglasses'],
  ['O:)',  'angel innocent'],
  ['T_T', 'crying sad'],
  ['^_^', 'happy cute'],
  ['-_-', 'blank expressionless'],
  ['u_u', 'sleepy tired'],
  ['>.>', 'side eye suspicious'],
  ['<3',  'heart love'],
  ['</3', 'broken heart'],
  ['o/',   'wave hello'],

  // Kaomoji
  ['(ʘ‿ʘ)',         'stare surprised'],
  ['(◕‿◕)',         'cute happy'],
  ['(¬‿¬)',         'smug knowing'],
  ['(°ロ°)',         'shocked open mouth'],
  ['(｡◕‿◕｡)',       'adorable cute'],
  ['(づ｡◕‿‿◕｡)づ',  'hug cute'],
  ['(ᵔᴥᵔ)',         'bear happy'],
  ['ʕ•ᴥ•ʔ',         'bear koala'],
  ['(>^.^<)',        'cute happy'],
  ['(•_•)',          'serious stare'],
  ['( •_•)>⌐■-■',   'deal with it cool'],
  ['(⌐■_■)',         'sunglasses cool deal'],
  ['¬_¬',           'skeptical side eye'],
  ['(^_^)/',        'wave hello'],
  ['(＾▽＾)',        'smile happy big'],
  ['(*^▽^*)',       'excited happy'],
  ['(￣▽￣)',        'smug satisfied'],
  ['(￣ω￣)',        'smug calm'],
  ['(〃＾▽＾〃)',    'blushing shy'],
  ['(>_<)',          'stressed frustrated'],
  ['(T▽T)',          'laughing crying'],
  ['(；一_一)',       'awkward embarrassed'],
  ['(ノ_<。)',        'crying sad'],
  ['(╥_╥)',          'sobbing sad'],

  // Shrug & Tableflip
  ['¯\\_(ツ)_/¯',              'shrug whatever'],
  ['(╯°□°）╯︵ ┻━┻',           'tableflip rage'],
  ['┬──┬ ノ( ゜-゜ノ)',          'table unflip calm'],
  ['(ノಠ益ಠ)ノ彡┻━┻',           'tableflip angry'],

  // Lenny & misc
  ['( ͡° ͜ʖ ͡°)',    'lenny face'],
  ['( ͡~ ͜ʖ ͡°)',   'lenny wink'],
  ['ಠ_ಠ',           'disapproval look of'],
  ['ಠ‿ಠ',           'smug approval'],
  ['◉_◉',           'wide eyes shocked'],
  ['(☞ﾟヮﾟ)☞',       'finger guns pointing'],
  ['☜(ﾟヮﾟ☜)',       'finger guns left'],
  ['(•‿•)',          'smile cute'],
  ['♪~ ᕕ( ᐛ )ᕗ',   'happy walking dancing'],
  ['ᕦ( ͡° ͜ʖ ͡°)ᕤ', 'flexing strong lenny'],
]

export function searchEmojis(query: string): E[] {
  const q = query.toLowerCase()
  const results: E[] = []
  for (const { emojis } of EMOJI_CATEGORIES) {
    for (const e of emojis) {
      if (e[1].includes(q) || e[0] === q) results.push(e)
    }
  }
  return results
}

export function searchEmoticons(query: string): Em[] {
  const q = query.toLowerCase()
  return EMOTICONS.filter(e => e[1].includes(q) || e[0].toLowerCase().includes(q))
}
