// src/lib/tools/crypto-wallet.ts
// Bitcoin and Monero wallet operations using only Node.js built-ins.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ---------------------------------------------------------------------------
// BIP39 wordlist (2048 words — standard English list)
// ---------------------------------------------------------------------------
const BIP39_WORDLIST: string[] = [
  "abandon","ability","able","about","above","absent","absorb","abstract","absurd","abuse",
  "access","accident","account","accuse","achieve","acid","acoustic","acquire","across","act",
  "action","actor","actress","actual","adapt","add","addict","address","adjust","admit",
  "adult","advance","advice","aerobic","afford","afraid","again","age","agent","agree",
  "ahead","aim","air","airport","aisle","alarm","album","alcohol","alert","alien",
  "all","alley","allow","almost","alone","alpha","already","also","alter","always",
  "amateur","amazing","among","amount","amused","analyst","anchor","ancient","anger","angle",
  "angry","animal","ankle","announce","annual","another","answer","antenna","antique","anxiety",
  "any","apart","apology","appear","apple","approve","april","arch","arctic","area",
  "arena","argue","arm","armor","army","around","arrange","arrest","arrive","arrow",
  "art","artefact","artist","artwork","ask","aspect","assault","asset","assist","assume",
  "asthma","athlete","atom","attack","attend","attitude","attract","auction","audit","august",
  "aunt","author","auto","autumn","average","avocado","avoid","awake","aware","away",
  "awesome","awful","awkward","axis","baby","balance","bamboo","banana","banner","bar",
  "barely","bargain","barrel","base","basic","basket","battle","beach","bean","beauty",
  "because","become","beef","before","begin","behave","behind","believe","below","belt",
  "bench","benefit","best","betray","better","between","beyond","bicycle","bid","bike",
  "bind","biology","bird","birth","bitter","black","blade","blame","blanket","blast",
  "bleak","bless","blind","blood","blossom","blouse","blue","blur","blush","board",
  "boat","body","boil","bomb","bone","book","boost","border","boring","borrow",
  "boss","bottom","bounce","boy","bracket","brain","brand","brave","breeze","brick",
  "bridge","brief","bright","bring","brisk","broccoli","broken","bronze","broom","brother",
  "brown","brush","bubble","buddy","budget","buffalo","build","bulb","bulk","bullet",
  "bundle","bunker","burden","burger","burst","bus","business","busy","butter","buyer",
  "buzz","cabbage","cabin","cable","cactus","cage","cake","call","calm","camera",
  "camp","canal","cancel","candy","cannon","canvas","canyon","capable","capital","captain",
  "car","carbon","card","cargo","carpet","carry","cart","case","cash","casino",
  "castle","casual","cat","catalog","catch","category","cattle","caught","cause","caution",
  "cave","ceiling","celery","cement","census","century","cereal","certain","chair","chalk",
  "champion","change","chaos","chapter","charge","chase","chat","cheap","check","cheese",
  "chef","cherry","chest","chicken","chief","child","chimney","choice","choose","chronic",
  "chuckle","chunk","cigar","cinnamon","circle","citizen","city","civil","claim","clap",
  "clarify","claw","clay","clean","clerk","clever","click","client","cliff","climb",
  "clinic","clip","clock","clog","close","cloth","cloud","clown","club","clump",
  "cluster","clutch","coach","coast","coconut","code","coffee","coil","coin","collect",
  "color","column","combine","come","comfort","comic","common","company","concert","conduct",
  "confirm","congress","connect","consider","control","convince","cook","cool","copper","copy",
  "coral","core","corn","correct","cost","cotton","couch","country","couple","course",
  "cousin","cover","coyote","crack","cradle","craft","cram","crane","crash","crazy",
  "cream","credit","creek","crew","cricket","crime","crisp","critic","cross","crouch",
  "crowd","crucial","cruel","cruise","crumble","crunch","crush","cry","crystal","cube",
  "culture","cup","cupboard","curious","current","curtain","curve","cushion","custom","cute",
  "cycle","dad","damage","damp","dance","danger","daring","dash","daughter","dawn",
  "day","deal","debate","debris","decade","december","decide","decline","decorate","decrease",
  "deer","defense","define","defy","degree","delay","deliver","demand","demise","denial",
  "dentist","deny","depart","depend","deposit","depth","deputy","derive","describe","desert",
  "design","desk","despair","destroy","detail","detect","develop","device","devote","diagram",
  "dial","diamond","diary","dice","diesel","diet","differ","digital","dignity","dilemma",
  "dinner","dinosaur","direct","dirt","disagree","discover","disease","dish","dismiss","disorder",
  "display","distance","divert","divide","divorce","dizzy","doctor","document","dog","doll",
  "dolphin","domain","donate","donkey","donor","door","dose","double","dove","draft",
  "dragon","drama","drastic","draw","dream","dress","drift","drill","drink","drip",
  "drive","drop","drum","dry","duck","dumb","dune","during","dust","dutch",
  "duty","dwarf","dynamic","eager","eagle","early","earn","earth","easily","east",
  "easy","echo","ecology","edge","edit","educate","effort","egg","eight","either",
  "elbow","elder","electric","elegant","element","elephant","elevator","elite","else","embark",
  "embody","embrace","emerge","emotion","employ","empower","empty","enable","enact","endless",
  "endorse","enemy","energy","enforce","engage","engine","enhance","enjoy","enlist","enough",
  "enrich","enroll","ensure","enter","entire","entry","envelope","episode","equal","equip",
  "erase","erode","erosion","error","erupt","escape","essay","estate","eternal","ethics",
  "evidence","evil","evoke","evolve","exact","example","excess","exchange","excite","exclude",
  "exercise","exhaust","exhibit","exile","exist","exit","exotic","expand","expire","explain",
  "expose","express","extend","extra","eye","fable","face","faculty","faint","faith",
  "fall","false","fame","family","famous","fan","fancy","fantasy","far","fashion",
  "fat","fatal","father","fatigue","fault","favorite","feature","february","federal","fee",
  "feed","feel","feet","fellow","felt","fence","festival","fetch","fever","few",
  "fiber","fiction","field","figure","file","film","filter","final","find","fine",
  "finger","finish","fire","firm","first","fiscal","fish","fit","fitness","fix",
  "flag","flame","flash","flat","flavor","flee","flight","flip","float","flock",
  "floor","flower","fluid","flush","fly","foam","focus","fog","foil","follow",
  "food","foot","force","forest","forget","fork","fortune","forum","forward","fossil",
  "foster","found","fox","fragile","frame","frequent","fresh","friend","fringe","frog",
  "front","frost","frown","frozen","fruit","fuel","fun","funny","furnace","fury",
  "future","gadget","gain","galaxy","gallery","game","gap","garbage","garden","garlic",
  "garment","gas","gasp","gate","gather","gauge","gaze","general","genius","genre",
  "gentle","genuine","gesture","ghost","giant","gift","giggle","ginger","giraffe","girl",
  "give","glad","glance","glare","glass","glide","glimpse","globe","gloom","glory",
  "glove","glow","glue","goat","goddess","gold","good","goose","gorilla","gospel",
  "gossip","govern","gown","grab","grace","grain","grant","grape","grasp","grass",
  "gravity","great","green","grid","grief","grit","grocery","group","grow","grunt",
  "guard","guide","guilt","guitar","gun","gym","habit","hair","half","hammer",
  "hamster","hand","happy","harsh","harvest","hat","have","hawk","hazard","head",
  "health","heart","heavy","hedgehog","height","hello","helmet","help","hero","hidden",
  "high","hill","hint","hip","hire","history","hobby","hockey","hold","hole",
  "holiday","hollow","home","honey","hood","hope","horn","hospital","host","hour",
  "hover","hub","huge","human","humble","humor","hundred","hungry","hunt","hurdle",
  "hurry","hurt","husband","hybrid","ice","icon","ignore","ill","illegal","image",
  "imitate","immense","immune","impact","impose","improve","impulse","inbox","income","increase",
  "index","indicate","indoor","industry","infant","inflict","inform","inhale","inject","inner",
  "innocent","input","inquiry","insane","insect","inside","inspire","install","intact","interest",
  "into","invest","invite","involve","island","isolate","issue","item","ivory","jacket",
  "jaguar","jar","jazz","jealous","jeans","jelly","jewel","job","join","joke",
  "journey","joy","judge","juice","jump","jungle","junior","junk","just","kangaroo",
  "keen","keep","ketchup","key","kick","kid","kingdom","kiss","kit","kitchen",
  "kite","kitten","kiwi","knee","knife","knock","know","lab","lamp","language",
  "laptop","large","later","laugh","laundry","lava","law","lawn","lawsuit","layer",
  "lazy","leader","learn","leave","lecture","left","leg","legal","legend","lemon",
  "lend","length","lens","leopard","lesson","letter","level","liar","liberty","library",
  "license","life","lift","like","limb","limit","lion","liquid","list","little",
  "live","lizard","load","loan","lobster","local","lock","logic","lonely","long",
  "loop","lottery","loud","lounge","love","loyal","lucky","luggage","lumber","lunar",
  "lunch","luxury","mad","magic","magnet","maid","main","manage","mandate","mango",
  "mansion","manual","maple","marble","march","margin","marine","market","marriage","mask",
  "master","match","material","math","matrix","matter","maximum","maze","meadow","mean",
  "medal","media","melody","melt","member","memory","mention","menu","mercy","merge",
  "merit","merry","mesh","message","metal","method","middle","midnight","milk","million",
  "mimic","mind","minimum","minor","minute","miracle","miss","mitten","model","modify",
  "mom","monitor","monkey","monster","month","moon","moral","more","morning","mosquito",
  "mother","motion","motor","mountain","mouse","move","movie","much","muffin","mule",
  "multiply","muscle","museum","mushroom","music","must","mutual","myself","mystery","naive",
  "name","napkin","narrow","nasty","nature","near","neck","need","negative","neglect",
  "neither","nephew","nerve","nest","never","news","next","nice","night","noble",
  "noise","nominee","noodle","normal","north","notable","note","nothing","notice","novel",
  "now","nuclear","number","nurse","nut","oak","obey","object","oblige","obscure",
  "obtain","ocean","october","odor","off","offer","office","often","oil","okay",
  "old","olive","olympic","omit","once","onion","open","option","orange","orbit",
  "orchard","order","ordinary","organ","orient","original","orphan","ostrich","other","outdoor",
  "outside","oval","over","own","oyster","ozone","pact","paddle","page","pair",
  "palace","palm","panda","panel","panic","panther","paper","parade","parent","park",
  "parrot","party","pass","patch","path","patrol","pause","pave","payment","peace",
  "peanut","peasant","pelican","pen","penalty","pencil","people","pepper","perfect","permit",
  "person","pet","phone","photo","phrase","physical","piano","picnic","picture","piece",
  "pigeon","pill","pilot","pink","pioneer","pipe","pistol","pitch","pizza","place",
  "planet","plastic","plate","play","please","pledge","pluck","plug","plunge","poem",
  "poet","point","polar","pole","police","pond","pony","pool","popular","portion",
  "position","possible","post","potato","pottery","poverty","powder","power","practice","praise",
  "predict","prefer","prepare","present","pretty","prevent","price","pride","primary","print",
  "priority","prison","private","prize","problem","process","produce","profit","program","project",
  "promote","proof","property","prosper","protect","proud","provide","public","pudding","pull",
  "pulp","pulse","pumpkin","punish","pupil","purchase","purity","purpose","purse","push",
  "put","puzzle","pyramid","quality","quantum","quarter","question","quick","quit","quiz",
  "quote","rabbit","raccoon","race","rack","radar","radio","rage","rail","rain",
  "raise","rally","ramp","ranch","random","range","rapid","rare","rate","rather",
  "raven","reach","ready","real","reason","rebel","rebuild","recall","receive","recipe",
  "record","recycle","reduce","reflect","reform","refuse","region","regret","regular","reject",
  "relax","release","relief","rely","remain","remember","remind","remove","render","renew",
  "rent","reopen","repair","repeat","replace","report","require","rescue","resemble","resist",
  "resource","response","result","retire","retreat","return","reunion","reveal","review","reward",
  "rhythm","ribbon","rice","rich","ride","ridge","rifle","right","rigid","ring",
  "riot","ripple","risk","ritual","rival","river","road","roast","robot","robust",
  "rocket","romance","roof","rookie","rose","rotate","rough","royal","rubber","rude",
  "rug","rule","run","runway","rural","sad","saddle","sadness","safe","sail",
  "salad","salmon","salon","salt","salute","same","sample","sand","satisfy","satoshi",
  "sauce","sausage","save","say","scale","scan","scare","scatter","scene","scheme",
  "science","scissors","scorpion","scout","scrap","screen","script","scrub","sea","search",
  "season","seat","second","secret","section","security","seek","select","sell","seminar",
  "senior","sense","sentence","series","service","session","settle","setup","seven","shadow",
  "shaft","shallow","share","shed","shell","sheriff","shield","shift","shine","ship",
  "shiver","shock","shoe","shoot","shop","short","shoulder","shove","shrimp","shrug",
  "shudder","shy","siege","sight","sign","silent","silk","silly","silver","similar",
  "simple","since","sing","siren","sister","situate","six","size","sketch","skill",
  "skin","skirt","skull","slab","slam","sleep","slender","slice","slide","slight",
  "slim","slogan","slot","slow","slush","small","smart","smile","smoke","smooth",
  "snack","snake","snap","sniff","snow","soap","soccer","social","sock","solar",
  "soldier","solid","solution","solve","someone","song","soon","sorry","soul","sound",
  "soup","source","south","space","spare","spatial","spawn","speak","special","speed",
  "sphere","spice","spider","spike","spin","spirit","split","spoil","sponsor","spoon",
  "spray","spread","spring","spy","square","squeeze","squirrel","stable","stadium","staff",
  "stage","stairs","stamp","stand","start","state","stay","steak","steel","stem",
  "step","stereo","stick","still","sting","stock","stomach","stone","stop","store",
  "storm","story","stove","strategy","street","strike","strong","struggle","student","stuff",
  "stumble","style","subject","submit","subway","success","such","sudden","suffer","sugar",
  "suggest","suit","summer","sun","sunny","sunset","super","supply","supreme","sure",
  "surface","surge","surprise","sustain","swallow","swamp","swap","swear","sweet","swift",
  "swim","swing","switch","sword","symbol","symptom","syrup","table","tackle","tag",
  "tail","talent","tank","tape","target","task","tattoo","taxi","teach","team",
  "tell","ten","tenant","tennis","tent","term","test","text","thank","that",
  "theme","then","theory","there","they","thing","this","thought","three","thrive",
  "throw","thumb","thunder","ticket","tilt","timber","time","tiny","tip","tired",
  "title","toast","tobacco","today","together","toilet","token","tomato","tomorrow","tone",
  "tongue","tonight","tool","topic","topple","torch","tornado","tortoise","toss","total",
  "tourist","toward","tower","town","toy","track","trade","traffic","tragic","train",
  "transfer","trap","trash","travel","tray","treat","tree","trend","trial","tribe",
  "trick","trigger","trim","trip","trophy","trouble","truck","truly","trumpet","trust",
  "truth","try","tube","tuition","tumble","tuna","tunnel","turkey","turn","turtle",
  "twelve","twenty","twice","twin","twist","two","type","typical","ugly","umbrella",
  "unable","uncle","under","unfair","unfold","unhappy","uniform","unique","universe","unknown",
  "until","unusual","unveil","update","upgrade","uphold","upon","upper","upset","urban",
  "usage","use","used","useful","useless","usual","utility","vacant","vacuum","vague",
  "valid","valley","valve","van","vanish","vapor","various","vast","vault","vehicle",
  "velvet","vendor","venture","venue","verb","verify","version","very","veteran","viable",
  "vibrant","vicious","victory","video","view","village","vintage","violin","virtual","virus",
  "visa","visit","visual","vital","vivid","vocal","voice","void","volcano","volume",
  "vote","voyage","wage","wagon","wait","walk","wall","walnut","want","warfare",
  "warm","warrior","waste","water","wave","way","wealth","weapon","wear","weasel",
  "weather","web","wedding","weekend","weird","welcome","well","west","wet","whale",
  "wheat","wheel","when","where","whip","whisper","wide","width","wife","wild",
  "will","win","window","wine","wing","wink","winner","winter","wire","wisdom",
  "wise","wish","witness","wolf","woman","wonder","wood","wool","word","world",
  "worry","worth","wrap","wreck","wrestle","wrist","write","wrong","yard","year",
  "yellow","you","young","youth","zebra","zero","zone","zoo"
];

