/** Real native layout proof, without changing user motion preferences. */
export async function waitForAdminVisualPaint(){
 await document.fonts.ready;
 // Scrolling can change :hover on the next frame and start a color transition.
 // Let style/hover update before collecting the actual native animations.
 await new Promise(resolve=>requestAnimationFrame(resolve));
 // A captured finished promise can remain stale after a native transition has
 // actually finished. Poll current animation state; paused/pending finite
 // motion remains unsettled and is bounded by the caller's evaluation deadline.
 while(document.getAnimations().some(animation=>animation.effect?.getTiming().iterations!==Infinity&&(animation.pending||!['finished','idle'].includes(animation.playState))))await new Promise(resolve=>requestAnimationFrame(resolve));
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
