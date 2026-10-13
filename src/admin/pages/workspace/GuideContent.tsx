import { Fragment, type ReactNode } from 'react';
/** Render the project's guide as text and safe links; never execute embedded HTML. */
function inline(text: string): ReactNode[] {
 return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/gu).filter(Boolean).map((part,index)=>{
  const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);if(link){const allowed=link[2].startsWith('/admin')||/^https:\/\//u.test(link[2]);return allowed?<a key={index} href={link[2]} {...(link[2].startsWith('https:')?{target:'_blank',rel:'noreferrer'}:{})}>{link[1]}</a>:<Fragment key={index}>{link[1]}</Fragment>;}
  if(part.startsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;
  if(part.startsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
  return <Fragment key={index}>{part}</Fragment>;
 });
}
export default function GuideContent({markdown}:{markdown:string}){
 const blocks=markdown.replace(/\r/gu,'').split(/\n\s*\n/gu);return <div className="admin-guide admin-stack">{blocks.filter(block=>block.trim()).map((block,index)=>{
  const heading=block.match(/^(#{1,6})\s+(.+)$/u);if(heading)return heading[1].length===1?<h2 key={index}>{inline(heading[2])}</h2>:<h3 key={index}>{inline(heading[2])}</h3>;
  const lines=block.split('\n');if(lines.every(line=>/^[-*]\s/u.test(line)))return <ul key={index}>{lines.map((line,i)=><li key={i}>{inline(line.replace(/^[-*]\s/u,''))}</li>)}</ul>;
  if(lines.every(line=>/^\d+\.\s/u.test(line)))return <ol key={index}>{lines.map((line,i)=><li key={i}>{inline(line.replace(/^\d+\.\s/u,''))}</li>)}</ol>;
  return <p key={index}>{inline(block)}</p>;
 })}</div>;
}
