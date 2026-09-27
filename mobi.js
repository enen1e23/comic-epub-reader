/* 漫画 EPUB 阅读器 · nan. Local image-only MOBI 6 parser; no book HTML is executed. */
(function(root){
'use strict';
const MAX_TEXT=16*1024*1024;
function fail(){throw Error('MOBI 文件结构不完整或已损坏。');}
function palmDoc(data,limit){
 const out=new Uint8Array(limit);let n=0;
 const put=c=>{if(n>=limit)fail();out[n++]=c;};
 for(let i=0;i<data.length;){const c=data[i++];
  if(c>=1&&c<=8){if(i+c>data.length)fail();for(let j=0;j<c;j++)put(data[i++]);}
  else if(c<128)put(c);
  else if(c>=192){put(32);put(c^128);}
  else{if(i>=data.length)fail();const v=(c<<8)|data[i++],distance=(v&16383)>>3,count=(v&7)+3;if(!distance||distance>n)fail();for(let j=0;j<count;j++)put(out[n-distance]);}
 }
 return out.subarray(0,n);
}
function stripTail(data,flags){
 let end=data.length;
 for(let bit=1;bit<16;bit++)if(flags&(1<<bit)){
  let size=0,done=false;
  for(let j=0;j<4&&j<end;j++){const c=data[end-1-j];size+=(c&127)*2**(7*j);if(c&128){done=true;break;}}
  if(!done||size<1||size>end)fail();end-=size;
 }
 if(flags&1){if(!end)fail();const size=1+(data[end-1]&3);if(size>end)fail();end-=size;}
 return data.subarray(0,end);
}
async function parseMobi(buffer,onProgress=()=>{}){
 const b=new Uint8Array(buffer),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const u16=p=>{if(p<0||p+2>b.length)fail();return v.getUint16(p);};
 const u32=p=>{if(p<0||p+4>b.length)fail();return v.getUint32(p);};
 const ascii=(p,n)=>String.fromCharCode(...b.subarray(p,p+n));
 if(b.length<78||ascii(60,8)!=='BOOKMOBI')throw Error('不是有效的 MOBI 文件。');
 const count=u16(76);if(count<2||78+count*8>b.length)fail();const offsets=[];
 for(let i=0;i<count;i++){const off=u32(78+i*8);if(off<78+count*8||off>=b.length||(i&&off<=offsets[i-1]))fail();offsets.push(off);}offsets.push(b.length);
 const record=i=>{if(!Number.isInteger(i)||i<0||i>=count)fail();return b.subarray(offsets[i],offsets[i+1]);};
 const start=offsets[0],header=record(0);if(header.length<132||ascii(start+16,4)!=='MOBI')fail();
 const h16=p=>{if(p+2>header.length)fail();return u16(start+p);};const h32=p=>{if(p+4>header.length)fail();return u32(start+p);};
 if(h16(12)!==0)throw Error('这本 MOBI 含有加密内容，暂不支持。');
 const version=h32(36),compression=h16(0),headerLength=h32(20);
 if(version>6)throw Error('暂不支持纯 KF8 / AZW3 格式，请先转换为 EPUB。');
 if(compression!==1&&compression!==2)throw Error('暂不支持这本 MOBI 的 Huff/CDIC 压缩，请先转换为 EPUB。');
 if(headerLength<116||16+headerLength>header.length)fail();
 const textLength=h32(4),textCount=h16(8),recordSize=h16(10),firstImage=h32(108),encoding=h32(28);
 if(textLength>MAX_TEXT)throw Error('MOBI 正文过大，目前仅支持图片型漫画。');
 if(!textCount||textCount>=count||!recordSize||recordSize>65536||firstImage<=textCount||firstImage>=count)fail();
 if(![65001,1252].includes(encoding))throw Error('暂不支持这本 MOBI 的文字编码，请先转换为 EPUB。');
 const decoder=new TextDecoder(encoding===65001?'utf-8':'windows-1252');
 const titleOffset=h32(84),titleLength=h32(88);if(titleOffset+titleLength>header.length)fail();
 const title=decoder.decode(header.subarray(titleOffset,titleOffset+titleLength)).replace(/\0/g,'').trim()||'漫画';
 let cover=null;
 if(h32(128)&64){let p=16+headerLength;if(p+12>header.length||ascii(start+p,4)!=='EXTH')fail();const end=p+h32(p+4),n=h32(p+8);if(end>header.length||n>10000)fail();p+=12;
  for(let i=0;i<n;i++){if(p+8>end)fail();const type=h32(p),len=h32(p+4);if(len<8||p+len>end)fail();if(type===201&&len>=12)cover=firstImage+h32(p+8);p+=len;}
 }
 const flags=headerLength>=228?h16(242):0,parts=[];let total=0;
 for(let i=1;i<=textCount;i++){const data=stripTail(record(i),flags),part=compression===2?palmDoc(data,recordSize):data;if(part.length>recordSize)fail();total+=part.length;if(total>MAX_TEXT)fail();parts.push(part);onProgress(Math.round(i/textCount*40));if(i%16===0)await new Promise(r=>setTimeout(r,0));}
 if(total<textLength)fail();const textBytes=new Uint8Array(total);let pos=0;for(const part of parts){textBytes.set(part,pos);pos+=part.length;}
 const html=decoder.decode(textBytes.subarray(0,textLength));
 const body=(html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)||[])[1]??html;
 const clean=body.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 const text=clean.replace(/<[^>]*>/g,'').replace(/&(?:nbsp|#160|#x[aA]0);/g,'').replace(/\s/g,'');
 if(text.length>80)throw Error('这本 MOBI 含有正文文字，目前只支持图片型漫画，以免遗漏内容。');
 if(/<(?:svg|image|object|iframe)\b/i.test(clean)||/\bbackground\s*=/i.test(clean)||/url\s*\(/i.test(clean))throw Error('这本 MOBI 使用了暂不支持的图片排版，请先转换为 EPUB。');
 const indices=[];
 for(const match of clean.matchAll(/<img\b[^>]*>/gi)){const ref=match[0].match(/\brecindex\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+)(?=\s|\/?>))/i);if(!ref)throw Error('找不到完整的 MOBI 图片顺序，请先转换为 EPUB。');const index=Number(ref[1]??ref[2]??ref[3]);if(index<1)fail();indices.push(firstImage+index-1);}
 if(!indices.length)throw Error('没有找到漫画图片，请选择图片型 MOBI。');
 // Follow body order only: metadata covers can duplicate an existing first page.
 // Do not prepend thumbnails or standalone library-cover records.
 if(indices.length>1500)throw Error('页数超过 1500，请选择较小的分卷。');
 const pages=indices.map(index=>{const bytes=record(index);let type;if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';else if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)type='image/png';else if(String.fromCharCode(...bytes.subarray(0,3))==='GIF')type='image/gif';else throw Error('MOBI 中有无法读取的图片，请先转换为 EPUB。');return {bytes,type,record:index};});
 onProgress(45);return {title,pages,chapters:[],format:'mobi'};
}
root.ComicCore.parseMobi=parseMobi;
})(globalThis);