// ---------------------------------------------------------------------------
// secp256k1 curve parameters
// ---------------------------------------------------------------------------
const _BI0 = BigInt(0);
const _BI1 = BigInt(1);
const _BI2 = BigInt(2);
const _BI3 = BigInt(3);
const _BI58 = BigInt(58);

const P  = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
const N  = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const Gx = BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
const Gy = BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8');

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = _BI1;
  base = ((base % mod) + mod) % mod;
  while (exp > _BI0) {
    if (exp & _BI1) result = (result * base) % mod;
    exp >>= _BI1;
    base = (base * base) % mod;
  }
  return result;
}

function modinv(a: bigint, m: bigint): bigint {
  return modpow(((a % m) + m) % m, m - _BI2, m);
}

type Point = { x: bigint; y: bigint } | null;

function pointAdd(P1: Point, P2: Point): Point {
  if (!P1) return P2;
  if (!P2) return P1;
  if (P1.x === P2.x) {
    if (P1.y !== P2.y) return null;
    // Point doubling
    const m = (_BI3 * P1.x * P1.x * modinv(_BI2 * P1.y, P)) % P;
    const x3 = ((m * m - _BI2 * P1.x) % P + P) % P;
    const y3 = ((m * (P1.x - x3) - P1.y) % P + P) % P;
    return { x: x3, y: y3 };
  }
  const m = ((P2.y - P1.y) * modinv(P2.x - P1.x + P, P)) % P;
  const x3 = ((m * m - P1.x - P2.x) % P + P) % P;
  const y3 = ((m * (P1.x - x3) - P1.y) % P + P) % P;
  return { x: x3, y: y3 };
}

