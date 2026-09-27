/* 漫画 EPUB 阅读器 | 制作：nan。工具署名，不代表书籍内容作者。 */
/* Local-only EPUB image reader. Never inject book HTML into the document. */
(function(root){
const elements=(doc,name)=>Array.from(doc.getElementsByTagNameNS('*',name));
function xml(text){const d=new DOMParser().parseFromString(text,'application/xml');if(elements(d,'parsererror').length)throw Error('书籍目录格式有误，无法读取。');return d;}
function resolve(base,href){if(!href||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href))throw Error('这本书包含外部图片，暂不支持。');let raw=href.split('#')[0].split('?')[0];try{raw=decodeURIComponent(raw)}catch{}const p=base.split('/').slice(0,-1);for(const part of raw.split('/')){if(part==='..')p.pop();else if(part&&part!=='.')p.push(part)}return p.join('/');}
async function parseEpub(buffer,onProgress=()=>{}){
const zip=await JSZip.loadAsync(buffer);let total=0;for(const f of Object.values(zip.files)){total+=f._data?.uncompressedSize||0;if(total>600*1024*1024)throw Error('解压后的书籍超过 600 MB，请使用较小的分卷。');}if(zip.file('META-INF/encryption.xml')){const e=xml(await zip.file('META-INF/encryption.xml').async('string'));if(elements(e,'EncryptedData').length)throw Error('这本 EPUB 含有加密内容，暂不支持。');}
async function read(p){const f=zip.file(p);if(!f)throw Error('书籍缺少文件：'+p);return f.async('string')}
const container=xml(await read('META-INF/container.xml'));const opfPath=elements(container,'rootfile')[0]?.getAttribute('full-path');if(!opfPath)throw Error('不是有效的 EPUB 文件。');const opf=xml(await read(opfPath));const manifest=new Map(elements(opf,'item').map(e=>[e.getAttribute('id'),{href:resolve(opfPath,e.getAttribute('href')),type:e.getAttribute('media-type'),properties:e.getAttribute('properties')||''}]));const spine=elements(opf,'itemref').map(e=>manifest.get(e.getAttribute('idref')));if(!spine.length||spine.some(x=>!x))throw Error('找不到完整的阅读顺序。');
const pages=[],docPages=new Map();let textChapters=0;
for(let i=0;i<spine.length;i++){
 const item=spine[i];docPages.set(item.href,pages.length);let refs=[];
 if(item.type.startsWith('image/'))refs=[item.href];else{
  const doc=xml(await read(item.href));
  // Extract only image references; book scripts, styles, links never execute.
  refs=Array.from(doc.getElementsByTagName('*')).filter(e=>['img','image'].includes(e.localName)).map(e=>e.getAttribute('src')||e.getAttribute('href')||e.getAttributeNS('http://www.w3.org/1999/xlink','href')).filter(Boolean).map(h=>resolve(item.href,h));
  const body=elements(doc,'body')[0];if(body){for(const e of [...elements(body,'script'),...elements(body,'style')])e.parentNode.removeChild(e);const text=body.textContent.replace(/\s/g,'');if(text.length>80)textChapters++;}
 }
 for(const path of refs){if(!zip.file(path))throw Error('漫画图片缺失：'+path);if(!/\.(jpe?g|png|webp|gif)$/i.test(path))throw Error('暂不支持这种图片格式：'+path.split('.').pop());pages.push({path});}
 onProgress(Math.round((i+1)/spine.length*45));
}
if(textChapters)throw Error('这本书含有正文文字，目前只支持图片型漫画，以免导出时遗漏内容。');if(!pages.length)throw Error('没有找到漫画图片，请选择图片型 EPUB。');if(pages.length>1500)throw Error('页数超过 1500，请选择较小的分卷。');
const chapters=[];const nav=Array.from(manifest.values()).find(i=>i.properties.split(' ').includes('nav'));const ncx=Array.from(manifest.values()).find(i=>i.type==='application/x-dtbncx+xml');
try{if(nav){const d=xml(await read(nav.href));const toc=elements(d,'nav').find(e=>(e.getAttribute('epub:type')||e.getAttributeNS('http://www.idpf.org/2007/ops','type')||'').includes('toc'))||elements(d,'nav')[0];if(toc)for(const a of elements(toc,'a')){const p=docPages.get(resolve(nav.href,a.getAttribute('href')));if(p!==undefined&&p<pages.length)chapters.push({title:a.textContent.trim(),page:p});}}else if(ncx){const d=xml(await read(ncx.href));for(const n of elements(d,'navPoint')){const p=docPages.get(resolve(ncx.href,elements(n,'content')[0]?.getAttribute('src')));if(p!==undefined&&p<pages.length)chapters.push({title:elements(n,'text')[0]?.textContent||'章节',page:p});}}}catch{/* Reading order is still authoritative when optional navigation is malformed. */}
return {zip,pages,chapters,title:elements(opf,'title')[0]?.textContent||'漫画'};
}
root.ComicCore={parseEpub,resolve};
})(globalThis);
