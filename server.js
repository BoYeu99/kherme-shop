const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

// SITE_DIR = nơi chứa HTML/JS/CSS (cùng thư mục server.js)
const SITE_DIR = __dirname;
// DATA_DIR = nơi chứa dữ liệu (products.json, settings.json, images/)
// Trên Railway: đặt env DATA_DIR=/data (volume mount)
// Trên máy local: dùng cùng thư mục
const DATA_DIR = process.env.DATA_DIR || __dirname;
const PORT = process.env.PORT || 8765;

const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, {recursive:true});

const DEFAULT_PRODUCTS = [
  {id:1,cat:1,kh:'អាវវែងស្រីទំនើប',    vi:'Áo khoác nữ hiện đại',   price:598000,old:800000,clr:'#5C4A2A',em:'🧥',hot:true, img:''},
  {id:2,cat:2,kh:'អាវទ្រនាប់បុរស',      vi:'Áo thun nam cơ bản',      price:152000,old:0,     clr:'#f0f0f0',em:'👕',hot:false,img:''},
  {id:3,cat:2,kh:'ខោជីនស្លីមបុរស',     vi:'Quần jeans nam slim fit',  price:512000,old:720000,clr:'#4a6fa5',em:'👖',hot:true, img:''},
  {id:4,cat:1,kh:'អាវបែបស្រីជំនាន់ថ្មី',vi:'Áo sơ mi nữ hiện đại',   price:272000,old:480000,clr:'#5B8DB8',em:'👗',hot:true, img:''},
  {id:5,cat:3,kh:'អាវក្មេងប្អូនស្រី',  vi:'Áo phông trẻ em dễ thương',price:112000,old:0,     clr:'#E89B3E',em:'🧒',hot:false,img:''},
  {id:6,cat:4,kh:'សំពត់ស្នេហ៍ក្ម',    vi:'Váy hè mới về',            price:352000,old:480000,clr:'#D4A0C0',em:'👗',hot:true, img:''},
];
const DEFAULT_SETTINGS = {telegram:'',shopName:'KHERME'};

