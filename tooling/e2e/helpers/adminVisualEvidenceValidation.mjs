import {isDeepStrictEqual} from 'node:util';
import {adminVisualContrastRatio} from './adminVisualPixelContrast.mjs';

const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const empty=(value,code)=>requireProof(Array.isArray(value)&&!value.length,code);
export const normalizeAdminVisualLabel=value=>String(value??'').normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu,'').replace(/\s+/gu,' ').trim();
const validRect=rect=>rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>0&&rect.height>0;
export function assertAdminVisualPixelProof(proof,kind='text'){
 const minimum=kind==='text'?4.5:3;
 requireProof(proof?.resolved===true&&proof.reason==='PIXEL_VISIBLE_CONTRAST_PASS'&&proof.fullyVisibleBeforeRun===true&&proof.fullyVisibleAfterRun===true,'ADMIN_VISUAL_PIXEL_VISIBLE_PROOF_REQUIRED');
 requireProof(proof.captureMethod==='PLAYWRIGHT_TEXT_RANGE_PNG'&&kind==='text'&&proof.paint?.fontsReady===true&&proof.paint?.finiteAnimationsSettled===true&&proof.paint?.framesAfter===2,'ADMIN_VISUAL_PIXEL_CAPTURE_REQUIRED');
 requireProof(Array.isArray(proof.images)&&proof.images.length>0,'ADMIN_VISUAL_PIXEL_IMAGES_REQUIRED');
 for(const image of proof.images){
  requireProof(validRect(image.rect)&&image.version==='admin-pixel-1'&&image.kind===kind&&image.minimum===minimum&&image.status==='pass'&&image.passed===true&&/^[a-f0-9]{64}$/u.test(image.sha256??''),'ADMIN_VISUAL_PIXEL_IMAGE_INVALID');
  requireProof(Number.isFinite(image.dpr)&&image.dpr>0&&Math.abs(image.width-image.rect.width*image.dpr)<=2&&Math.abs(image.height-image.rect.height*image.dpr)<=2,'ADMIN_VISUAL_PIXEL_RECT_DIMENSIONS_REQUIRED');
  const validColor=color=>Array.isArray(color)&&color.length===3&&color.every(value=>Number.isFinite(value)&&value>=0&&value<=255);
  requireProof(validColor(image.foreground)&&validColor(image.background),'ADMIN_VISUAL_PIXEL_COLORS_REQUIRED');
  const ratio=adminVisualContrastRatio(image.foreground,image.background);
  requireProof(Number.isFinite(image.ratio)&&Math.abs(ratio-image.ratio)<1e-10&&ratio>=minimum,'ADMIN_VISUAL_PIXEL_CONTRAST_FAILED');
  requireProof(Number.isInteger(image.width)&&Number.isInteger(image.height)&&image.width>0&&image.height>0&&image.totalPixels===image.width*image.height&&image.backgroundPixels>=image.totalPixels*.5&&image.foregroundPixels>=Math.max(3,Math.ceil(image.totalPixels*.002))&&image.unexplainedPixels<=Math.max(1,image.totalPixels*.005)&&image.antialiasTolerance===16&&image.colorTolerance===4,'ADMIN_VISUAL_PIXEL_SUPPORT_REQUIRED');
 }
}
export function assertAdminVisualAxNameProof(proof){
 requireProof(proof?.resolved===true&&proof.reason==='DIRECT_AX_VISIBLE_LABEL_PREFIX'&&proof.fullyVisibleBeforeRun===true&&proof.fullyVisibleAfterRun===true,'ADMIN_VISUAL_AX_NAME_VISIBLE_PROOF_REQUIRED');
 const ax=proof.ax;
 requireProof(ax?.method==='CDP.Accessibility.getPartialAXTree'&&Number.isInteger(ax.backendDOMNodeId)&&ax.backendDOMNodeId>0&&Number.isInteger(ax.nodeId)&&ax.nodeId>0&&ax.ignored===false&&typeof ax.accessibleName==='string','ADMIN_VISUAL_DIRECT_AX_TREE_REQUIRED');
 const visible=normalizeAdminVisualLabel(proof.visibleText),name=normalizeAdminVisualLabel(ax.accessibleName);
 requireProof(!!visible&&proof.normalizedVisibleText===visible&&proof.normalizedAccessibleName===name&&name.startsWith(visible),'ADMIN_VISUAL_AX_VISIBLE_PREFIX_REQUIRED');
}