function pointMul(scalar: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  let k = ((scalar % N) + N) % N;
  while (k > _BI0) {
    if (k & _BI1) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= _BI1;
  }
  return result;
}

function compressedPublicKey(pubPoint: { x: bigint; y: bigint }): Buffer {
  const prefix = (pubPoint.y & _BI1) === _BI0 ? 0x02 : 0x03;
  const xBuf = Buffer.alloc(32);
  const xHex = pubPoint.x.toString(16).padStart(64, '0');
  xBuf.write(xHex, 0, 32, 'hex');
  return Buffer.concat([Buffer.from([prefix]), xBuf]);
}

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------
function sha256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function ripemd160(data: Buffer): Buffer {
  return crypto.createHash('ripemd160').update(data).digest();
}

function hash160(data: Buffer): Buffer {
  return ripemd160(sha256(data));
}

// ---------------------------------------------------------------------------
// Base58Check encoding
// ---------------------------------------------------------------------------
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  let result = '';
  while (num > _BI0) {
    const rem = num % _BI58;
    result = BASE58_ALPHABET[Number(rem)] + result;
    num = num / _BI58;
  }
  // Leading zero bytes
  for (let i = 0; i < buf.length && buf[i] === 0; i++) {
    result = '1' + result;
  }
  return result;
}