function getProducts(){try{if(fs.existsSync(PRODUCTS_FILE))return JSON.parse(fs.readFileSync(PRODUCTS_FILE,'utf8'));}catch(e){}return DEFAULT_PRODUCTS;}
function getSettings(){try{if(fs.existsSync(SETTINGS_FILE))return JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8'));}catch(e){}return DEFAULT_SETTINGS;}
function saveJSON(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');}

const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/mp4'};
const COMPRESSIBLE=new Set(['.html','.js','.css','.json','.svg']);

function sendGzip(req,res,data,mime,extra){
  const headers=Object.assign({'Content-Type':mime,'Vary':'Accept-Encoding'},extra||{});
  const ae=req.headers['accept-encoding']||'';
  if(ae.includes('gzip')){zlib.gzip(Buffer.isBuffer(data)?data:Buffer.from(data),(err,buf)=>{if(err){res.writeHead(200,headers);res.end(data);return;}headers['Content-Encoding']='gzip';headers['Content-Length']=buf.length;res.writeHead(200,headers);res.end(buf);});}
  else{headers['Content-Length']=Buffer.byteLength(data);res.writeHead(200,headers);res.end(data);}
}

function serveFile(req,res,filePath){
  fs.stat(filePath,(err,stat)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    const ext=path.extname(filePath).toLowerCase();
    const mime=MIME[ext]||'application/octet-stream';
    const isMedia=['.mp4','.webm','.mov'].includes(ext);
    const isImg=['.png','.jpg','.jpeg','.gif','.webp'].includes(ext);
    const range=req.headers.range;
    if(range){
      const[s,e]=range.replace(/bytes=/,'').split('-');
      const start=parseInt(s,10);const end=e?parseInt(e,10):stat.size-1;
      res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1,'Content-Type':mime});
      fs.createReadStream(filePath,{start,end}).pipe(res);
    }else if(COMPRESSIBLE.has(ext)){
      fs.readFile(filePath,(e2,data)=>{if(e2){res.writeHead(500);res.end();return;}sendGzip(req,res,data,mime,{'Cache-Control':ext==='.html'?'no-cache':'public,max-age=3600'});});
    }else{
      const cc=isImg?'public,max-age=2592000':isMedia?'public,max-age=86400':'no-cache';
      res.writeHead(200,{'Content-Length':stat.size,'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':cc});
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// ===== TIKTOK IMPORT HELPERS =====
function fetchUrl(urlStr,maxRedirects=6){
  return new Promise((resolve,reject)=>{
    try{
      const parsed=new URL(urlStr);
      const mod=parsed.protocol==='https:'?https:http;
      const opts={hostname:parsed.hostname,path:parsed.pathname+parsed.search,method:'GET',
        headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml','Accept-Language':'vi-VN,vi;q=0.9,km;q=0.8','Accept-Encoding':'identity','Referer':'https://www.tiktok.com/'}};
      const r=mod.request(opts,(res)=>{
        const loc=res.headers.location;
        if([301,302,303,307,308].includes(res.statusCode)&&loc&&maxRedirects>0){resolve(fetchUrl(loc.startsWith('http')?loc:`${parsed.origin}${loc}`,maxRedirects-1));return;}
        let data='';res.on('data',c=>{if(data.length<2000000)data+=c;});res.on('end',()=>resolve({data,status:res.statusCode,finalUrl:urlStr}));
      });
      r.on('error',reject);r.setTimeout(20000,()=>{r.destroy();reject(new Error('Timeout'));});r.end();
    }catch(e){reject(e);}
  });
}

function translateText(text,tl='km'){
  return new Promise(resolve=>{
    if(!text||!text.trim()){resolve('');return;}
    const q=encodeURIComponent(text.substring(0,800));
    const r=https.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${q}`,{headers:{'User-Agent':'Mozilla/5.0'}},(res)=>{
      let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d)[0].map(s=>s[0]).join(''));}catch(e){resolve(text);}});
    });
    r.on('error',()=>resolve(text));r.setTimeout(8000,()=>{r.destroy();resolve(text);});
  });
}

function downloadImage(imgUrl,referer){
  return new Promise(resolve=>{
    try{
      const parsed=new URL(imgUrl);const mod=parsed.protocol==='https:'?https:http;
      const ext=path.extname(parsed.pathname).split('?')[0]||'.jpg';
      const filename=Date.now()+'_tk'+ext;const dest=path.join(IMAGES_DIR,filename);
      const file=fs.createWriteStream(dest);
      const r=mod.get({hostname:parsed.hostname,path:parsed.pathname+parsed.search,headers:{'User-Agent':'Mozilla/5.0','Referer':referer||'https://www.tiktok.com/'}},(res)=>{
        if([301,302,307].includes(res.statusCode)&&res.headers.location){file.close();fs.unlink(dest,()=>{});resolve(downloadImage(res.headers.location,referer));return;}
        if(res.statusCode!==200){file.close();fs.unlink(dest,()=>{});resolve('');return;}
        res.pipe(file);file.on('finish',()=>{file.close();resolve('/images/'+filename);});file.on('error',()=>{file.close();fs.unlink(dest,()=>{});resolve('');});
      });
      r.on('error',()=>{fs.unlink(dest,()=>{});resolve('');});r.setTimeout(25000,()=>{r.destroy();fs.unlink(dest,()=>{});resolve('');});
    }catch(e){resolve('');}
  });
}

function parseTikTokHtml(html){
  function getMeta(prop){const m=html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"'<>]{1,500})["']`,'i'))||html.match(new RegExp(`<meta[^>]+content=["']([^"'<>]{1,500})["'][^>]+(?:property|name)=["']${prop}["']`,'i'));return m?m[1].trim():'';}
  const title=getMeta('og:title')||getMeta('twitter:title')||'';
  const img=getMeta('og:image')||getMeta('twitter:image')||'';
  let priceVnd=0;
  for(const pat of[/"price"\s*:\s*"?(\d{3,10})"?/,/"minPrice"\s*:\s*"?(\d{3,10})"?/,/(\d{1,3}(?:[.,]\d{3})+)\s*(?:₫|đ|VND)/]){const m=html.match(pat);if(m){priceVnd=parseInt(m[1].replace(/[.,]/g,''));if(priceVnd>1000)break;}}
  const extraImgs=[];const imgPat=/"(?:images?|imageUrls?|pics?|cover)":\s*\["([^"]+)"/ig;let im;
  while((im=imgPat.exec(html))!==null&&extraImgs.length<4){if(im[1].startsWith('http'))extraImgs.push(im[1]);}
  return{title,img,priceVnd,extraImgs};
}

// ===== HTTP SERVER =====
http.createServer((req,res)=>{
  const parsed=url.parse(req.url,true);const p=parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}

  if(req.method==='GET'&&p==='/api/products'){sendGzip(req,res,JSON.stringify(getProducts()),'application/json',{'Cache-Control':'no-cache'});return;}
  if(req.method==='GET'&&p==='/api/settings'){sendGzip(req,res,JSON.stringify(getSettings()),'application/json',{'Cache-Control':'no-cache'});return;}

  if(req.method==='POST'&&p==='/api/products'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{saveJSON(PRODUCTS_FILE,JSON.parse(b));res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');}catch(e){res.writeHead(400);res.end('{"error":"'+e.message+'"}')}});return;}
  if(req.method==='POST'&&p==='/api/settings'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{saveJSON(SETTINGS_FILE,JSON.parse(b));res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');}catch(e){res.writeHead(400);res.end('{"error":"'+e.message+'"}')}});return;}

  if(req.method==='POST'&&p==='/api/upload'){
    const origName=decodeURIComponent(parsed.query.name||'file');
    const safe=Date.now()+'_'+origName.replace(/[^a-zA-Z0-9._-]/g,'_');
    const filePath=path.join(IMAGES_DIR,safe);const chunks=[];
    req.on('data',c=>chunks.push(c));
    req.on('end',()=>{try{fs.writeFileSync(filePath,Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,url:'/images/'+safe}));}catch(e){res.writeHead(500);res.end('{"error":"'+e.message+'"}');}});
    req.on('error',e=>{res.writeHead(500);res.end('{"error":"'+e.message+'"}');});return;
  }

  if(req.method==='GET'&&p==='/api/images'){
    try{sendGzip(req,res,JSON.stringify(fs.readdirSync(IMAGES_DIR).map(f=>({name:f,url:'/images/'+f}))),'application/json',{'Cache-Control':'no-cache'});}
    catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end('[]');}return;
  }

  if(req.method==='POST'&&p==='/api/import-tiktok'){
    let body='';req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        const{url:tkUrl}=JSON.parse(body);if(!tkUrl)throw new Error('No URL');
        const{data:html,finalUrl}=await fetchUrl(tkUrl);
        const info=parseTikTokHtml(html);
        // Dùng link ảnh TikTok trực tiếp (không tải về server — TikTok chặn bot download)
        const mainImg=info.img||'';
        const extraImgs=(info.extraImgs||[]).filter(eu=>eu&&eu!==info.img).slice(0,3);
        const[titleVi,titleKh]=await Promise.all([translateText(info.title,'vi'),translateText(info.title,'km')]);
        const media=[mainImg,...extraImgs].filter(Boolean);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,title_vi:titleVi||info.title,title_kh:titleKh||info.title,price_vnd:info.priceVnd,price_khr:Math.round((info.priceVnd||0)*0.2),img:media[0]||'',media}));
      }catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}
    });return;
  }

  // Phục vụ ảnh từ DATA_DIR/images
  if(p.startsWith('/images/')){serveFile(req,res,path.join(DATA_DIR,p.slice(1)));return;}

  // Static files từ SITE_DIR
  let filePath=path.join(SITE_DIR,p==='/'?'index.html':p);
  if(!path.extname(filePath))filePath+='.html';
  serveFile(req,res,filePath);

}).listen(PORT,()=>console.log(`KHERME server :${PORT} | DATA:${DATA_DIR}`));