/** Aggregate reports may close only these two exact original UNKNOWN rules. */
export function assertAdminVisualDirectEvidence(accessibility){
 requireProof(accessibility&&Array.isArray(accessibility.originalIncomplete)&&Array.isArray(accessibility.remeasurements),'ADMIN_VISUAL_AXE_EVIDENCE_REQUIRED');
 empty(accessibility.violations,'ADMIN_VISUAL_AXE_VIOLATIONS');empty(accessibility.incomplete,'ADMIN_VISUAL_AXE_INCOMPLETE');
 for(const rule of accessibility.originalIncomplete){
  requireProof(['color-contrast','label-content-name-mismatch'].includes(rule.id)&&Array.isArray(rule.nodes),'ADMIN_VISUAL_AXE_UNRESOLVED_RULE');
  for(const node of rule.nodes){
   const proofs=accessibility.remeasurements.filter(proof=>isDeepStrictEqual(proof.target,node.target)&&(proof.ruleId??'color-contrast')===rule.id);
   requireProof(proofs.length===1,'ADMIN_VISUAL_AXE_REMEASUREMENT_REQUIRED');const proof=proofs[0];
   if(rule.id==='label-content-name-mismatch'){assertAdminVisualAxNameProof(proof);continue;}
   if(proof.reason==='PIXEL_VISIBLE_CONTRAST_PASS'){assertAdminVisualPixelProof(proof);continue;}
   requireProof(proof.resolved===true&&proof.reason==='EXACT_VISIBLE_CONTRAST_PASS'&&proof.fullyVisibleBeforeRun===true&&proof.fullyVisibleAfterRun===true,'ADMIN_VISUAL_AXE_EXACT_PASS_REQUIRED');
   empty(proof.violations,'ADMIN_VISUAL_AXE_REMEASUREMENT_VIOLATIONS');empty(proof.incomplete,'ADMIN_VISUAL_AXE_REMEASUREMENT_INCOMPLETE');
   requireProof(Array.isArray(proof.passTargets)&&proof.passTargets.some(target=>isDeepStrictEqual(target,node.target)),'ADMIN_VISUAL_AXE_TARGET_PASS_REQUIRED');
  }
 }
}

export function assertAdminVisualScanEvidence(report){
 requireProof(report?.version==='admin-visual-1'&&report.mode==='strict'&&report.shouldFail===false&&report.compliant===true,'ADMIN_VISUAL_STRICT_SCAN_REQUIRED');
 empty(report.violations,'ADMIN_VISUAL_SCAN_VIOLATIONS');empty(report.indeterminate,'ADMIN_VISUAL_SCAN_INDETERMINATE');
 if(!report.originalIndeterminate)return;
 requireProof(Array.isArray(report.originalIndeterminate)&&Array.isArray(report.pixelEvidence),'ADMIN_VISUAL_SCAN_ORIGINAL_EVIDENCE_REQUIRED');
 for(const [index,issue] of report.originalIndeterminate.entries()){
  requireProof(issue.code==='CONTRAST_UNRESOLVED'&&issue.contrastKind==='text'&&issue.minimum===4.5,'ADMIN_VISUAL_SCAN_UNRESOLVED_RULE');
  const proofs=report.pixelEvidence.filter(proof=>proof.originalIssueIndex===index&&proof.selector===issue.selector);
  requireProof(proofs.length===1,'ADMIN_VISUAL_SCAN_PIXEL_EVIDENCE_REQUIRED');assertAdminVisualPixelProof(proofs[0]);
 }
}