function base58check(payload: Buffer): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

// ---------------------------------------------------------------------------
// BTC address derivation from 32-byte entropy
// ---------------------------------------------------------------------------
function btcAddressFromEntropy(entropy: Buffer): string {
  const privKeyBig = BigInt('0x' + entropy.toString('hex')) % (N - _BI1) + _BI1;
  const G: Point = { x: Gx, y: Gy };
  const pubPoint = pointMul(privKeyBig, G);
  if (!pubPoint) throw new Error('Point multiplication failed');
  const compPub = compressedPublicKey(pubPoint);
  const pubKeyHash = hash160(compPub);
  // P2PKH mainnet: version byte 0x00
  const payload = Buffer.concat([Buffer.from([0x00]), pubKeyHash]);
  return base58check(payload);
}

// ---------------------------------------------------------------------------
// Mnemonic generation (BIP39-style, 24 words from 256-bit entropy)
// ---------------------------------------------------------------------------
function entropyToMnemonic(entropy: Buffer): string {
  // 256-bit entropy -> 256-bit + 8-bit checksum = 264 bits -> 24 words
  const hashByte = sha256(entropy)[0];
  // Build bit string
  let bits = '';
  for (const byte of entropy) {
    bits += byte.toString(2).padStart(8, '0');
  }
  bits += hashByte.toString(2).padStart(8, '0').slice(0, 8);
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    const idx = parseInt(bits.slice(i * 11, i * 11 + 11), 2);
    words.push(BIP39_WORDLIST[idx % 2048]);
  }
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// Encryption / Decryption (AES-256-GCM with scrypt key)
// ---------------------------------------------------------------------------
interface EncryptedWallet {
  coin: string;
  address: string;
  createdAt: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  version: number;
}

