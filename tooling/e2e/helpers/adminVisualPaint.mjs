/** Real native layout proof, without changing user motion preferences. */
export async function waitForAdminVisualPaint(){
 await document.fonts.ready;
 // Scrolling can change :hover on the next frame and start a color transition.
 // Let style/hover update before collecting the actual native animations.
 await new Promise(resolve=>requestAnimationFrame(resolve));
 await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