async function deriveKey(password: string, coin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password + coin, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function encryptData(plaintext: string, key: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ct.toString('hex'),
  };
}

function decryptData(enc: { iv: string; tag: string; ciphertext: string }, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// ---------------------------------------------------------------------------
// Wallet file paths
// ---------------------------------------------------------------------------
function walletDir(): string {
  return path.join(process.cwd(), 'data', 'wallets');
}

function walletPath(coin: string, name = 'default'): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Backward compat: legacy files without a name suffix
  const legacyPath = path.join(walletDir(), `${coin}-wallet.enc`);
  const namedPath  = path.join(walletDir(), `${coin}-wallet-${safeName}.enc`);
  if (safeName === 'default' && fs.existsSync(legacyPath) && !fs.existsSync(namedPath)) {
    return legacyPath;
  }
  return namedPath;
}

function ensureWalletDir(): void {
  const dir = walletDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Agent password store (plaintext JSON — for convenience in local dev only)
// ---------------------------------------------------------------------------
function agentPasswordsPath(): string {
  return path.join(walletDir(), '.agent-passwords.json');
}

export function storeAgentPassword(coin: string, name: string, password: string): void {
  ensureWalletDir();
  const p = agentPasswordsPath();
  let store: Record<string, string> = {};
  if (fs.existsSync(p)) {
    try { store = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
  }
  store[`${coin}:${name}`] = password;
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
}

export function getAgentPassword(coin: string, name: string): string | null {
  const p = agentPasswordsPath();
  if (!fs.existsSync(p)) return null;
  try {
    const store: Record<string, string> = JSON.parse(fs.readFileSync(p, 'utf8'));
    return store[`${coin}:${name}`] ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// HTTPS helper
// ---------------------------------------------------------------------------
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'e8-agent/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateWallet(coin: 'btc' | 'xmr', password: string, name = 'default'): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  ensureWalletDir();
  const filePath = walletPath(coin, name);
  const alreadyExists = fs.existsSync(filePath);

  // Generate entropy
  const entropy = crypto.randomBytes(32);
  const mnemonic = entropyToMnemonic(entropy);

  let address: string;
  let extraMessage = '';

  if (coin === 'btc') {
    address = btcAddressFromEntropy(entropy);
  } else {
    // XMR: spend key seed is just the hex entropy
    address = entropy.toString('hex');
    extraMessage =
      ' Import this seed into the official Monero CLI wallet (monero-wallet-cli --restore-deterministic-wallet) to derive your XMR address.';
  }

  // Encrypt and store
  const salt = crypto.randomBytes(32);
  const key = await deriveKey(password, coin, salt);
  const createdAt = new Date().toISOString();
  const plaintext = JSON.stringify({ mnemonic, address, createdAt });
  const { iv, tag, ciphertext } = encryptData(plaintext, key);

  const walletFile: EncryptedWallet = {
    coin,
    address,
    createdAt,
    salt: salt.toString('hex'),
    iv,
    tag,
    ciphertext,
    version: 1,
  };

  if (alreadyExists) {
    throw new Error(
      `A ${coin.toUpperCase()} wallet named '${name}' already exists. Use 'unlock' to access it, or choose a different name.`
    );
  }

  fs.writeFileSync(filePath, JSON.stringify(walletFile, null, 2), 'utf8');

  return JSON.stringify({
    address,
    mnemonic,
    name,
    message:
      `${coin.toUpperCase()} wallet '${name}' created and encrypted. WRITE DOWN YOUR MNEMONIC — it is shown only once and cannot be recovered if lost.${extraMessage}`,
  });
}

export async function unlockWallet(coin: 'btc' | 'xmr', password: string, name = 'default'): Promise<string> {
  // If password not provided, try the agent-stored password
  const effectivePassword = password || getAgentPassword(coin, name) || '';
  const filePath = walletPath(coin, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No ${coin.toUpperCase()} wallet named '${name}' found. Use 'generate' to create one.`);
  }

  const walletFile: EncryptedWallet = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const salt = Buffer.from(walletFile.salt, 'hex');
  const key = await deriveKey(effectivePassword, coin, salt);

  let plaintext: string;
  try {
    plaintext = decryptData({ iv: walletFile.iv, tag: walletFile.tag, ciphertext: walletFile.ciphertext }, key);
  } catch {
    throw new Error('Incorrect password or corrupted wallet file.');
  }

  const data = JSON.parse(plaintext) as { mnemonic: string; address: string; createdAt: string };

  return JSON.stringify({
    coin: coin.toUpperCase(),
    name,
    address: data.address,
    createdAt: data.createdAt,
    message: 'Wallet unlocked. Mnemonic is not shown for security.',
  });
}

export async function checkBalance(coin: 'btc' | 'xmr', address: string): Promise<string> {
  if (coin === 'xmr') {
    return JSON.stringify({
      coin: 'XMR',
      message: 'Use Monero wallet CLI to check balance: monero-wallet-cli or a trusted block explorer like xmrchain.net',
    });
  }

  // BTC via mempool.space
  try {
    const raw = await httpsGet(`https://mempool.space/api/address/${address}`);
    const data = JSON.parse(raw) as {
      chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
    };
    const confirmedSats =
      data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const unconfirmedSats =
      data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    const confirmedBtc = (confirmedSats / 1e8).toFixed(8);
    const unconfirmedBtc = (unconfirmedSats / 1e8).toFixed(8);
    return JSON.stringify({
      coin: 'BTC',
      address,
      confirmedBTC: confirmedBtc,
      unconfirmedBTC: unconfirmedBtc,
      txCount: data.chain_stats.tx_count,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch BTC balance: ${message}`);
  }
}

export async function getPrice(coin: 'btc' | 'xmr'): Promise<string> {
  try {
    const raw = await httpsGet(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,monero&vs_currencies=usd,btc'
    );
    const data = JSON.parse(raw) as {
      bitcoin?: { usd: number; btc: number };
      monero?: { usd: number; btc: number };
    };
    if (coin === 'btc') {
      return JSON.stringify({
        coin: 'BTC',
        priceUSD: data.bitcoin?.usd ?? 'N/A',
        priceBTC: 1,
      });
    } else {
      return JSON.stringify({
        coin: 'XMR',
        priceUSD: data.monero?.usd ?? 'N/A',
        priceBTC: data.monero?.btc ?? 'N/A',
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch price: ${message}`);
  }
}

export function listWallets(): string {
  const dir = walletDir();
  if (!fs.existsSync(dir)) {
    return JSON.stringify({ wallets: [], message: 'No wallets found. Use generate to create one.' });
  }

  const wallets: Array<{ coin: string; name: string; createdAt: string; address: string }> = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.enc')) continue;

    // Parse filename: "${coin}-wallet.enc" (legacy) or "${coin}-wallet-${name}.enc"
    const legacyMatch = file.match(/^(btc|xmr)-wallet\.enc$/);
    const namedMatch  = file.match(/^(btc|xmr)-wallet-(.+)\.enc$/);
    const coin = (legacyMatch?.[1] ?? namedMatch?.[1]) as 'btc' | 'xmr' | undefined;
    const name = legacyMatch ? 'default' : namedMatch?.[2] ?? 'default';
    if (!coin) continue;

    try {
      const wf: EncryptedWallet = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      wallets.push({
        coin: coin.toUpperCase(),
        name,
        createdAt: wf.createdAt,
        address: wf.address.slice(0, 10) + '...' + wf.address.slice(-6),
      });
    } catch {
      wallets.push({ coin: coin.toUpperCase(), name, createdAt: 'unknown', address: '(unreadable)' });
    }
  }

  if (wallets.length === 0) {
    return JSON.stringify({ wallets: [], message: 'No wallets found. Use generate to create one.' });
  }
  return JSON.stringify({ wallets });
}
